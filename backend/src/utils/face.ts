import crypto from "crypto";
import Jimp from "jimp";

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getFaceServiceUrl(): string | null {
  const url = process.env.FACE_SERVICE_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

export type FaceEngine = "remote" | "local" | "off";

export function getFaceEngine(): FaceEngine {
  const forced = String(process.env.FACE_ENGINE || "").trim().toLowerCase();
  if (forced === "off") return "off";
  if (forced === "local") return "local";
  if (forced === "remote") return getFaceServiceUrl() ? "remote" : "off";

  // Default behavior: remote when URL is provided, otherwise off.
  return getFaceServiceUrl() ? "remote" : "off";
}

export function getFaceMatchThreshold(): number {
  // OpenFace-aligned-image embedding (normalized pixels) tends to have higher cosine similarity.
  return getEnvNumber("FACE_MATCH_THRESHOLD", 0.85);
}

function l2Normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

async function computeLocalEmbedding(imageBase64: string): Promise<number[]> {
  const size = getEnvNumber("FACE_LOCAL_SIZE", 64);
  if (!Number.isFinite(size) || size < 8 || size > 256) {
    throw new Error("Invalid FACE_LOCAL_SIZE.");
  }

  const normalized = normalizeImageBase64(imageBase64);
  let buf: Buffer;
  try {
    buf = Buffer.from(normalized, "base64");
  } catch {
    throw new Error("Invalid face image encoding.");
  }

  let img: Jimp;
  try {
    img = await Jimp.read(buf);
  } catch {
    throw new Error("Invalid face image.");
  }

  img.resize(size, size, Jimp.RESIZE_BILINEAR);
  img.grayscale();

  const data = img.bitmap.data; // RGBA
  const out = new Array<number>(size * size);

  // First pass: collect intensities and compute mean.
  let mean = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const v = data[i] / 255; // after grayscale, R==G==B
    out[p] = v;
    mean += v;
  }
  mean /= out.length;

  // Second pass: variance.
  let varSum = 0;
  for (let i = 0; i < out.length; i++) {
    const d = out[i] - mean;
    varSum += d * d;
  }
  const std = Math.sqrt(varSum / out.length) || 1;

  // Standardize.
  for (let i = 0; i < out.length; i++) {
    out[i] = (out[i] - mean) / std;
  }

  return l2Normalize(out);
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
  if (engine === "local") return computeLocalEmbedding(imageBase64);

  const baseUrl = getFaceServiceUrl();
  if (!baseUrl) throw new Error("Face recognition service is not configured.");

  let res: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    res = await fetch(`${baseUrl}/v1/face/embedding`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_base64: normalizeImageBase64(imageBase64) }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    throw new Error("Face recognition service is unreachable.");
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const record = body as Record<string, unknown>;
    const msg = record?.error ?? record?.detail;
    throw new Error(typeof msg === "string" && msg ? msg : "Face recognition failed.");
  }

  const embedding = (body as Record<string, unknown>)?.embedding;
  if (!isNumberArray(embedding)) {
    throw new Error("Invalid embedding returned by face service.");
  }

  return embedding;
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
