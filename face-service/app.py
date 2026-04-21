import base64
import csv
import io
import os
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image

app = FastAPI(title="ojt-tracker-face-service")


def _decode_image_base64_to_jpeg_bytes(image_b64: str) -> bytes:
  raw = image_b64.strip()
  if raw.startswith("data:"):
    raw = raw.split("base64,", 1)[-1]

  try:
    data = base64.b64decode(raw, validate=True)
  except Exception:
    raise HTTPException(status_code=400, detail="Invalid base64 image.")

  try:
    img = Image.open(io.BytesIO(data)).convert("RGB")
  except Exception:
    raise HTTPException(status_code=400, detail="Invalid image data.")

  out = io.BytesIO()
  img.save(out, format="JPEG", quality=92)
  return out.getvalue()


def _find_openface_facelandmark_img() -> str:
  override = os.getenv("OPENFACE_FACELANDMARKIMG")
  if override and override.strip():
    return override.strip()

  candidates = [
    "/home/openface-build/build/bin/FaceLandmarkImg",
    "/home/openface-build/build/bin/FaceLandmarkImg.exe",
    "/home/openface-build/build/bin/FaceLandmarkImg.bin",
    "/home/openface-build/build/bin/FaceLandmarkImg_static",
    "/usr/local/bin/FaceLandmarkImg",
    "FaceLandmarkImg",
  ]

  for c in candidates:
    if c.startswith("/") and Path(c).exists():
      return c

  # Allow PATH lookup as a last resort.
  return "FaceLandmarkImg"


def _run_openface_and_collect_outputs(image_path: Path, out_dir: Path) -> Tuple[Path, List[Path]]:
  exe = _find_openface_facelandmark_img()
  simsize = int(os.getenv("OPENFACE_SIMSIZE", "112"))
  simscale = float(os.getenv("OPENFACE_SIM_SCALE", "0.7"))

  args = [
    exe,
    "-f",
    str(image_path),
    "-out_dir",
    str(out_dir),
    "-of",
    "probe",
    "-simalign",
    "-simsize",
    str(simsize),
    "-simscale",
    str(simscale),
    "-nomask",
  ]

  try:
    debug = str(os.getenv("OPENFACE_DEBUG", "")).strip().lower() in ("1", "true", "yes")
    if debug:
      subprocess.run(args, check=True)
    else:
      r = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
      if r.returncode != 0:
        raise subprocess.CalledProcessError(r.returncode, args, output=r.stdout, stderr=r.stderr)
  except FileNotFoundError:
    raise HTTPException(
      status_code=500,
      detail="OpenFace FaceLandmarkImg executable not found in the container. Ensure the OpenFace image is available.",
    )
  except subprocess.CalledProcessError:
    raise HTTPException(status_code=400, detail="OpenFace failed to process image. Ensure exactly one face is visible.")

  # OpenFace typically writes outputs into a 'processed' directory.
  processed = out_dir / "processed"
  search_root = processed if processed.exists() else out_dir

  csv_files = sorted([p for p in search_root.rglob("*.csv") if p.is_file()])
  aligned_images = sorted(
    [p for p in search_root.rglob("*") if p.is_file() and p.suffix.lower() in (".bmp", ".png", ".jpg", ".jpeg")]
  )

  if not csv_files:
    raise HTTPException(status_code=400, detail="No face detected.")

  return csv_files[0], aligned_images


def _assert_single_face_from_csv(csv_path: Path) -> None:
  # FaceLandmarkImg can output multiple faces; we only support exactly one.
  try:
    with csv_path.open("r", newline="", encoding="utf-8", errors="ignore") as f:
      reader = csv.DictReader(f)
      rows = list(reader)
  except Exception:
    # If CSV parsing fails, assume OpenFace couldn't produce valid face output.
    raise HTTPException(status_code=400, detail="OpenFace output could not be read.")

  if not rows:
    raise HTTPException(status_code=400, detail="No face detected.")

  success_rows = [r for r in rows if str(r.get("success", "")).strip() == "1"]
  if not success_rows:
    raise HTTPException(status_code=400, detail="No face detected.")

  face_ids = set()
  for r in success_rows:
    fid = r.get("face_id")
    if fid is not None and str(fid).strip() != "":
      face_ids.add(str(fid).strip())

  if len(face_ids) > 1:
    raise HTTPException(status_code=400, detail="Multiple faces detected. Use a photo with exactly one face.")


def _pick_single_aligned_image(aligned_images: List[Path]) -> Path:
  # Heuristic: prefer OpenFace similarity aligned frame outputs.
  preferred = [p for p in aligned_images if "aligned" in p.name.lower() or "frame_det_" in p.name]
  candidates = preferred if preferred else aligned_images

  # Filter out obvious visualization frames if present.
  candidates = [p for p in candidates if "vis" not in p.name.lower() and "tracked" not in p.name.lower()]
  if not candidates:
    raise HTTPException(status_code=400, detail="OpenFace did not output an aligned face image.")

  # If there are multiple aligned faces, reject to enforce single-face enrollment.
  if len(candidates) > 1:
    # If multiple files exist but are duplicates (e.g. different formats), pick the first.
    # If they look like multiple faces/frames, safer to reject.
    unique_stems = {p.stem for p in candidates}
    if len(unique_stems) > 1:
      raise HTTPException(status_code=400, detail="Multiple faces detected. Use a photo with exactly one face.")

  return candidates[0]


def _compute_embedding(image_base64: str) -> np.ndarray:
  jpeg_bytes = _decode_image_base64_to_jpeg_bytes(image_base64)

  with tempfile.TemporaryDirectory(prefix="openface-") as td:
    out_dir = Path(td)
    img_path = out_dir / "probe.jpg"
    img_path.write_bytes(jpeg_bytes)

    csv_path, aligned_images = _run_openface_and_collect_outputs(img_path, out_dir)
    _assert_single_face_from_csv(csv_path)
    aligned = _pick_single_aligned_image(aligned_images)
    return _embedding_from_aligned_image(aligned)


def _embedding_from_aligned_image(path: Path) -> np.ndarray:
  # Embed from OpenFace similarity-aligned output.
  # This uses OpenFace for detection + alignment, then computes a stable numeric signature.
  embed_size = int(os.getenv("FACE_EMBED_SIZE", "64"))

  try:
    img = Image.open(path).convert("L")
  except Exception:
    raise HTTPException(status_code=400, detail="OpenFace aligned image could not be read.")

  img = img.resize((embed_size, embed_size), Image.BILINEAR)
  arr = (np.asarray(img, dtype=np.float32) / 255.0).reshape(-1)

  # Standardize and L2-normalize.
  mean = float(np.mean(arr))
  std = float(np.std(arr))
  arr = arr - mean
  if std > 1e-6:
    arr = arr / std

  norm = float(np.linalg.norm(arr))
  if not np.isfinite(norm) or norm == 0:
    raise HTTPException(status_code=500, detail="Invalid embedding.")
  return (arr / norm).astype(np.float32)


class EmbeddingRequest(BaseModel):
  image_base64: str


class EmbeddingResponse(BaseModel):
  embedding: List[float]


class VerifyRequest(BaseModel):
  image_base64: str
  candidate_embedding: List[float]
  threshold: Optional[float] = None


class VerifyResponse(BaseModel):
  match: bool
  similarity: float
  threshold: float


@app.get("/health")
def health():
  return {"status": "ok", "engine": "openface"}


@app.post("/v1/face/embedding", response_model=EmbeddingResponse)
def embedding(req: EmbeddingRequest):
  emb = _compute_embedding(req.image_base64)
  return {"embedding": emb.astype(float).tolist()}


@app.post("/v1/face/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest):
  cand = np.asarray(req.candidate_embedding, dtype=np.float32)
  norm = float(np.linalg.norm(cand))
  if not np.isfinite(norm) or norm == 0:
    raise HTTPException(status_code=400, detail="Invalid candidate embedding.")
  cand = cand / norm

  probe = _compute_embedding(req.image_base64)
  pnorm = float(np.linalg.norm(probe))
  if not np.isfinite(pnorm) or pnorm == 0:
    raise HTTPException(status_code=500, detail="Invalid probe embedding.")
  probe = probe / pnorm

  similarity = float(np.dot(probe, cand))
  threshold = float(req.threshold) if req.threshold is not None else float(os.getenv("FACE_MATCH_THRESHOLD", "0.85"))
  return {"match": similarity >= threshold, "similarity": similarity, "threshold": threshold}
