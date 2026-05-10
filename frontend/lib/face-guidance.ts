export type FaceBox = { x: number; y: number; width: number; height: number };

export type FrameAnalysis = {
  detectorAvailable: boolean;
  detectorName: "face-api.js" | "FaceDetector" | "none";
  faceCount: number;
  box?: FaceBox;
  brightness: number;
  width: number;
  height: number;
  sharpness: number;
  noise: number;
  blurry: boolean;
  qualityScore: number;
  areaRatio: number;
  centeredness: number;
};

let modelsPromise: Promise<void> | null = null;
let faceApiModule: typeof import("face-api.js") | null = null;

async function getFaceApi() {
  if (!faceApiModule) {
    faceApiModule = await import("face-api.js");
  }
  return faceApiModule;
}

async function loadFaceApiModels(): Promise<void> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      try {
        const faceapi = await getFaceApi();
        await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      } catch {
        modelsPromise = null;
        throw new Error("face-api.js models are unavailable.");
      }
    })();
  }

  return modelsPromise;
}

function getCanvas(video: HTMLVideoElement): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas rendering is unavailable.");
  }
  ctx.drawImage(video, 0, 0, width, height);
  return { canvas, ctx };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function sampleBrightness(ctx: CanvasRenderingContext2D, box?: FaceBox): number {
  const source = box
    ? ctx.getImageData(
      Math.max(0, Math.floor(box.x)),
      Math.max(0, Math.floor(box.y)),
      Math.max(1, Math.floor(box.width)),
      Math.max(1, Math.floor(box.height))
    ).data
    : ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;

  let sum = 0;
  let count = 0;
  const step = 4 * 10;
  for (let i = 0; i < source.length; i += step) {
    const r = source[i];
    const g = source[i + 1];
    const b = source[i + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    count++;
  }
  return count ? sum / count : 0;
}

function estimateSharpness(ctx: CanvasRenderingContext2D, box?: FaceBox): number {
  const x = box ? Math.max(0, Math.floor(box.x)) : 0;
  const y = box ? Math.max(0, Math.floor(box.y)) : 0;
  const w = box ? Math.max(16, Math.floor(box.width)) : ctx.canvas.width;
  const h = box ? Math.max(16, Math.floor(box.height)) : ctx.canvas.height;
  const data = ctx.getImageData(x, y, w, h).data;

  let sum = 0;
  let count = 0;
  const stride = 4;
  const jump = 2;

  for (let yy = jump; yy < h - jump; yy += jump) {
    for (let xx = jump; xx < w - jump; xx += jump) {
      const i = (yy * w + xx) * stride;
      const center = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);

      const lIdx = (yy * w + (xx - 1)) * stride;
      const rIdx = (yy * w + (xx + 1)) * stride;
      const uIdx = ((yy - 1) * w + xx) * stride;
      const dIdx = ((yy + 1) * w + xx) * stride;

      const left = (data[lIdx] * 0.299) + (data[lIdx + 1] * 0.587) + (data[lIdx + 2] * 0.114);
      const right = (data[rIdx] * 0.299) + (data[rIdx + 1] * 0.587) + (data[rIdx + 2] * 0.114);
      const up = (data[uIdx] * 0.299) + (data[uIdx + 1] * 0.587) + (data[uIdx + 2] * 0.114);
      const down = (data[dIdx] * 0.299) + (data[dIdx + 1] * 0.587) + (data[dIdx + 2] * 0.114);

      const laplacian = Math.abs((4 * center) - left - right - up - down);
      sum += laplacian;
      count++;
    }
  }

  return count ? sum / count : 0;
}

function estimateNoise(ctx: CanvasRenderingContext2D, box?: FaceBox): number {
  const x = box ? Math.max(0, Math.floor(box.x)) : 0;
  const y = box ? Math.max(0, Math.floor(box.y)) : 0;
  const w = box ? Math.max(16, Math.floor(box.width)) : ctx.canvas.width;
  const h = box ? Math.max(16, Math.floor(box.height)) : ctx.canvas.height;
  const data = ctx.getImageData(x, y, w, h).data;

  let noiseSum = 0;
  let count = 0;
  const stride = 4;
  const step = 3;

  for (let yy = step; yy < h - step; yy += step) {
    for (let xx = step; xx < w - step; xx += step) {
      const i = (yy * w + xx) * stride;
      const j = (yy * w + (xx + 1)) * stride;

      const c = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
      const r = (data[j] * 0.299) + (data[j + 1] * 0.587) + (data[j + 2] * 0.114);
      noiseSum += Math.abs(c - r);
      count++;
    }
  }

  return count ? noiseSum / count : 0;
}

function normalizeLighting(ctx: CanvasRenderingContext2D): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  let luminanceSum = 0;
  let samples = 0;
  const sampleStep = 4 * 12;
  for (let i = 0; i < data.length; i += sampleStep) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    luminanceSum += (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
    samples++;
  }

  const avgLum = samples ? luminanceSum / samples : 110;
  const gain = clamp(128 / Math.max(40, avgLum), 0.78, 1.38);

  for (let i = 0; i < data.length; i += 4) {
    const r = clamp(data[i] * gain, 0, 255);
    const g = clamp(data[i + 1] * gain, 0, 255);
    const b = clamp(data[i + 2] * gain, 0, 255);

    data[i] = clamp(((r - 128) * 1.08) + 128, 0, 255);
    data[i + 1] = clamp(((g - 128) * 1.08) + 128, 0, 255);
    data[i + 2] = clamp(((b - 128) * 1.08) + 128, 0, 255);
  }

  ctx.putImageData(imageData, 0, 0);
}

function applyMildSharpen(ctx: CanvasRenderingContext2D, amount = 0.2): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const source = ctx.getImageData(0, 0, width, height);
  const src = source.data;
  const out = new Uint8ClampedArray(src);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = src[i + c] * 5;
        const left = src[i - 4 + c];
        const right = src[i + 4 + c];
        const up = src[i - (width * 4) + c];
        const down = src[i + (width * 4) + c];
        const sharpened = center - left - right - up - down;
        out[i + c] = clamp(src[i + c] + (sharpened * amount), 0, 255);
      }
    }
  }

  ctx.putImageData(new ImageData(out, width, height), 0, 0);
}

function buildQualityMetrics(ctx: CanvasRenderingContext2D, box: FaceBox | undefined, width: number, height: number) {
  const brightness = sampleBrightness(ctx, box);
  const sharpness = estimateSharpness(ctx, box);
  const noise = estimateNoise(ctx, box);
  const areaRatio = box ? (box.width * box.height) / Math.max(1, width * height) : 0;

  const centerX = box ? (box.x + (box.width / 2)) / Math.max(1, width) : 0;
  const centerY = box ? (box.y + (box.height / 2)) / Math.max(1, height) : 0;
  const centeredness = box ? Math.sqrt(((centerX - 0.5) ** 2) + ((centerY - 0.5) ** 2)) : 1;

  const blurThreshold = brightness < 85 ? 10 : 13;
  const blurry = sharpness < blurThreshold;

  const brightnessScore = clamp(brightness / 130, 0, 1);
  const sharpnessScore = clamp(sharpness / 28, 0, 1);
  const noiseScore = 1 - clamp(noise / 26, 0, 1);
  const centerScore = 1 - clamp(centeredness / 0.42, 0, 1);
  const qualityScore = clamp((brightnessScore * 0.2) + (sharpnessScore * 0.4) + (noiseScore * 0.2) + (centerScore * 0.2), 0, 1);

  return {
    brightness,
    sharpness,
    noise,
    blurry,
    qualityScore,
    areaRatio,
    centeredness,
  };
}

export async function analyzeFrame(video: HTMLVideoElement): Promise<FrameAnalysis> {
  const { canvas, ctx } = getCanvas(video);
  const width = canvas.width;
  const height = canvas.height;

  normalizeLighting(ctx);

  try {
    await loadFaceApiModels();
    const faceapi = await getFaceApi();

    const baseBrightness = sampleBrightness(ctx);
    const inputSize = width < 720 ? 320 : 416;
    const scoreThreshold = baseBrightness < 70 ? 0.1 : baseBrightness < 105 ? 0.13 : 0.17;
    const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold });

    const faces = await faceapi.detectAllFaces(canvas, detectorOptions);
    const sortedFaces = [...faces].sort((a, b) => (b.box.width * b.box.height) - (a.box.width * a.box.height));
    const selectedFace = sortedFaces[0] ?? null;

    const box = selectedFace?.box;
    const normalizedBox = box
      ? { x: box.x, y: box.y, width: box.width, height: box.height }
      : undefined;

    const metrics = buildQualityMetrics(ctx, normalizedBox, width, height);

    return {
      detectorAvailable: true,
      detectorName: "face-api.js",
      faceCount: faces.length,
      box: normalizedBox,
      width,
      height,
      ...metrics,
    };
  } catch {
    const FaceDetectorCtor = (globalThis as typeof globalThis & { FaceDetector?: new (options?: unknown) => { detect: (source: HTMLCanvasElement | HTMLVideoElement) => Promise<Array<{ boundingBox: DOMRectReadOnly }>> } }).FaceDetector;
    if (!FaceDetectorCtor) {
      const metrics = buildQualityMetrics(ctx, undefined, width, height);
      return {
        detectorAvailable: false,
        detectorName: "none",
        faceCount: 0,
        box: undefined,
        width,
        height,
        ...metrics,
      };
    }

    try {
      const detector = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 2 });
      const faces = await detector.detect(canvas);
      const first = faces[0];
      const box = first?.boundingBox
        ? { x: first.boundingBox.x, y: first.boundingBox.y, width: first.boundingBox.width, height: first.boundingBox.height }
        : undefined;

      const metrics = buildQualityMetrics(ctx, box, width, height);
      return {
        detectorAvailable: true,
        detectorName: "FaceDetector",
        faceCount: faces.length,
        box,
        width,
        height,
        ...metrics,
      };
    } catch {
      const metrics = buildQualityMetrics(ctx, undefined, width, height);
      return {
        detectorAvailable: false,
        detectorName: "none",
        faceCount: 0,
        box: undefined,
        width,
        height,
        ...metrics,
      };
    }
  }
}

export function captureFrame(video: HTMLVideoElement, quality = 0.9): string {
  const canvas = document.createElement("canvas");
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 480;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas rendering is unavailable.");
  }

  ctx.filter = "brightness(1.08) contrast(1.12) saturate(1.04)";
  ctx.drawImage(video, 0, 0, width, height);
  ctx.filter = "none";

  normalizeLighting(ctx);
  applyMildSharpen(ctx, 0.16);

  return canvas.toDataURL("image/jpeg", quality);
}
