import base64
import io
import os
from typing import List, Optional

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image
from insightface.app import FaceAnalysis

app = FastAPI(title="ojt-tracker-face-service")

MODEL_NAME = os.getenv("INSIGHTFACE_MODEL", "buffalo_l")
MIN_DET_SCORE = float(os.getenv("FACE_MIN_DET_SCORE", "0.6"))
DET_SIZE = int(os.getenv("FACE_DET_SIZE", "640"))

# CPU-only defaults; override with INSIGHTFACE_PROVIDERS if needed.
PROVIDERS = [p.strip() for p in os.getenv("INSIGHTFACE_PROVIDERS", "CPUExecutionProvider").split(",") if p.strip()]

face_app = FaceAnalysis(name=MODEL_NAME, providers=PROVIDERS)
face_app.prepare(ctx_id=0, det_size=(DET_SIZE, DET_SIZE))


def _decode_image_base64(image_b64: str) -> np.ndarray:
  raw = image_b64.strip()
  if raw.startswith("data:"):
    # data:image/jpeg;base64,...
    raw = raw.split("base64,", 1)[-1]

  try:
    data = base64.b64decode(raw, validate=True)
  except Exception:
    raise HTTPException(status_code=400, detail="Invalid base64 image.")

  try:
    img = Image.open(io.BytesIO(data)).convert("RGB")
  except Exception:
    raise HTTPException(status_code=400, detail="Invalid image data.")

  rgb = np.array(img)
  if rgb.ndim != 3 or rgb.shape[2] != 3:
    raise HTTPException(status_code=400, detail="Unsupported image format.")

  # InsightFace expects BGR uint8.
  bgr = rgb[:, :, ::-1].astype(np.uint8)
  return bgr


def _get_single_face(bgr: np.ndarray):
  faces = face_app.get(bgr)
  if not faces:
    raise HTTPException(status_code=400, detail="No face detected.")

  best = max(faces, key=lambda f: float(getattr(f, "det_score", 0.0)))
  if len(faces) > 1:
    raise HTTPException(status_code=400, detail="Multiple faces detected. Use a photo with exactly one face.")

  score = float(getattr(best, "det_score", 0.0))
  if score < MIN_DET_SCORE:
    raise HTTPException(status_code=400, detail="Face detection confidence too low. Try better lighting.")

  emb = getattr(best, "embedding", None)
  if emb is None:
    raise HTTPException(status_code=500, detail="Embedding not available.")

  emb = np.asarray(emb, dtype=np.float32)
  norm = float(np.linalg.norm(emb))
  if not np.isfinite(norm) or norm == 0:
    raise HTTPException(status_code=500, detail="Invalid embedding.")

  return emb / norm


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
  return {"status": "ok"}


@app.post("/v1/face/embedding", response_model=EmbeddingResponse)
def embedding(req: EmbeddingRequest):
  bgr = _decode_image_base64(req.image_base64)
  emb = _get_single_face(bgr)
  return {"embedding": emb.astype(float).tolist()}


@app.post("/v1/face/verify", response_model=VerifyResponse)
def verify(req: VerifyRequest):
  bgr = _decode_image_base64(req.image_base64)
  probe = _get_single_face(bgr)

  cand = np.asarray(req.candidate_embedding, dtype=np.float32)
  norm = float(np.linalg.norm(cand))
  if not np.isfinite(norm) or norm == 0:
    raise HTTPException(status_code=400, detail="Invalid candidate embedding.")
  cand = cand / norm

  similarity = float(np.dot(probe, cand))
  threshold = float(req.threshold) if req.threshold is not None else 0.35
  return {"match": similarity >= threshold, "similarity": similarity, "threshold": threshold}
