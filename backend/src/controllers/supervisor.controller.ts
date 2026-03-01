// ============================================================
// Supervisor Controller
// Handles CRUD for supervisors belonging to a trainee.
// ============================================================

import { Request, Response } from "express";
import prisma from "../utils/prisma";

// Build display name for a supervisor
function supervisorDisplayName(s: { lastName: string; firstName: string; middleName?: string | null; suffix?: string | null }) {
  const parts = [s.firstName];
  if (s.middleName) parts.push(s.middleName);
  parts.push(s.lastName);
  if (s.suffix) parts.push(s.suffix);
  return parts.join(" ");
}

// ── Create a supervisor for a trainee ────────────────────────
export const createSupervisor = async (req: Request, res: Response) => {
  try {
    const { traineeId } = req.params;
    const { lastName, firstName, middleName, suffix, contactNumber, email } = req.body;

    // Verify trainee exists
    const trainee = await prisma.trainee.findUnique({ where: { id: traineeId } });
    if (!trainee) {
      return res.status(404).json({ error: "Trainee not found." });
    }

    const supervisor = await prisma.supervisor.create({
      data: {
        traineeId,
        lastName,
        firstName,
        middleName: middleName || null,
        suffix: suffix || null,
        contactNumber: contactNumber || null,
        email: email || null,
      },
    });

    return res.status(201).json({ ...supervisor, displayName: supervisorDisplayName(supervisor) });
  } catch (err) {
    console.error("createSupervisor error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Get all supervisors for a trainee ────────────────────────
export const getSupervisorsByTrainee = async (req: Request, res: Response) => {
  try {
    const { traineeId } = req.params;

    const supervisors = await prisma.supervisor.findMany({
      where: { traineeId },
      orderBy: { createdAt: "asc" },
    });

    return res.json(supervisors.map((s) => ({ ...s, displayName: supervisorDisplayName(s) })));
  } catch (err) {
    console.error("getSupervisorsByTrainee error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Update a supervisor ──────────────────────────────────────
export const updateSupervisor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { lastName, firstName, middleName, suffix, contactNumber, email } = req.body;

    const supervisor = await prisma.supervisor.update({
      where: { id },
      data: {
        lastName,
        firstName,
        middleName: middleName || null,
        suffix: suffix || null,
        contactNumber: contactNumber || null,
        email: email || null,
      },
    });

    return res.json({ ...supervisor, displayName: supervisorDisplayName(supervisor) });
  } catch (err) {
    console.error("updateSupervisor error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

// ── Delete a supervisor ──────────────────────────────────────
export const deleteSupervisor = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.supervisor.delete({ where: { id } });
    return res.json({ message: "Supervisor deleted." });
  } catch (err) {
    console.error("deleteSupervisor error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};
