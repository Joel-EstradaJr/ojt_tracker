import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../utils/prisma";
import { requireAuth } from "../middleware/auth";
import { fetchFaceEmbedding, getFaceMatchThreshold, getFaceServiceUrl, verifyFaceMatch } from "../utils/face";

async function checkFaceServiceReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${url}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

const router = Router();

// Public config endpoint so unauthenticated flows (signup/login UI) can show availability.
router.get("/config", async (_req: Request, res: Response) => {
  const url = getFaceServiceUrl();
  if (!url) {
    return res.json({ faceServiceConfigured: false, faceServiceReachable: false, matchThreshold: getFaceMatchThreshold() });
  }

  const reachable = await checkFaceServiceReachable(url);
  return res.json({ faceServiceConfigured: true, faceServiceReachable: reachable, matchThreshold: getFaceMatchThreshold() });
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
    faceServiceConfigured: Boolean(getFaceServiceUrl()),
    matchThreshold: getFaceMatchThreshold(),
  });
});

router.post("/enroll", requireAuth, async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
  if (!auth || auth.role !== "trainee" || !auth.traineeId) {
    return res.status(400).json({ error: "Trainee session required." });
  }

  if (!getFaceServiceUrl()) {
    return res.status(503).json({ error: "Face recognition service is not configured." });
  }

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
    const msg = err instanceof Error ? err.message : "Face enrollment failed.";
    return res.status(400).json({ error: msg });
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

  if (!getFaceServiceUrl()) {
    return res.status(503).json({ error: "Face recognition service is not configured." });
  }

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
    const msg = err instanceof Error ? err.message : "Face verification failed.";
    return res.status(400).json({ error: msg });
  }
});

export default router;
