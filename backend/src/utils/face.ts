import crypto from "crypto";

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

export function getFaceMatchThreshold(): number {
  // ArcFace cosine similarity is typically ~0.3–0.5 depending on model/data.
  return getEnvNumber("FACE_MATCH_THRESHOLD", 0.35);
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
  const baseUrl = getFaceServiceUrl();
  if (!baseUrl) {
    throw new Error("Face recognition service is not configured.");
  }

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
