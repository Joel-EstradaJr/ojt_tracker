// ============================================================
// Settings Controller — CRUD for SystemSettings singleton
// ============================================================

import { Request, Response } from "express";
import prisma from "../utils/prisma";

const SETTINGS_ID = "default";

/** Ensure the singleton row exists */
async function ensureSettings() {
    return prisma.systemSettings.upsert({
        where: { id: SETTINGS_ID },
        create: { id: SETTINGS_ID },
        update: {},
    });
}

/** GET /api/settings */
export const getSettings = async (_req: Request, res: Response) => {
    try {
        const settings = await ensureSettings();
        return res.json(settings);
    } catch (err) {
        console.error("getSettings error:", err);
        return res.status(500).json({ error: "Failed to fetch settings." });
    }
};

/** PUT /api/settings — admin only */
export const updateSettings = async (req: Request, res: Response) => {
    try {
        const { countEarlyInAsOT, countLateOutAsOT, countEarlyLunchEndAsOT } = req.body;

        await ensureSettings();

        const settings = await prisma.systemSettings.update({
            where: { id: SETTINGS_ID },
            data: {
                ...(typeof countEarlyInAsOT === "boolean" ? { countEarlyInAsOT } : {}),
                ...(typeof countLateOutAsOT === "boolean" ? { countLateOutAsOT } : {}),
                ...(typeof countEarlyLunchEndAsOT === "boolean" ? { countEarlyLunchEndAsOT } : {}),
            },
        });

        return res.json(settings);
    } catch (err) {
        console.error("updateSettings error:", err);
        return res.status(500).json({ error: "Failed to update settings." });
    }
};
