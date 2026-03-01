// ============================================================
// Express Server Entry Point
// ============================================================

import express from "express";
import cors from "cors";
import traineeRoutes from "./routes/trainee.routes";
import logRoutes from "./routes/log.routes";
import supervisorRoutes from "./routes/supervisor.routes";
import exportRoutes from "./routes/export.routes";
import importRoutes from "./routes/import.routes";

const app = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);
app.use(express.json());

// ── Routes ───────────────────────────────────────────────────
app.use("/trainees", traineeRoutes);
app.use("/logs", logRoutes);
app.use("/supervisors", supervisorRoutes);
app.use("/export", exportRoutes);
app.use("/import", importRoutes);

// ── Health check ─────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});

export default app;
