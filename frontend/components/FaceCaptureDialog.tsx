"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { analyzeFrame, captureFrame, type FaceBox, type FrameAnalysis } from "@/lib/face-guidance";

type CaptureMode = "enroll" | "verify";

type Props = {
  open: boolean;
  title: string;
  confirmLabel: string;
  busy?: boolean;
  errorMessage?: string;
  mode?: CaptureMode;
  onCancel: () => void;
  onConfirm: (frames: string[]) => void | Promise<void>;
};

type GuideTone = "red" | "orange" | "yellow" | "green";

type CaptureStepId = "straight" | "left" | "right" | "up" | "down";

type Baseline = {
  centerX: number;
  centerY: number;
  areaRatio: number;
};

type CaptureStep = {
  id: CaptureStepId;
  label: string;
  prompt: string;
  perStepFrames: number;
  validatePose: (analysis: FrameAnalysis, baseline: Baseline | null) => boolean;
};

type GuideState = {
  message: string;
  tone: GuideTone;
  box?: FaceBox;
  analysis?: FrameAnalysis;
  collected: number;
  totalRequired: number;
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
  stepPrompt: string;
  stableCount: number;
};

const ANALYZE_INTERVAL_MS = 250;
const CAPTURE_MIN_GAP_MS = 360;
const STABLE_REQUIRED = 4;

const VERIFY_STEPS: CaptureStep[] = [
  {
    id: "straight",
    label: "Verification",
    prompt: "Look straight and hold still.",
    perStepFrames: 5,
    validatePose: (analysis) => {
      if (!analysis.box) return false;
      const centerX = (analysis.box.x + (analysis.box.width / 2)) / Math.max(1, analysis.width);
      const centerY = (analysis.box.y + (analysis.box.height / 2)) / Math.max(1, analysis.height);
      const dx = Math.abs(centerX - 0.5);
      const dy = Math.abs(centerY - 0.5);
      return dx <= 0.25 && dy <= 0.25;
    },
  },
];

const ENROLL_STEPS: CaptureStep[] = [
  {
    id: "straight",
    label: "1/5 Straight",
    prompt: "Look straight at the camera.",
    perStepFrames: 3,
    validatePose: (analysis) => {
      if (!analysis.box) return false;
      const centerX = (analysis.box.x + (analysis.box.width / 2)) / Math.max(1, analysis.width);
      const centerY = (analysis.box.y + (analysis.box.height / 2)) / Math.max(1, analysis.height);
      return Math.abs(centerX - 0.5) <= 0.22 && Math.abs(centerY - 0.5) <= 0.22;
    },
  },
  {
    id: "left",
    label: "2/5 Left",
    prompt: "Turn your face slightly left.",
    perStepFrames: 2,
    validatePose: (analysis, baseline) => {
      if (!analysis.box || !baseline) return false;
      const centerX = (analysis.box.x + (analysis.box.width / 2)) / Math.max(1, analysis.width);
      const areaRatio = (analysis.box.width * analysis.box.height) / Math.max(1, analysis.width * analysis.height);
      return centerX <= baseline.centerX - 0.03 || areaRatio <= baseline.areaRatio * 0.92;
    },
  },
  {
    id: "right",
    label: "3/5 Right",
    prompt: "Turn your face slightly right.",
    perStepFrames: 2,
    validatePose: (analysis, baseline) => {
      if (!analysis.box || !baseline) return false;
      const centerX = (analysis.box.x + (analysis.box.width / 2)) / Math.max(1, analysis.width);
      const areaRatio = (analysis.box.width * analysis.box.height) / Math.max(1, analysis.width * analysis.height);
      return centerX >= baseline.centerX + 0.03 || areaRatio <= baseline.areaRatio * 0.92;
    },
  },
  {
    id: "up",
    label: "4/5 Up",
    prompt: "Look slightly up.",
    perStepFrames: 2,
    validatePose: (analysis, baseline) => {
      if (!analysis.box || !baseline) return false;
      const centerY = (analysis.box.y + (analysis.box.height / 2)) / Math.max(1, analysis.height);
      return centerY <= baseline.centerY - 0.03;
    },
  },
  {
    id: "down",
    label: "5/5 Down",
    prompt: "Look slightly down.",
    perStepFrames: 2,
    validatePose: (analysis, baseline) => {
      if (!analysis.box || !baseline) return false;
      const centerY = (analysis.box.y + (analysis.box.height / 2)) / Math.max(1, analysis.height);
      return centerY >= baseline.centerY + 0.03;
    },
  },
];

function toneStyles(tone: GuideTone) {
  if (tone === "green") {
    return { border: "#23c55e", text: "#14532d", background: "rgba(34, 197, 94, 0.12)" };
  }
  if (tone === "yellow") {
    return { border: "#facc15", text: "#713f12", background: "rgba(250, 204, 21, 0.12)" };
  }
  if (tone === "orange") {
    return { border: "#fb923c", text: "#7c2d12", background: "rgba(251, 146, 60, 0.12)" };
  }
  return { border: "#ef4444", text: "#7f1d1d", background: "rgba(239, 68, 68, 0.12)" };
}

function getGridColor(tone: GuideTone) {
  if (tone === "green") return "rgba(34, 197, 94, 0.45)";
  if (tone === "yellow") return "rgba(250, 204, 21, 0.38)";
  if (tone === "orange") return "rgba(251, 146, 60, 0.38)";
  return "rgba(239, 68, 68, 0.36)";
}

function evaluateGuide(step: CaptureStep, analysis: FrameAnalysis | undefined, baseline: Baseline | null): { message: string; tone: GuideTone; ready: boolean } {
  if (!analysis || analysis.faceCount === 0) {
    return { message: "No face detected. Align your face inside the oval.", tone: "red", ready: false };
  }

  if (analysis.faceCount > 1) {
    return { message: "Multiple faces detected. Keep only one face in view.", tone: "red", ready: false };
  }

  if (!analysis.box) {
    return { message: "Face box unavailable. Adjust camera and lighting.", tone: "red", ready: false };
  }

  const minArea = analysis.brightness < 95 ? 0.08 : 0.1;
  if (analysis.areaRatio < minArea) {
    return { message: "Move closer.", tone: "orange", ready: false };
  }

  if (analysis.areaRatio > 0.65) {
    return { message: "Move slightly farther.", tone: "orange", ready: false };
  }

  if (analysis.centeredness > 0.27 && step.id === "straight") {
    return { message: "Center your face in the oval.", tone: "yellow", ready: false };
  }

  if (analysis.brightness < 48) {
    return { message: "Lighting too low. Face a light source.", tone: "yellow", ready: false };
  }

  if (analysis.blurry) {
    return { message: "Image is blurry. Hold still for a moment.", tone: "yellow", ready: false };
  }

  if (analysis.qualityScore < 0.28) {
    return { message: "Quality is unstable. Keep steady and try again.", tone: "yellow", ready: false };
  }

  if (!step.validatePose(analysis, baseline)) {
    return { message: step.prompt, tone: "yellow", ready: false };
  }

  return { message: "Good. Hold steady, capturing...", tone: "green", ready: true };
}

export default function FaceCaptureDialog({ open, title, confirmLabel, busy, errorMessage, mode = "verify", onCancel, onConfirm }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analysisTimerRef = useRef<number | null>(null);

  const captureLockedRef = useRef(false);
  const stableCountRef = useRef(0);
  const lastCaptureAtRef = useRef(0);
  const baselineRef = useRef<Baseline | null>(null);
  const previousBoxRef = useRef<FaceBox | null>(null);
  const stepFramesRef = useRef<string[][]>([]);
  const analysisRef = useRef<FrameAnalysis | null>(null);

  const steps = useMemo(() => (mode === "enroll" ? ENROLL_STEPS : VERIFY_STEPS), [mode]);
  const totalRequired = useMemo(() => steps.reduce((sum, step) => sum + step.perStepFrames, 0), [steps]);

  const [stepIndex, setStepIndex] = useState(0);
  const [localError, setLocalError] = useState("");
  const [guide, setGuide] = useState<GuideState>({
    message: "Starting camera...",
    tone: "yellow",
    collected: 0,
    totalRequired,
    stepIndex: 0,
    totalSteps: steps.length,
    stepLabel: steps[0]?.label ?? "Capture",
    stepPrompt: steps[0]?.prompt ?? "Hold still.",
    stableCount: 0,
  });

  const styles = useMemo(() => toneStyles(guide.tone), [guide.tone]);

  const resetSession = () => {
    if (analysisTimerRef.current) {
      window.clearInterval(analysisTimerRef.current);
      analysisTimerRef.current = null;
    }
    captureLockedRef.current = false;
    stableCountRef.current = 0;
    lastCaptureAtRef.current = 0;
    baselineRef.current = null;
    previousBoxRef.current = null;
    stepFramesRef.current = steps.map(() => []);
    analysisRef.current = null;
    setStepIndex(0);
  };

  const stopStream = () => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      resetSession();
      stopStream();
      setLocalError("");
      return;
    }

    let cancelled = false;
    resetSession();

    (async () => {
      try {
        setLocalError("");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, min: 12 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setLocalError("Camera access was denied or is unavailable.");
      }
    })();

    return () => {
      cancelled = true;
      resetSession();
      stopStream();
    };
  }, [open, steps]);

  useEffect(() => {
    if (!open || busy) return;

    const tick = async () => {
      if (captureLockedRef.current) return;

      const video = videoRef.current;
      if (!video || video.readyState < 2) {
        return;
      }

      const activeStep = steps[Math.min(stepIndex, steps.length - 1)];
      if (!activeStep) return;

      let nextAnalysis: FrameAnalysis | null = null;
      try {
        nextAnalysis = await analyzeFrame(video);
      } catch {
        nextAnalysis = null;
      }

      analysisRef.current = nextAnalysis;

      const evaluation = evaluateGuide(activeStep, nextAnalysis ?? undefined, baselineRef.current);
      const box = nextAnalysis?.box;

      let movementOk = true;
      if (box && previousBoxRef.current) {
        const centerX = box.x + (box.width / 2);
        const centerY = box.y + (box.height / 2);
        const prevX = previousBoxRef.current.x + (previousBoxRef.current.width / 2);
        const prevY = previousBoxRef.current.y + (previousBoxRef.current.height / 2);
        const delta = Math.sqrt(((centerX - prevX) ** 2) + ((centerY - prevY) ** 2));
        movementOk = delta / Math.max(1, nextAnalysis?.width ?? 1) < 0.025;
      }

      previousBoxRef.current = box ?? null;

      if (evaluation.ready && movementOk) {
        stableCountRef.current += 1;
      } else {
        stableCountRef.current = 0;
      }

      const collected = stepFramesRef.current.flat().length;

      setGuide({
        message: evaluation.message,
        tone: evaluation.tone,
        box,
        analysis: nextAnalysis ?? undefined,
        collected,
        totalRequired,
        stepIndex,
        totalSteps: steps.length,
        stepLabel: activeStep.label,
        stepPrompt: activeStep.prompt,
        stableCount: stableCountRef.current,
      });

      if (!evaluation.ready || !nextAnalysis) {
        return;
      }

      if (stableCountRef.current < STABLE_REQUIRED) {
        return;
      }

      const now = Date.now();
      if (now - lastCaptureAtRef.current < CAPTURE_MIN_GAP_MS) {
        return;
      }

      if (nextAnalysis.blurry || nextAnalysis.qualityScore < 0.3) {
        return;
      }

      try {
        const frame = captureFrame(video, 0.92);
        lastCaptureAtRef.current = now;

        if (!stepFramesRef.current[stepIndex]) {
          stepFramesRef.current[stepIndex] = [];
        }
        stepFramesRef.current[stepIndex].push(frame);

        if (!baselineRef.current && activeStep.id === "straight" && nextAnalysis.box) {
          baselineRef.current = {
            centerX: (nextAnalysis.box.x + (nextAnalysis.box.width / 2)) / Math.max(1, nextAnalysis.width),
            centerY: (nextAnalysis.box.y + (nextAnalysis.box.height / 2)) / Math.max(1, nextAnalysis.height),
            areaRatio: nextAnalysis.areaRatio,
          };
        }

        const doneForStep = stepFramesRef.current[stepIndex].length >= activeStep.perStepFrames;
        if (!doneForStep) {
          return;
        }

        if (stepIndex + 1 < steps.length) {
          stableCountRef.current = 0;
          previousBoxRef.current = null;
          setStepIndex((prev) => prev + 1);
          return;
        }

        captureLockedRef.current = true;
        const allFrames = stepFramesRef.current.flat();
        await onConfirm(allFrames);
      } catch {
        setLocalError("Unable to capture a stable face frame. Please retry.");
        stableCountRef.current = 0;
      }
    };

    analysisTimerRef.current = window.setInterval(() => {
      void tick();
    }, ANALYZE_INTERVAL_MS);

    void tick();

    return () => {
      if (analysisTimerRef.current) {
        window.clearInterval(analysisTimerRef.current);
        analysisTimerRef.current = null;
      }
    };
  }, [open, busy, onConfirm, stepIndex, steps, totalRequired]);

  if (!open) {
    return null;
  }

  const overlayTone = localError || errorMessage ? "red" : guide.tone;
  const overlayStyles = toneStyles(overlayTone);
  const gridColor = getGridColor(overlayTone);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(2, 6, 23, 0.64)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ width: "min(96vw, 700px)", borderRadius: 20, background: "linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(15, 23, 42, 0.92))", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 30px 90px rgba(0,0,0,0.45)", padding: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: "1rem", marginBottom: "0.75rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#f8fafc" }}>{title}</h3>
            <p style={{ margin: "0.35rem 0 0", color: "rgba(226,232,240,0.72)", fontSize: "0.85rem" }}>
              {confirmLabel}
            </p>
          </div>
          <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>

        {(localError || errorMessage) && (
          <div style={{ marginBottom: "0.75rem", padding: "0.7rem 0.85rem", borderRadius: 14, border: "1px solid #ef4444", background: "rgba(239, 68, 68, 0.12)", color: "#fecaca", fontWeight: 600 }}>
            {localError || errorMessage}
          </div>
        )}

        <div style={{ marginBottom: "0.65rem" }}>
          <div style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap" }}>
            {steps.map((step, idx) => {
              const status = idx < stepIndex ? "done" : idx === stepIndex ? "active" : "pending";
              const bg = status === "done" ? "rgba(34,197,94,0.2)" : status === "active" ? "rgba(59,130,246,0.22)" : "rgba(148,163,184,0.12)";
              const border = status === "done" ? "1px solid #22c55e" : status === "active" ? "1px solid #60a5fa" : "1px solid rgba(148,163,184,0.35)";
              const color = status === "done" ? "#bbf7d0" : status === "active" ? "#bfdbfe" : "#cbd5e1";
              return (
                <div key={step.id} style={{ padding: "0.28rem 0.6rem", borderRadius: 999, background: bg, border, color, fontSize: "0.76rem", fontWeight: 700 }}>
                  {step.label}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ position: "relative", borderRadius: 20, overflow: "hidden", background: "#020617", border: `2px solid ${overlayStyles.border}` }}>
          <video ref={videoRef} playsInline muted style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", display: "block", background: "#020617" }} />

          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              backgroundImage: `
                linear-gradient(to right, transparent 0, transparent calc(33.333% - 1px), ${gridColor} calc(33.333% - 1px), ${gridColor} calc(33.333% + 1px), transparent calc(33.333% + 1px), transparent calc(66.666% - 1px), ${gridColor} calc(66.666% - 1px), ${gridColor} calc(66.666% + 1px), transparent calc(66.666% + 1px)),
                linear-gradient(to bottom, transparent 0, transparent calc(33.333% - 1px), ${gridColor} calc(33.333% - 1px), ${gridColor} calc(33.333% + 1px), transparent calc(33.333% + 1px), transparent calc(66.666% - 1px), ${gridColor} calc(66.666% - 1px), ${gridColor} calc(66.666% + 1px), transparent calc(66.666% + 1px))
              `,
              backgroundSize: "100% 100%",
              mixBlendMode: "screen",
            }}
          />

          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: "43%",
              height: "59%",
              transform: "translate(-50%, -50%)",
              border: `2px dashed ${gridColor}`,
              borderRadius: "999px",
              boxShadow: "0 0 0 9999px rgba(0,0,0,0.12) inset",
              pointerEvents: "none",
            }}
          />

          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 12,
              height: 12,
              transform: "translate(-50%, -50%)",
              borderRadius: 999,
              background: overlayStyles.border,
              boxShadow: `0 0 0 8px ${overlayStyles.border}22, 0 0 24px ${overlayStyles.border}88`,
              pointerEvents: "none",
            }}
          />

          {guide.box && (
            <div
              style={{
                position: "absolute",
                left: `${(guide.box.x / (guide.analysis?.width || 1)) * 100}%`,
                top: `${(guide.box.y / (guide.analysis?.height || 1)) * 100}%`,
                width: `${(guide.box.width / (guide.analysis?.width || 1)) * 100}%`,
                height: `${(guide.box.height / (guide.analysis?.height || 1)) * 100}%`,
                border: `3px solid ${overlayStyles.border}`,
                borderRadius: 16,
                boxSizing: "border-box",
                pointerEvents: "none",
              }}
            />
          )}

          <div style={{ position: "absolute", left: 10, top: 10, padding: "0.3rem 0.55rem", borderRadius: 10, background: "rgba(2,6,23,0.7)", color: "#e2e8f0", fontWeight: 700, fontSize: "0.76rem", border: "1px solid rgba(148,163,184,0.38)" }}>
            {guide.stepLabel}
          </div>
        </div>

        <div style={{ marginTop: "0.85rem", padding: "0.85rem 0.95rem", borderRadius: 16, border: `1px solid ${overlayStyles.border}`, background: overlayStyles.background, color: overlayStyles.text }}>
          <div style={{ fontSize: "1rem", fontWeight: 700 }}>{guide.message}</div>
          <div style={{ marginTop: "0.35rem", fontSize: "0.82rem", opacity: 0.92 }}>
            {guide.stepPrompt}
          </div>
          <div style={{ marginTop: "0.42rem", fontSize: "0.78rem", opacity: 0.88 }}>
            Stable frames: {guide.stableCount}/{STABLE_REQUIRED} | Quality: {Math.round((guide.analysis?.qualityScore ?? 0) * 100)}%
          </div>
        </div>

        <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ color: "rgba(226,232,240,0.72)", fontSize: "0.82rem" }}>
            {guide.analysis?.detectorName === "face-api.js" ? "face-api.js" : guide.analysis?.detectorName === "FaceDetector" ? "FaceDetector" : "Camera guidance"}
          </div>
          <div style={{ color: "#cbd5e1", fontSize: "0.85rem", fontWeight: 600 }}>
            {busy ? "Submitting frames..." : `Captured ${guide.collected} of ${guide.totalRequired}`}
          </div>
        </div>
      </div>
    </div>
  );
}
