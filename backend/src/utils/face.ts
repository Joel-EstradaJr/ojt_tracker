import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { parse } from "csv-parse/sync";

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getEnvBool(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

export type FaceEngine = "openface-cli" | "off";

export function getFaceEngine(): FaceEngine {
  const forced = String(process.env.FACE_ENGINE || "").trim().toLowerCase();
  if (forced === "off") return "off";
  return "openface-cli";
}

export function getOpenFaceBinaryPath(): string {
  const fromEnv = String(process.env.OPENFACE_CLI_PATH || "").trim();
  if (fromEnv) return fromEnv;
  return "FeatureExtraction";
}

export function getFaceMatchThreshold(): number {
  // OpenFace feature-vector embeddings are cosine-compared in [−1, 1].
  return getEnvNumber("FACE_MATCH_THRESHOLD", 0.85);
}

function getOpenFaceTimeoutMs(): number {
  return getEnvNumber("OPENFACE_TIMEOUT_MS", 20_000);
}

function getOpenFaceMinConfidence(): number {
  return getEnvNumber("OPENFACE_MIN_CONFIDENCE", 0.9);
}

function getOpenFaceSimSize(): number {
  return getEnvNumber("OPENFACE_SIMSIZE", 112);
}

function getOpenFaceSimScale(): number {
  return getEnvNumber("OPENFACE_SIM_SCALE", 0.7);
}

function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

type OpenFaceRow = Record<string, string>;

type OpenFaceRunResult = {
  outDir: string;
  csvPath: string;
  stderr: string;
};

export type FaceAnalysis = {
  success: boolean;
  confidence: number;
  faceId: string | null;
  similarityReadyEmbedding: number[];
  pose: {
    tx: number | null;
    ty: number | null;
    tz: number | null;
    rx: number | null;
    ry: number | null;
    rz: number | null;
  };
  gaze: {
    angleX: number | null;
    angleY: number | null;
  };
  actionUnits: Record<string, number>;
};

export function mapFaceErrorToUserMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.includes("no face detected")) {
    return "No face was detected. Please look at the camera and try again.";
  }
  if (message.includes("multiple faces")) {
    return "Multiple faces were detected. Please ensure only one face is visible.";
  }
  if (message.includes("invalid face image") || message.includes("invalid face image encoding")) {
    return "The captured image is invalid. Please retake your photo.";
  }

  return "Face recognition is temporarily unavailable. Please try again later.";
}

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function toNullableNum(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function listFeatureColumns(headers: string[]): string[] {
  const excluded = new Set(["frame", "face_id", "timestamp", "confidence", "success"]);
  const prefixes = ["x_", "y_", "X_", "Y_", "Z_", "p_", "pose_", "gaze_", "AU"];
  return headers.filter((h) => !excluded.has(h) && prefixes.some((p) => h.startsWith(p)));
}

function pickSingleFaceRow(rows: OpenFaceRow[]): OpenFaceRow {
  if (!rows.length) throw new Error("No face detected.");

  const successful = rows.filter((r) => String(r.success || "").trim() === "1");
  if (!successful.length) throw new Error("No face detected.");

  const minConfidence = getOpenFaceMinConfidence();
  const highConfidence = successful.filter((r) => toNum(r.confidence) >= minConfidence);
  const candidates = highConfidence.length ? highConfidence : successful;

  const faceIds = new Set(candidates.map((r) => String(r.face_id || "").trim()).filter(Boolean));
  if (faceIds.size > 1) {
    throw new Error("Multiple faces detected. Use an image with exactly one face.");
  }

  const uniqueFrames = new Set(candidates.map((r) => String(r.frame || "").trim()).filter(Boolean));
  if (uniqueFrames.size > 1) {
    throw new Error("Multiple faces detected. Use an image with exactly one face.");
  }

  return candidates[0];
}

async function findFirstCsvFile(root: string): Promise<string | null> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFirstCsvFile(full);
      if (nested) return nested;
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) return full;
  }
  return null;
}

async function runOpenFaceCli(imagePath: string): Promise<OpenFaceRunResult> {
  const tempOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "openface-out-"));
  const binary = getOpenFaceBinaryPath();

  const args = [
    "-f", imagePath,
    "-out_dir", tempOutDir,
    "-of", "probe",
    "-2Dfp",
    "-3Dfp",
    "-pose",
    "-gaze",
    "-aus",
    "-simalign",
    "-simsize", String(getOpenFaceSimSize()),
    "-simscale", String(getOpenFaceSimScale()),
    "-nomask",
  ];

  const timeoutMs = getOpenFaceTimeoutMs();
  const debug = getEnvBool("OPENFACE_DEBUG", false);

  let stderr = "";
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: debug ? "inherit" : ["ignore", "ignore", "pipe"],
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    if (!debug && child.stderr) {
      child.stderr.on("data", (buf: Buffer) => {
        stderr += buf.toString("utf8");
      });
    }

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`OpenFace timed out after ${timeoutMs} ms.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || "OpenFace failed to process image."));
        return;
      }
      resolve();
    });
  });

  const csvPath = await findFirstCsvFile(tempOutDir);
  if (!csvPath) {
    await fs.rm(tempOutDir, { recursive: true, force: true });
    throw new Error("OpenFace did not produce CSV output.");
  }

  return { outDir: tempOutDir, csvPath, stderr };
}

async function parseOpenFaceCsv(csvPath: string): Promise<FaceAnalysis> {
  const csvText = await fs.readFile(csvPath, "utf8");
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as OpenFaceRow[];

  const row = pickSingleFaceRow(rows);
  const headers = Object.keys(row);
  const featureColumns = listFeatureColumns(headers);
  if (!featureColumns.length) {
    throw new Error("OpenFace did not return usable facial features.");
  }

  const values = featureColumns.map((c) => toNum(row[c]));
  if (values.some((n) => !Number.isFinite(n))) {
    throw new Error("Invalid feature vector from OpenFace output.");
  }

  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const centered = values.map((v) => v - mean);
  const variance = centered.reduce((s, v) => s + v * v, 0) / centered.length;
  const std = Math.sqrt(variance) || 1;
  const embedding = l2Normalize(centered.map((v) => v / std));

  const actionUnits: Record<string, number> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith("AU")) {
      const parsed = toNum(value);
      if (Number.isFinite(parsed)) actionUnits[key] = parsed;
    }
  }

  return {
    success: String(row.success || "").trim() === "1",
    confidence: toNum(row.confidence),
    faceId: row.face_id ? String(row.face_id) : null,
    similarityReadyEmbedding: embedding,
    pose: {
      tx: toNullableNum(row.pose_Tx),
      ty: toNullableNum(row.pose_Ty),
      tz: toNullableNum(row.pose_Tz),
      rx: toNullableNum(row.pose_Rx),
      ry: toNullableNum(row.pose_Ry),
      rz: toNullableNum(row.pose_Rz),
    },
    gaze: {
      angleX: toNullableNum(row.gaze_angle_x),
      angleY: toNullableNum(row.gaze_angle_y),
    },
    actionUnits,
  };
}

export async function analyzeFaceImageBuffer(imageBuffer: Buffer): Promise<FaceAnalysis> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openface-in-"));
  const imagePath = path.join(tempDir, "probe.jpg");

  try {
    await fs.writeFile(imagePath, imageBuffer);
    const { outDir, csvPath } = await runOpenFaceCli(imagePath);
    try {
      return await parseOpenFaceCsv(csvPath);
    } finally {
      await fs.rm(outDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function checkOpenFaceReady(): Promise<boolean> {
  return (await checkOpenFaceAvailability()).ready;
}

export async function checkOpenFaceAvailability(): Promise<{ ready: boolean; reason?: string }> {
  const binary = getOpenFaceBinaryPath();
  return new Promise<{ ready: boolean; reason?: string }>((resolve) => {
    const child = spawn(binary, ["-help"], { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ready: false, reason: "OpenFace CLI readiness check timed out." });
    }, 4000);

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ready: false, reason: err instanceof Error ? err.message : "Failed to spawn OpenFace CLI." });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      // Some binaries return non-zero for help; process spawn success is enough.
      if (code !== null) {
        resolve({ ready: true });
        return;
      }
      resolve({ ready: false, reason: "OpenFace CLI exited unexpectedly." });
    });
  });
}

export function normalizeImageBase64(input: string): string {
  const trimmed = input.trim();
  // Accept either raw base64 or a data URL.
  const withoutPrefix = trimmed.startsWith("data:")
    ? trimmed.replace(/^data:[^;]+;base64,/, "")
    : trimmed;
  return withoutPrefix.replace(/\s/g, "");
}

export function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((x) => typeof x === "number" && Number.isFinite(x));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(denom) || denom === 0) return -1;
  return dot / denom;
}

export async function fetchFaceEmbedding(imageBase64: string): Promise<number[]> {
  const engine = getFaceEngine();
  if (engine === "off") throw new Error("Face recognition service is not configured.");

  const normalized = normalizeImageBase64(imageBase64);
  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(normalized, "base64");
  } catch {
    throw new Error("Invalid face image encoding.");
  }

  const analysis = await analyzeFaceImageBuffer(imageBuffer);
  return analysis.similarityReadyEmbedding;
}

export async function verifyFaceMatch(imageBase64: string, storedEmbedding: unknown): Promise<{ match: boolean; similarity: number }> {
  if (!isNumberArray(storedEmbedding)) {
    throw new Error("Face is not enrolled for this account.");
  }

  const probe = await fetchFaceEmbedding(imageBase64);
  const similarity = cosineSimilarity(storedEmbedding, probe);
  const threshold = getFaceMatchThreshold();
  return { match: similarity >= threshold, similarity };
}

export function hashEmbedding(embedding: number[]): string {
  // Helpful for debugging without storing/printing the embedding itself.
  return crypto.createHash("sha256").update(JSON.stringify(embedding)).digest("hex");
}
