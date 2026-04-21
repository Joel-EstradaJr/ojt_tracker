FROM algebr/openface:latest

# The base image contains OpenFace binaries. We add a small FastAPI wrapper.
RUN apt-get update \
  ; apt-get install -y --no-install-recommends python3 python3-pip \
  ; rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN python3 -m pip install --no-cache-dir -r requirements.txt

COPY app.py ./

ENV PORT=8000
EXPOSE 8000

CMD ["python3", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
