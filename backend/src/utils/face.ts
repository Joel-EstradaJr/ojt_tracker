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

export const FACE_SERVICE_UNAVAILABLE_MESSAGE = "Face recognition service unavailable";
export const FACE_MIN_CONFIDENCE = 0.75;
export const FACE_MATCH_THRESHOLD = 0.85;
export const FACE_LIVENESS_STDDEV_THRESHOLD = 0.001;
export const MIN_FACE_FRAMES = 5;

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
  return getEnvNumber("FACE_MATCH_THRESHOLD", FACE_MATCH_THRESHOLD);
}

function getOpenFaceTimeoutMs(): number {
  return getEnvNumber("OPENFACE_TIMEOUT_MS", 20_000);
}

function getOpenFaceMinConfidence(): number {
  return getEnvNumber("OPENFACE_MIN_CONFIDENCE", 0.75);
}

function getOpenFaceSimSize(): number {
  return getEnvNumber("OPENFACE_SIMSIZE", 112);
}

function getOpenFaceSimScale(): number {
  return getEnvNumber("OPENFACE_SIM_SCALE", 0.7);
}

// Minimum embedding variance across multi-frame submissions.
// If the max pairwise distance is below this, all frames are
// identical → static photo / screen replay.
function getLivenessMinVariance(): number {
  return getEnvNumber("FACE_LIVENESS_MIN_VARIANCE", 0.01);
}

// ── Runtime OpenFace availability gate ──────────────────────
// Set once at startup after the readiness check passes.
// Cleared if a runtime operation fails with a spawn/ENOENT error.
let openFaceAvailable = false;

export function setOpenFaceReady(ready: boolean): void {
  openFaceAvailable = ready;
}

export function isOpenFaceReady(): boolean {
  return openFaceAvailable;
}

/**
 * Guard function — call before any face operation.
 * Throws a descriptive error (caught as 503) if OpenFace is unavailable.
 */
export function requireOpenFace(): void {
  if (getFaceEngine() === "off") {
    throw new Error(FACE_SERVICE_UNAVAILABLE_MESSAGE);
  }
  if (!openFaceAvailable) {
    throw new Error(FACE_SERVICE_UNAVAILABLE_MESSAGE);
  }
}

// ── Vector math ─────────────────────────────────────────────

function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) return vec;
  return vec.map((v) => v / norm);
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
  if (message.includes("low confidence")) {
    return "Face detection confidence is too low. Please ensure good lighting and look directly at the camera.";
  }
  if (message.includes("liveness")) {
    return "Liveness check failed. Please use a live camera, not a photo or screen.";
  }

  return FACE_SERVICE_UNAVAILABLE_MESSAGE;
}

export function isFaceServiceUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error || "").toLowerCase();
  return (
    message.includes("enoent")
    || message.includes("spawn")
    || message.includes("timed out")
    || message.includes("not configured")
    || message.includes("openface")
    || message.includes("failed to spawn")
    || message.includes("not available")
  );
}

function toNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : Number.NaN;
}

function toNullableNum(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract ONLY 2D facial landmark columns (x_0..x_67, y_0..y_67).
 *
 * WHY: The previous implementation grabbed ALL feature columns including
 * pose_Tx/Ty/Tz, gaze_angle_x/y, and AU01_r..AU45_r. These encode
 * expression and head orientation — NOT identity. Two different people
 * with the same expression and pose would produce nearly identical
 * "embeddings", which is why face login was accepting any face.
 *
 * 2D landmarks encode facial bone structure (eye spacing, nose bridge
 * width, jaw shape) which IS identity-discriminative.
 */
function listLandmarkColumns(headers: string[]): string[] {
  return headers.filter((h) => {
    // Match x_0..x_63 and y_0..y_63 to produce a 128-dim embedding.
    if (/^[xy]_\d+$/.test(h)) {
      const idx = parseInt(h.split("_")[1], 10);
      return idx >= 0 && idx <= 63;
    }
    return false;
  });
}

/**
 * Normalize 2D landmarks to be position- and scale-invariant.
 *
 * Steps:
 * 1. Extract x[] and y[] arrays from the raw landmark values
 * 2. Center on the nose tip (landmark 30)
 * 3. Scale by inter-ocular distance (distance between outer eye corners,
 *    landmarks 36 and 45) so the embedding doesn't change with distance
 *    from the camera
 * 4. Flatten back to [x0,y0, x1,y1, ...] and L2-normalize
 */
function normalizeLandmarks(landmarkValues: number[], landmarkColumns: string[]): number[] {
  // Separate into x and y arrays, indexed by landmark number.
  const xs: number[] = new Array(64).fill(0);
  const ys: number[] = new Array(64).fill(0);

  for (let i = 0; i < landmarkColumns.length; i++) {
    const col = landmarkColumns[i];
    const axis = col[0]; // 'x' or 'y'
    const idx = parseInt(col.split("_")[1], 10);
    if (axis === "x") xs[idx] = landmarkValues[i];
    else ys[idx] = landmarkValues[i];
  }

  // Center on nose tip (landmark 30)
  const noseX = xs[30];
  const noseY = ys[30];
  for (let i = 0; i < 64; i++) {
    xs[i] -= noseX;
    ys[i] -= noseY;
  }

  // Scale by inter-ocular distance (landmarks 36=left eye outer, 45=right eye outer)
  const iod = Math.sqrt((xs[36] - xs[45]) ** 2 + (ys[36] - ys[45]) ** 2);
  const scale = iod > 1e-6 ? iod : 1; // Prevent division by zero
  for (let i = 0; i < 64; i++) {
    xs[i] /= scale;
    ys[i] /= scale;
  }

  // Flatten to interleaved [x0,y0, x1,y1, ...].
  const flat: number[] = [];
  for (let i = 0; i < 64; i++) {
    flat.push(xs[i], ys[i]);
  }

  return l2Normalize(flat);
}

function pickSingleFaceRow(rows: OpenFaceRow[]): OpenFaceRow {
  if (!rows.length) throw new Error("No face detected.");

  const successful = rows.filter((r) => String(r.success || "").trim() === "1");
  if (!successful.length) throw new Error("No face detected.");

  const minConfidence = getOpenFaceMinConfidence();
  const highConfidence = successful.filter((r) => toNum(r.confidence) >= minConfidence);

  if (!highConfidence.length) {
    throw new Error("No face detected.");
  }

  const candidates = highConfidence;

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
    "-2Dfp",
    "-pose",
    "-aus",
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
      // Mark OpenFace as unavailable on spawn failure
      setOpenFaceReady(false);
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

  // ── Identity embedding from 2D landmarks only ──────────────
  // BUG FIX: Previously used listFeatureColumns() which grabbed
  // pose, gaze, AUs, AND landmarks. Now we ONLY use 2D landmarks
  // for identity-discriminative matching.
  const landmarkColumns = listLandmarkColumns(headers);
  if (landmarkColumns.length !== 128) {
    throw new Error("OpenFace did not return sufficient facial landmark data.");
  }

  const landmarkValues = landmarkColumns.map((c) => toNum(row[c]));
  if (landmarkValues.some((n) => !Number.isFinite(n))) {
    throw new Error("Invalid landmark values from OpenFace output.");
  }

  const embedding = normalizeLandmarks(landmarkValues, landmarkColumns);

  // ── Action Units (kept for liveness/expression analysis) ───
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
  // Runtime guard: reject if OpenFace is not available
  requireOpenFace();

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
    }, 15_000);

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
  // Runtime guard
  requireOpenFace();

  const normalized = normalizeImageBase64(imageBase64);
  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(normalized, "base64");
  } catch {
    throw new Error("Invalid face image encoding.");
  }

  const analysis = await analyzeFaceImageBuffer(imageBuffer);

  if (analysis.confidence < FACE_MIN_CONFIDENCE) {
    throw new Error("No face detected.");
  }

  return analysis.similarityReadyEmbedding;
}

export async function verifyFaceMatch(imageBase64OrFrames: string | string[], storedEmbedding: unknown): Promise<{ match: boolean; similarity: number; liveEmbedding: number[] }> {
  // BUG FIX: Previously, if storedEmbedding was missing/invalid,
  // the error was thrown but could be caught upstream and ignored.
  // Now we are explicit: no enrollment = no match, period.
  if (!isNumberArray(storedEmbedding)) {
    throw new Error("Face is not enrolled for this account.");
  }

  const probe = Array.isArray(imageBase64OrFrames)
    ? await extractAveragedEmbeddingFromFrames(imageBase64OrFrames)
    : await fetchFaceEmbedding(imageBase64OrFrames);

  // Dimension mismatch means the stored embedding was from the old
  // format (pose+gaze+AU) and needs re-enrollment.
  if (probe.length !== storedEmbedding.length) {
    throw new Error(
      "Stored face data is incompatible (dimension mismatch). Please re-enroll your face."
    );
  }

  const similarity = cosineSimilarity(storedEmbedding, probe);
  const threshold = getFaceMatchThreshold();
  return { match: similarity >= threshold, similarity, liveEmbedding: probe };
}

// ── Multi-frame enrollment ──────────────────────────────────

/**
 * Enroll a face from multiple frames.
 *
 * Requirements:
 * - At least 3 frames
 * - No more than 1 frame may fail face detection
 * - Embeddings must show natural liveness variation (not a static photo)
 * - Final embedding is the average of all valid per-frame embeddings
 */
export async function enrollFromMultipleFrames(framesBase64: string[]): Promise<number[]> {
  requireOpenFace();

  if (framesBase64.length < MIN_FACE_FRAMES) {
    throw new Error(`At least ${MIN_FACE_FRAMES} face frames are required.`);
  }

  const embeddings = await extractFrameEmbeddingsFromFrames(framesBase64);

  // Liveness check: ensure embeddings are NOT perfectly identical
  checkLivenessFromEmbeddings(embeddings);

  // Average all valid embeddings
  const dim = embeddings[0].length;
  const averaged = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) {
      averaged[i] += emb[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    averaged[i] /= embeddings.length;
  }

  return l2Normalize(averaged);
}

/**
 * Liveness check: reject if all embeddings across frames are
 * perfectly identical, which indicates a static photo or screen.
 *
 * A live face will always show slight natural variation in
 * landmark positions across frames due to micro-movements.
 */
export function checkLivenessFromEmbeddings(embeddings: number[][]): void {
  if (embeddings.length < 2) return;

  const dimensionCount = embeddings[0].length;
  const frameCount = embeddings.length;
  const means = new Array(dimensionCount).fill(0);

  for (const embedding of embeddings) {
    for (let i = 0; i < dimensionCount; i++) {
      means[i] += embedding[i];
    }
  }

  for (let i = 0; i < dimensionCount; i++) {
    means[i] /= frameCount;
  }

  let varianceSum = 0;
  for (let i = 0; i < dimensionCount; i++) {
    let dimensionVariance = 0;
    for (const embedding of embeddings) {
      const diff = embedding[i] - means[i];
      dimensionVariance += diff * diff;
    }
    dimensionVariance /= frameCount;
    varianceSum += dimensionVariance;
  }

  const averageStdDev = Math.sqrt(varianceSum / dimensionCount);
  if (averageStdDev < FACE_LIVENESS_STDDEV_THRESHOLD) {
    throw new Error("Static image detected — liveness check failed");
  }
}

async function extractFrameEmbeddingsFromFrames(framesBase64: string[]): Promise<number[][]> {
  if (!framesBase64.length) {
    throw new Error("No face detected.");
  }

  // Allow a limited number of bad frames (blur/motion/no-face) so low-end webcams
  // can still pass as long as there are enough usable frames.
  const minSuccessfulFrames = Math.max(4, Math.ceil(framesBase64.length * 0.7));
  const maxFailures = Math.max(1, framesBase64.length - minSuccessfulFrames);

  const embeddings: number[][] = [];
  let failures = 0;
  for (const frame of framesBase64) {
    try {
      embeddings.push(await fetchFaceEmbedding(frame));
    } catch {
      failures += 1;
      if (failures > maxFailures) {
        throw new Error("No face detected.");
      }
    }
  }

  if (embeddings.length < minSuccessfulFrames) {
    throw new Error("No face detected.");
  }

  return embeddings;
}

async function extractAveragedEmbeddingFromFrames(framesBase64: string[]): Promise<number[]> {
  const embeddings = await extractFrameEmbeddingsFromFrames(framesBase64);

  checkLivenessFromEmbeddings(embeddings);

  const dimensionCount = embeddings[0].length;
  const averaged = new Array(dimensionCount).fill(0);
  for (const embedding of embeddings) {
    for (let i = 0; i < dimensionCount; i++) {
      averaged[i] += embedding[i];
    }
  }

  for (let i = 0; i < dimensionCount; i++) {
    averaged[i] /= embeddings.length;
  }

  return l2Normalize(averaged);
}

export function hashEmbedding(embedding: number[]): string {
  // Helpful for debugging without storing/printing the embedding itself.
  return crypto.createHash("sha256").update(JSON.stringify(embedding)).digest("hex");
}
