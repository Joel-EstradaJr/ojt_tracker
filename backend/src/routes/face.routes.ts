import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../utils/prisma";
import { requireAuth } from "../middleware/auth";
import { uploadImage } from "../middleware/upload";
import { analyzeFaceImageBuffer, checkOpenFaceAvailability, fetchFaceEmbedding, getFaceEngine, getFaceMatchThreshold, mapFaceErrorToUserMessage, verifyFaceMatch } from "../utils/face";

const router = Router();

// Public config endpoint so unauthenticated flows (signup/login UI) can show availability.
router.get("/config", async (_req: Request, res: Response) => {
  const engine = getFaceEngine();
  if (engine === "off") {
    return res.json({ faceServiceConfigured: false, faceServiceReachable: false, matchThreshold: getFaceMatchThreshold(), engine });
  }

  const availability = await checkOpenFaceAvailability();
  if (!availability.ready && availability.reason) {
    console.error("[face/config] OpenFace unavailable:", availability.reason);
  }
  return res.json({ faceServiceConfigured: true, faceServiceReachable: availability.ready, matchThreshold: getFaceMatchThreshold(), engine });
});

router.post("/analyze-upload", uploadImage.single("image"), async (req: Request, res: Response) => {
  if (getFaceEngine() === "off") {
    return res.status(503).json({ error: "Face recognition is disabled." });
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
    faceEnabled: Boolean(trainee.user.faceEnabled) && !!trainee.user.faceEmbedding,
    faceAttendanceEnabled: Boolean(trainee.user.faceAttendanceEnabled),
    faceEnrolledAt: trainee.user.faceEnrolledAt,
    faceServiceConfigured: getFaceEngine() !== "off",
    matchThreshold: getFaceMatchThreshold(),
  });
});

router.post("/enroll", requireAuth, async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
  if (!auth || auth.role !== "trainee" || !auth.traineeId) {
    return res.status(400).json({ error: "Trainee session required." });
  }

  if (getFaceEngine() === "off") return res.status(503).json({ error: "Face recognition service is not configured." });

  const { imageBase64 } = req.body as { imageBase64?: string };
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return res.status(400).json({ error: "imageBase64 is required." });
  }

  const trainee = await prisma.userProfile.findUnique({
    where: { id: auth.traineeId },
    include: { user: { select: { id: true } } },
  });
  if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

  try {
    const embedding = await fetchFaceEmbedding(imageBase64);

    await prisma.user.update({
      where: { id: trainee.user.id },
      data: {
        faceEnabled: true,
        faceEmbedding: embedding,
        faceEnrolledAt: new Date(),
      },
    });

    return res.json({ message: "Face enrolled." });
  } catch (err) {
    console.error("[face/enroll] OpenFace enrollment error:", err);
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

  const faceEnrolled = Boolean(trainee.user.faceEnabled) && !!trainee.user.faceEmbedding;
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

  if (getFaceEngine() === "off") return res.status(503).json({ error: "Face recognition service is not configured." });

  const { imageBase64 } = req.body as { imageBase64?: string };
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return res.status(400).json({ error: "imageBase64 is required." });
  }

  const trainee = await prisma.userProfile.findUnique({
    where: { id: auth.traineeId },
    include: { user: { select: { faceEmbedding: true, faceEnabled: true } } },
  });

  if (!trainee?.user) return res.status(404).json({ error: "Trainee not found." });

  try {
    const { match, similarity } = await verifyFaceMatch(imageBase64, trainee.user.faceEmbedding);
    if (!match) {
      return res.status(401).json({ error: "Face mismatch.", match: false, similarity, threshold: getFaceMatchThreshold() });
    }
    return res.json({ match: true, similarity, threshold: getFaceMatchThreshold() });
  } catch (err) {
    console.error("[face/verify] OpenFace verification error:", err);
    return res.status(400).json({ error: mapFaceErrorToUserMessage(err) });
  }
});

export default router;
