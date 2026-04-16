"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  open: boolean;
  title: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (imageDataUrl: string) => void;
};

type GuideStatus = "ok" | "warn" | "bad" | "unknown";

type FaceBox = { x: number; y: number; width: number; height: number };

type LiveGuide = {
  detectorAvailable: boolean;
  frameW: number;
  frameH: number;
  face: GuideStatus;
  lighting: GuideStatus;
  distance: GuideStatus;
  centering: GuideStatus;
  tilt: GuideStatus;
  messages: string[];
  box?: FaceBox;
};

function statusColor(status: GuideStatus) {
  if (status === "ok") return "var(--success-text)";
  if (status === "warn") return "var(--primary)";
  if (status === "bad") return "var(--danger)";
  return "var(--text-muted)";
}

export default function FaceCaptureDialog({ open, title, confirmLabel, busy, onCancel, onConfirm }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string>("");
  const [captured, setCaptured] = useState<string | null>(null);

  const detectorRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [guide, setGuide] = useState<LiveGuide>({
    detectorAvailable: false,
    frameW: 0,
    frameH: 0,
    face: "unknown",
    lighting: "unknown",
    distance: "unknown",
    centering: "unknown",
    tilt: "unknown",
    messages: [],
  });

  const canCapture = useMemo(() => {
    // If the detector is available, require exactly one face detected.
    if (guide.detectorAvailable) return guide.face === "ok";
    return true;
  }, [guide.detectorAvailable, guide.face]);

  const stopStream = () => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  useEffect(() => {
    if (!open) {
      stopStream();
      setCaptured(null);
      setError("");
      setGuide({
        detectorAvailable: false,
        frameW: 0,
        frameH: 0,
        face: "unknown",
        lighting: "unknown",
        distance: "unknown",
        centering: "unknown",
        tilt: "unknown",
        messages: [],
      });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        setError("");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        // Init Shape Detection API FaceDetector if supported.
        const FaceDetectorCtor = (globalThis as any).FaceDetector;
        if (FaceDetectorCtor && !detectorRef.current) {
          try {
            detectorRef.current = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 2 });
          } catch {
            detectorRef.current = null;
          }
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch {
        setError("Camera access was denied or is unavailable.");
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (captured) return;

    let stopped = false;
    let busyTick = false;

    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;

    const tick = async () => {
      if (stopped) return;
      if (busyTick) return;

      const video = videoRef.current;
      if (!video || !ctx) return;
      if (video.readyState < 2) return;

      busyTick = true;

      try {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;
        const scale = Math.min(1, 360 / vw);
        const W = Math.max(160, Math.round(vw * scale));
        const H = Math.max(120, Math.round(vh * scale));
        canvas.width = W;
        canvas.height = H;
        ctx.drawImage(video, 0, 0, W, H);

        // Lighting heuristic: average luminance + contrast.
        const data = ctx.getImageData(0, 0, W, H).data;
        let sum = 0;
        let sumSq = 0;
        let count = 0;

        // Sample every ~20th pixel (performance).
        const step = 4 * 20;
        for (let i = 0; i < data.length; i += step) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += y;
          sumSq += y * y;
          count++;
        }

        const avg = count ? sum / count : 0;
        const variance = count ? Math.max(0, sumSq / count - avg * avg) : 0;
        const std = Math.sqrt(variance);

        let lighting: GuideStatus = "unknown";
        if (count) {
          if (avg < 70 || std < 22) lighting = "bad";
          else if (avg > 210) lighting = "warn";
          else lighting = "ok";
        }

        const detector = detectorRef.current;
        let face: GuideStatus = detector ? "bad" : "unknown";
        let distance: GuideStatus = detector ? "unknown" : "unknown";
        let centering: GuideStatus = detector ? "unknown" : "unknown";
        let tilt: GuideStatus = detector ? "unknown" : "unknown";
        let box: FaceBox | undefined;

        const messages: string[] = [];

        if (detector) {
          const faces = await detector.detect(canvas);

          if (!faces || faces.length === 0) {
            face = "bad";
            messages.push("No face detected. Face the camera and remove obstructions.");
          } else if (faces.length > 1) {
            face = "bad";
            messages.push("Multiple faces detected. Ensure only one face is in frame.");
          } else {
            face = "ok";
            const bb = faces[0]?.boundingBox as { x: number; y: number; width: number; height: number };
            if (bb && Number.isFinite(bb.x) && Number.isFinite(bb.y)) {
              box = { x: bb.x, y: bb.y, width: bb.width, height: bb.height };

              const areaRatio = (bb.width * bb.height) / (W * H);
              if (areaRatio < 0.08) {
                distance = "bad";
                messages.push("Move closer to the camera.");
              } else if (areaRatio > 0.35) {
                distance = "warn";
                messages.push("Move a bit farther from the camera.");
              } else {
                distance = "ok";
              }

              const cx = bb.x + bb.width / 2;
              const cy = bb.y + bb.height / 2;
              const dx = Math.abs(cx - W / 2) / (W / 2);
              const dy = Math.abs(cy - H / 2) / (H / 2);
              if (dx > 0.28 || dy > 0.28) {
                centering = "warn";
                messages.push("Center your face in the frame.");
              } else {
                centering = "ok";
              }
            }

            // Optional tilt (roll) if landmarks are available.
            const landmarks = (faces[0] as any)?.landmarks as any[] | undefined;
            if (Array.isArray(landmarks) && landmarks.length) {
              const find = (re: RegExp) => landmarks.find((l) => re.test(String(l?.type ?? "")));
              const leftEye = find(/left.*eye/i);
              const rightEye = find(/right.*eye/i);
              const p1 = leftEye?.locations?.[0] ?? leftEye?.location;
              const p2 = rightEye?.locations?.[0] ?? rightEye?.location;
              if (p1 && p2 && Number.isFinite(p1.x) && Number.isFinite(p1.y) && Number.isFinite(p2.x) && Number.isFinite(p2.y)) {
                const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
                if (Math.abs(angle) > 12) {
                  tilt = "warn";
                  messages.push("Keep your head level (reduce tilt)." );
                } else {
                  tilt = "ok";
                }
              }
            }
          }
        }

        if (lighting === "bad") {
          messages.push("Lighting is too low. Move to a brighter area or face a light source.");
        } else if (lighting === "warn") {
          messages.push("Lighting is very bright. Avoid backlight and reduce glare.");
        }

        if (messages.length === 0) {
          messages.push("Looks good. Capture when ready.");
        }

        setGuide({
          detectorAvailable: Boolean(detector),
          frameW: W,
          frameH: H,
          face,
          lighting,
          distance,
          centering,
          tilt,
          messages,
          box,
        });
      } catch {
        setGuide((prev) => ({
          ...prev,
          detectorAvailable: Boolean(detectorRef.current),
          messages: prev.messages.length ? prev.messages : ["Adjust your face and lighting, then capture."],
        }));
      } finally {
        busyTick = false;
      }
    };

    const interval = window.setInterval(() => { void tick(); }, 350);
    void tick();

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [open, captured]);

  if (!open) return null;

  const captureFrame = () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    setCaptured(dataUrl);
  };

  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: "var(--bg)", borderRadius: "var(--radius)", padding: "1.25rem", maxWidth: 520, width: "92%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        <h3 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: "0.75rem" }}>{title}</h3>

        {error ? (
          <div style={{ padding: "0.6rem 0.85rem", borderRadius: "var(--radius-sm)", background: "var(--danger-light)", border: "1px solid var(--danger)", color: "var(--danger)", fontSize: "0.85rem" }}>
            {error}
          </div>
        ) : (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {!captured ? (
              <div style={{ position: "relative" }}>
                <video ref={videoRef} playsInline style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", background: "var(--bg-subtle)" }} />
                {guide.detectorAvailable && guide.box && guide.frameW > 0 && guide.frameH > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${(guide.box.x / guide.frameW) * 100}%`,
                      top: `${(guide.box.y / guide.frameH) * 100}%`,
                      width: `${(guide.box.width / guide.frameW) * 100}%`,
                      height: `${(guide.box.height / guide.frameH) * 100}%`,
                      border: `2px solid ${statusColor(guide.face)}`,
                      borderRadius: 8,
                      boxSizing: "border-box",
                      pointerEvents: "none",
                    }}
                  />
                )}
              </div>
            ) : (
              <img src={captured} alt="Captured face" style={{ width: "100%", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }} />
            )}

            {!captured && (
              <div style={{ display: "grid", gap: "0.35rem", padding: "0.75rem", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-subtle)" }}>
                <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
                  <span style={{ color: statusColor(guide.face) }}>Face: {guide.detectorAvailable ? (guide.face === "ok" ? "Detected" : "Not ready") : "(no detector)"}</span>
                  <span style={{ color: statusColor(guide.lighting) }}>Light: {guide.lighting === "ok" ? "Good" : guide.lighting === "warn" ? "Very bright" : guide.lighting === "bad" ? "Too low" : "—"}</span>
                  <span style={{ color: statusColor(guide.distance) }}>Distance: {guide.distance === "ok" ? "Good" : guide.distance === "warn" ? "Adjust" : guide.distance === "bad" ? "Adjust" : "—"}</span>
                  <span style={{ color: statusColor(guide.centering) }}>Center: {guide.centering === "ok" ? "Good" : guide.centering === "warn" ? "Adjust" : "—"}</span>
                  <span style={{ color: statusColor(guide.tilt) }}>Tilt: {guide.tilt === "ok" ? "Good" : guide.tilt === "warn" ? "Adjust" : "—"}</span>
                </div>

                <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "var(--text-muted)", fontSize: "0.78rem" }}>
                  {guide.messages.slice(0, 3).map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>

                {!guide.detectorAvailable && (
                  <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                    Live face positioning guidance is limited in this browser. Use good lighting and center your face.
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "space-between", flexWrap: "wrap" }}>
              {!captured ? (
                <button type="button" className="btn btn-outline" onClick={captureFrame} disabled={busy || !canCapture}>
                  Capture
                </button>
              ) : (
                <button type="button" className="btn btn-outline" onClick={() => setCaptured(null)} disabled={busy}>
                  Retake
                </button>
              )}

              <div style={{ display: "flex", gap: "0.5rem", marginLeft: "auto" }}>
                <button type="button" className="btn btn-outline" onClick={onCancel} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => captured && onConfirm(captured)}
                  disabled={busy || !captured}
                >
                  {busy ? "Working…" : confirmLabel}
                </button>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Tip: Face the camera with good lighting.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
