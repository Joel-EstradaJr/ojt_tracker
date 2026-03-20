// ============================================================
// Express Server Entry Point
// ============================================================

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Server } from "http";
import traineeRoutes from "./routes/trainee.routes";
import logRoutes from "./routes/log.routes";
import supervisorRoutes from "./routes/supervisor.routes";
import exportRoutes from "./routes/export.routes";
import importRoutes from "./routes/import.routes";
import authRoutes from "./routes/auth.routes";
import emailRoutes from "./routes/email.routes";
import settingsRoutes from "./routes/settings.routes";

const app = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ────────────────────────────────────────────────
// Strip surrounding quotes from FRONTEND_URL in case they were
// entered literally in a deployment dashboard (Railway, etc.)
const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/^["']|["']$/g, "");

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

// ── Routes ───────────────────────────────────────────────────
app.use("/api/trainees", traineeRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/supervisors", supervisorRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/import", importRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/settings", settingsRoutes);

// ── Health check ─────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Start ────────────────────────────────────────────────────
const server: Server = app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
});

function shutdown(signal: string) {
  server.close((err?: Error) => {
    if (err) {
      console.error(`Error while closing server on ${signal}:`, err);
      process.exit(1);
    }
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGUSR2", () => shutdown("SIGUSR2"));

export default app;
