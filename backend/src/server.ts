// ============================================================
// Express Server Entry Point
// ============================================================

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import yaml from "yaml";

// Load backend/.env for local dev and self-hosted runs. In hosted environments,
// this file typically doesn't exist and dotenv will do nothing.
dotenv.config({ path: path.join(__dirname, "..", ".env") });

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Server } from "http";
import swaggerUi from "swagger-ui-express";
import traineeRoutes from "./routes/trainee.routes";
import logRoutes from "./routes/log.routes";
import supervisorRoutes from "./routes/supervisor.routes";
import exportRoutes from "./routes/export.routes";
import importRoutes from "./routes/import.routes";
import authRoutes from "./routes/auth.routes";
import emailRoutes from "./routes/email.routes";
import settingsRoutes from "./routes/settings.routes";
import scriptRoutes from "./routes/script.routes";
import backupRoutes from "./routes/backup.routes";
import faceRoutes from "./routes/face.routes";
import entityRoutes from "./routes/entity.routes";

const app = express();
const PORT = process.env.PORT || 4000;
const DOCS_ENABLED = String(process.env.DOC_ENABLE).toLowerCase() === "true";

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
// Base64 images for face recognition can be large; raise the JSON body limit.
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// ── API docs (OpenAPI + Swagger UI + Redoc) ───────────────
if (DOCS_ENABLED) {
  const specPath = path.join(__dirname, "..", "openapi.yaml");
  const rawSpec = fs.readFileSync(specPath, "utf8");
  const openApiSpec = yaml.parse(rawSpec);

  app.get("/openapi.json", (_req, res) => {
    res.json(openApiSpec);
  });

  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, { explorer: true }));

  app.get("/redoc", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html>
  <head>
    <title>OJT Tracker API Docs</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; padding: 0; }
    </style>
  </head>
  <body>
    <redoc spec-url="/openapi.json"></redoc>
    <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`);
  });
}

// ── Routes ───────────────────────────────────────────────────
app.use("/api/trainees", traineeRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/supervisors", supervisorRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/import", importRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/scripts", scriptRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api/face", faceRoutes);
app.use("/api/entities", entityRoutes);

// ── Health check ─────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ── Start ────────────────────────────────────────────────────
const server: Server = app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
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
