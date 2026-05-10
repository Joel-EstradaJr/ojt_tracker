import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../utils/prisma";
import { requireAuth } from "../middleware/auth";
import { uploadImage } from "../middleware/upload";
import {
  analyzeFaceImageBuffer,
  checkOpenFaceAvailability,
  enrollFromMultipleFrames,
  fetchFaceEmbedding,
  getFaceEngine,
  getFaceMatchThreshold,
  isFaceServiceUnavailableError,
  isOpenFaceReady,
  mapFaceErrorToUserMessage,
  requireOpenFace,
  FACE_SERVICE_UNAVAILABLE_MESSAGE,
  verifyFaceMatch,
} from "../utils/face";

const router = Router();

// Public config endpoint so unauthenticated flows (signup/login UI) can show availability.
router.get("/config", async (_req: Request, res: Response) => {
  const engine = getFaceEngine();
  if (engine === "off") {
    return res.json({ faceServiceConfigured: false, faceServiceReachable: false, matchThreshold: getFaceMatchThreshold(), engine });
  }

  const reachable = isOpenFaceReady();
  if (!reachable) {
    const availability = await checkOpenFaceAvailability();
    if (!availability.ready && availability.reason) {
      console.error("[face/config] OpenFace unavailable:", availability.reason);
    }
  }
  return res.json({ faceServiceConfigured: true, faceServiceReachable: reachable, matchThreshold: getFaceMatchThreshold(), engine });
});

router.post("/analyze-upload", uploadImage.single("image"), async (req: Request, res: Response) => {
  try {
    // Runtime guard — hard 503 if OpenFace is unavailable
    requireOpenFace();
  } catch {
    return res.status(503).json({ error: FACE_SERVICE_UNAVAILABLE_MESSAGE });
  }

  const reqWithFile = req as Request & { file?: Express.Multer.File };
  if (!reqWithFile.file || !reqWithFile.file.buffer) {
    return res.status(400).json({ error: "Image file is required (multipart field: image)." });
  }

  try {
    const analysis = await analyzeFaceImageBuffer(reqWithFile.file.buffer);
    return res.json({
      message: "Image analyzed successfully.",
      fileName: reqWithFile.file.originalname,
      confidence: analysis.confidence,
      pose: analysis.pose,
      gaze: analysis.gaze,
      actionUnits: analysis.actionUnits,
      embedding: analysis.similarityReadyEmbedding,
    });
  } catch (err) {
    console.error("[face/analyze-upload] OpenFace processing error:", err);
    if (isFaceServiceUnavailableError(err)) {
      return res.status(503).json({ error: FACE_SERVICE_UNAVAILABLE_MESSAGE });
    }
    return res.status(400).json({ error: mapFaceErrorToUserMessage(err) });
  }
});

router.get("/status", requireAuth, async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
  if (!auth || auth.role !== "trainee" || !auth.traineeId) {
    return res.status(400).json({ error: "Trainee session required." });
  }

  const trainee = await prisma.userProfile.findUnique({
    where: { id: auth.traineeId },
    include: {
      user: {
        select: {
          faceEnabled: true,
          faceAttendanceEnabled: true,
          faceEnrolledAt: true,
          faceEmbedding: true,
        },
      },
    },
  });

  if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

  return res.json({
    faceEnabled: Boolean(trainee.user.faceEnabled) && Array.isArray(trainee.user.faceEmbedding) && trainee.user.faceEmbedding.length === 128,
    faceAttendanceEnabled: Boolean(trainee.user.faceAttendanceEnabled),
    faceEnrolledAt: trainee.user.faceEnrolledAt,
    faceServiceConfigured: getFaceEngine() !== "off",
    faceServiceReachable: isOpenFaceReady(),
    matchThreshold: getFaceMatchThreshold(),
  });
});

/**
 * POST /enroll — Multi-frame face enrollment
 *
 * Accepts:
 *   { frames: string[], userId?: string, reEnroll?: boolean }
 *
 * Multi-frame enrollment:
 * - Requires at least 5 frames
 * - Runs FeatureExtraction independently on each frame
 * - Rejects if the frames look static
 * - Stores one embedding per user
 */
router.post("/enroll", requireAuth, async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
  if (!auth || auth.role !== "trainee" || !auth.traineeId) {
    return res.status(400).json({ error: "Trainee session required." });
  }

  // Runtime guard — hard 503 if OpenFace is unavailable
  try {
    requireOpenFace();
  } catch {
    return res.status(503).json({ error: FACE_SERVICE_UNAVAILABLE_MESSAGE });
  }

  const { frames, userId, reEnroll } = req.body as { frames?: string[]; userId?: string; reEnroll?: boolean };
  const hasFrames = Array.isArray(frames) && frames.length >= 5 && frames.every((f) => typeof f === "string" && f.trim().length > 0);

  if (!hasFrames) {
    return res.status(400).json({ error: "frames (array of at least 5 base64 images) is required." });
  }

  const trainee = await prisma.userProfile.findUnique({
    where: { id: auth.traineeId },
    include: { user: { select: { id: true } } },
  });
  if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

  if (typeof userId === "string" && userId.trim() && userId.trim() !== trainee.user.id) {
    return res.status(403).json({ error: "Access denied." });
  }

  const existingEmbedding = await prisma.user.findUnique({
    where: { id: trainee.user.id },
    select: { faceEmbedding: true },
  });

  if (Array.isArray(existingEmbedding?.faceEmbedding) && existingEmbedding.faceEmbedding.length === 128 && !reEnroll) {
    return res.status(409).json({ error: "Face is already enrolled for this account. Set reEnroll=true to replace it." });
  }

  try {
    const embedding = await enrollFromMultipleFrames(frames!);

    await prisma.user.update({
      where: { id: trainee.user.id },
      data: {
        faceEnabled: true,
        faceEmbedding: embedding,
        faceEnrolledAt: new Date(),
      },
    });

    return res.json({
      message: `Face enrolled from ${frames!.length} frames.`,
      multiFrame: true,
      frameCount: frames!.length,
    });
  } catch (err) {
    console.error("[face/enroll] OpenFace enrollment error:", err);
    if (isFaceServiceUnavailableError(err)) {
      return res.status(503).json({ error: FACE_SERVICE_UNAVAILABLE_MESSAGE });
    }
    const message = err instanceof Error ? err.message : "";
    if (message.toLowerCase().includes("no face detected")) {
      return res.status(400).json({ error: "No face detected" });
    }
    if (message.toLowerCase().includes("static image detected")) {
      return res.status(401).json({ error: "Static image detected" });
    }
    return res.status(400).json({ error: mapFaceErrorToUserMessage(err) });
  }
});

router.post("/disable", requireAuth, async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
  if (!auth || auth.role !== "trainee" || !auth.traineeId) {
    return res.status(400).json({ error: "Trainee session required." });
  }

  const trainee = await prisma.userProfile.findUnique({
    where: { id: auth.traineeId },
    include: { user: { select: { id: true } } },
  });
  if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

  await prisma.user.update({
    where: { id: trainee.user.id },
    data: {
      faceEnabled: false,
      faceAttendanceEnabled: false,
      faceEmbedding: Prisma.DbNull,
      faceEnrolledAt: null,
    },
  });

  return res.json({ message: "Face authentication disabled." });
});

router.post("/attendance-mode", requireAuth, async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
  if (!auth || auth.role !== "trainee" || !auth.traineeId) {
    return res.status(400).json({ error: "Trainee session required." });
  }

  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean." });
  }

  const trainee = await prisma.userProfile.findUnique({
    where: { id: auth.traineeId },
    include: { user: true },
  });
  if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

  const faceEnrolled = Boolean(trainee.user.faceEnabled) && Array.isArray(trainee.user.faceEmbedding) && trainee.user.faceEmbedding.length === 128;
  if (enabled && !faceEnrolled) {
    return res.status(400).json({ error: "Enroll face first before enabling attendance verification." });
  }

  await prisma.user.update({
    where: { id: trainee.user.id },
    data: { faceAttendanceEnabled: enabled },
  });

  return res.json({ message: "Updated.", faceAttendanceEnabled: enabled });
});

router.post("/verify", requireAuth, async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
  if (!auth || auth.role !== "trainee" || !auth.traineeId) {
    return res.status(400).json({ error: "Trainee session required." });
  }

  // Runtime guard — hard 503 if OpenFace is unavailable
  try {
    requireOpenFace();
  } catch {
    return res.status(503).json({ error: FACE_SERVICE_UNAVAILABLE_MESSAGE });
  }

  const { frames } = req.body as { frames?: string[] };
  const hasFrames = Array.isArray(frames) && frames.length >= 5 && frames.every((frame) => typeof frame === "string" && frame.trim().length > 0);
  if (!hasFrames) {
    return res.status(400).json({ error: "frames (array of at least 5 base64 images) is required." });
  }

  const trainee = await prisma.userProfile.findUnique({
    where: { id: auth.traineeId },
    include: { user: { select: { faceEmbedding: true, faceEnabled: true } } },
  });

  if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

  // Hard reject if face is not enrolled
  if (!trainee.user.faceEnabled || !Array.isArray(trainee.user.faceEmbedding) || trainee.user.faceEmbedding.length !== 128) {
    return res.status(403).json({ error: "Face is not enrolled for this account." });
  }

  try {
    const { match, similarity } = await verifyFaceMatch(frames, trainee.user.faceEmbedding);
    if (!match) {
      return res.status(401).json({ error: "Face mismatch.", match: false, similarity, threshold: getFaceMatchThreshold() });
    }
    return res.json({ match: true, similarity, threshold: getFaceMatchThreshold() });
  } catch (err) {
    console.error("[face/verify] OpenFace verification error:", err);
    if (isFaceServiceUnavailableError(err)) {
      return res.status(503).json({ error: FACE_SERVICE_UNAVAILABLE_MESSAGE });
    }
    return res.status(400).json({ error: mapFaceErrorToUserMessage(err) });
  }
});

export default router;
