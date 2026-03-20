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

// Helper: normalize name for comparison (trim + lowercase)
function normName(val?: string | null): string {
  return (val ?? "").trim().toLowerCase();
}

// Helper: check for duplicate supervisor by full name within a trainee
async function findDuplicateSupervisor(
  traineeId: string,
  firstName: string,
  lastName: string,
  middleName?: string | null,
  suffix?: string | null,
  excludeId?: string
) {
  const supervisors = await prisma.supervisor.findMany({ where: { traineeId } });
  return supervisors.find((s) => {
    if (excludeId && s.id === excludeId) return false;
    return (
      normName(s.firstName) === normName(firstName) &&
      normName(s.lastName) === normName(lastName) &&
      normName(s.middleName) === normName(middleName) &&
      normName(s.suffix) === normName(suffix)
    );
  });
}

// â”€â”€ Create a supervisor for a trainee â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const createSupervisor = async (req: Request, res: Response) => {
  try {
    const { traineeId } = req.params;
    const { lastName, firstName, middleName, suffix, contactNumber, email } = req.body;

    // Verify trainee exists
    const trainee = await prisma.userProfile.findUnique({ where: { id: traineeId } });
    if (!trainee) {
      return res.status(404).json({ error: "Trainee not found." });
    }

    // Check for duplicate supervisor name
    const dup = await findDuplicateSupervisor(traineeId, firstName, lastName, middleName, suffix);
    if (dup) {
      return res.status(409).json({ error: `A supervisor named "${supervisorDisplayName({ lastName, firstName, middleName, suffix })}" already exists for this trainee.` });
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

// â”€â”€ Get all supervisors for a trainee â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Update a supervisor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const updateSupervisor = async (req: Request, res: Response) => {
  try {
    const { supervisorId: id } = req.params;
    const { lastName, firstName, middleName, suffix, contactNumber, email } = req.body;

    // Get existing supervisor to know traineeId
    const existing = await prisma.supervisor.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Supervisor not found." });
    }

    // Check for duplicate supervisor name (exclude self)
    const dup = await findDuplicateSupervisor(existing.traineeId, firstName, lastName, middleName, suffix, id);
    if (dup) {
      return res.status(409).json({ error: `A supervisor named "${supervisorDisplayName({ lastName, firstName, middleName, suffix })}" already exists for this trainee.` });
    }

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

// â”€â”€ Delete a supervisor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const deleteSupervisor = async (req: Request, res: Response) => {
  try {
    const { supervisorId: id } = req.params;
    await prisma.supervisor.delete({ where: { id } });
    return res.json({ message: "Supervisor deleted." });
  } catch (err) {
    console.error("deleteSupervisor error:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

