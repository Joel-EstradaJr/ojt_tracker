import { Request, Response } from "express";
import prisma from "../utils/prisma";

function canAccessTrainee(auth: { role: "admin" | "trainee"; traineeId?: string } | undefined, traineeId: string) {
  if (auth?.role === "admin") return true;
  return auth?.traineeId === traineeId;
}

export const getScriptsByTrainee = async (req: Request, res: Response) => {
  try {
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
    const { traineeId } = req.params;

    if (!canAccessTrainee(auth, traineeId)) {
      return res.status(403).json({ error: "Access denied." });
    }

    const scripts = await prisma.accomplishmentScript.findMany({
      where: { traineeId },
      orderBy: { updatedAt: "desc" },
    });

    return res.json(scripts);
  } catch (err) {
    console.error("getScriptsByTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const createScript = async (req: Request, res: Response) => {
  try {
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
    const { traineeId } = req.params;
    const { title, content } = req.body as { title: string; content: string };

    if (!canAccessTrainee(auth, traineeId)) {
      return res.status(403).json({ error: "Access denied." });
    }

    const trainee = await prisma.userProfile.findUnique({ where: { id: traineeId }, select: { id: true } });
    if (!trainee) {
      return res.status(404).json({ error: "Trainee not found." });
    }

    const script = await prisma.accomplishmentScript.create({
      data: {
        traineeId,
        title,
        content,
      },
    });

    return res.status(201).json(script);
  } catch (err) {
    console.error("createScript error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const updateScript = async (req: Request, res: Response) => {
  try {
    const auth = (req as Request & { auth?: { role: "admin" | "trainee"; traineeId?: string } }).auth;
    const { scriptId } = req.params;
    const { title, content } = req.body as { title: string; content: string };

    const existing = await prisma.accomplishmentScript.findUnique({
      where: { id: scriptId },
      select: { id: true, traineeId: true },
    });

    if (!existing) {
      return res.status(404).json({ error: "Script not found." });
    }

    if (!canAccessTrainee(auth, existing.traineeId)) {
      return res.status(403).json({ error: "Access denied." });
    }

    const script = await prisma.accomplishmentScript.update({
      where: { id: scriptId },
      data: {
        title,
        content,
      },
    });

    return res.json(script);
  } catch (err) {
    console.error("updateScript error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

