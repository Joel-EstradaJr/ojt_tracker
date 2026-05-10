# ==================== OpenFace model data ===========================
FROM alpine AS model_data
RUN apk --no-cache --update-cache add wget
WORKDIR /data/patch_experts

RUN wget -q https://www.dropbox.com/s/7na5qsjzz8yfoer/cen_patches_0.25_of.dat \
  && wget -q https://www.dropbox.com/s/k7bj804cyiu474t/cen_patches_0.35_of.dat \
  && wget -q https://www.dropbox.com/s/ixt4vkbmxgab1iu/cen_patches_0.50_of.dat \
  && wget -q https://www.dropbox.com/s/2t5t1sdpshzfhpj/cen_patches_1.00_of.dat

# ==================== OpenFace build deps ===========================
FROM ubuntu:22.04 AS openface_builder

ARG DEBIAN_FRONTEND=noninteractive
ENV OPENCV_VERSION=4.1.0

RUN apt-get update -qq && apt-get install -qq -y --no-install-recommends \
  ca-certificates curl git unzip \
  cmake ninja-build pkg-config build-essential g++ \
  libopenblas-dev liblapack-dev \
  libavcodec-dev libavformat-dev libswscale-dev \
  libtbb2 libtbb-dev libjpeg-dev libpng-dev libtiff-dev \
  libboost-all-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/build

# dlib 19.13 (official OpenFace wiki / Docker reference)
RUN curl -L http://dlib.net/files/dlib-19.13.tar.bz2 -o dlib-19.13.tar.bz2 \
  && tar xf dlib-19.13.tar.bz2 \
  && rm dlib-19.13.tar.bz2 \
  && mv dlib-19.13 dlib \
  && mkdir -p dlib/build \
  && cd dlib/build \
  && cmake -DCMAKE_BUILD_TYPE=Release -G Ninja .. \
    && ninja -j1 \
  && ninja install \
  && ldconfig

# OpenCV 4.1.0 (official OpenFace wiki / Docker reference)
RUN curl -L https://github.com/opencv/opencv/archive/${OPENCV_VERSION}.tar.gz -o ${OPENCV_VERSION}.tar.gz \
  && tar xf ${OPENCV_VERSION}.tar.gz \
  && rm ${OPENCV_VERSION}.tar.gz \
  && mv opencv-${OPENCV_VERSION} opencv \
  && mkdir -p opencv/build \
  && cd opencv/build \
  && cmake -D CMAKE_BUILD_TYPE=RELEASE \
    -D CMAKE_INSTALL_PREFIX=/usr/local \
      -D WITH_TBB=OFF -D WITH_CUDA=OFF \
    -D WITH_QT=OFF -D WITH_GTK=OFF \
      -D BUILD_SHARED_LIBS=ON \
      -D OPENCV_MODULES_TO_EXCLUDE="calib3d,objdetect,features2d,highgui,ts,apps" \
      -G Ninja .. \
    && ninja -j1 \
  && ninja install \
  && ldconfig

# OpenFace 2.2.0 build
WORKDIR /opt
RUN git clone --recursive --depth 1 --branch OpenFace_2.2.0 https://github.com/TadasBaltrusaitis/OpenFace.git openface
COPY --from=model_data /data/patch_experts/* /opt/openface/lib/local/LandmarkDetector/model/patch_experts/

WORKDIR /opt/openface
RUN mkdir -p build \
  && cd build \
  && cmake -D CMAKE_BUILD_TYPE=RELEASE -G Ninja .. \
  && ninja \
  && ldconfig

# ==================== Backend build ===========================
FROM node:20-bookworm-slim AS backend_builder

# Prisma needs the openssl binary to detect the correct engine variant.
RUN apt-get update -qq && apt-get install -qq -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# ==================== Runtime ===========================
FROM ubuntu:22.04 AS runtime
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update -qq && apt-get install -qq -y --no-install-recommends \
  ca-certificates curl openssl \
  libopenblas-dev liblapack-dev \
  libavcodec-dev libavformat-dev libswscale-dev \
  libtbb2 libtbb-dev libjpeg-dev libpng-dev libtiff-dev \
  libboost-all-dev \
  && rm -rf /var/lib/apt/lists/*

# Node.js 20 runtime
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
  && apt-get update -qq \
  && apt-get install -qq -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# OpenFace + compiled native dependencies
COPY --from=openface_builder /usr/local /usr/local
COPY --from=openface_builder /opt/openface /opt/openface
RUN chmod +x /opt/openface/build/bin/FeatureExtraction /opt/openface/build/bin/FaceLandmarkImg || true
RUN ldconfig

WORKDIR /app

COPY --from=backend_builder /app/package*.json ./
COPY --from=backend_builder /app/node_modules ./node_modules
COPY --from=backend_builder /app/dist ./dist
COPY --from=backend_builder /app/prisma ./prisma
COPY --from=backend_builder /app/openapi.yaml ./openapi.yaml

ENV NODE_ENV=production
ENV PORT=10000
ENV FACE_ENGINE=openface-cli
ENV OPENFACE_CLI_PATH=/opt/openface/build/bin/FeatureExtraction
ENV OPENBLAS_NUM_THREADS=1
ENV OMP_NUM_THREADS=1
ENV VECLIB_MAXIMUM_THREADS=1

EXPOSE 10000

CMD ["npm", "start"]
