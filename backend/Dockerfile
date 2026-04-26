

FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install build/runtime dependencies for OpenFace and Node.js.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    cmake \
    build-essential \
    pkg-config \
    libopenblas-dev \
    liblapack-dev \
    libboost-all-dev \
    libtbb-dev \
    libopencv-dev \
    libgtk-3-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libx11-dev \
    libatlas-base-dev \
  && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS.
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# Build OpenFace from source (CLI only usage in app code).
WORKDIR /opt
RUN git clone --depth 1 --branch OpenFace_2.2.0 https://github.com/TadasBaltrusaitis/OpenFace.git \
  && cd OpenFace \
  && mkdir -p build \
  && cd build \
  && cmake -D CMAKE_BUILD_TYPE=Release .. \
  && cmake --build . --config Release -j"$(nproc)"

WORKDIR /app

# Install backend dependencies first for layer caching.
COPY package*.json ./
RUN npm ci --include=dev

# Copy source and build.
COPY . .
RUN npm run build

# OpenFace CLI path used by backend/src/utils/face.ts.
ENV OPENFACE_CLI_PATH=/opt/OpenFace/build/bin/FeatureExtraction
ENV FACE_ENGINE=openface-cli
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["npm", "start"]
