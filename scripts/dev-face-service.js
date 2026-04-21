const { spawn, spawnSync } = require("child_process");
const path = require("path");

// OpenFace is a compiled toolkit. In this repo we run the face-service via Docker.
const faceDir = path.join(__dirname, "..", "face-service");

const DOCKER_IMAGE = process.env.FACE_SERVICE_DOCKER_IMAGE || "ojt-tracker-face-service:dev";
const DOCKER_CONTAINER = process.env.FACE_SERVICE_DOCKER_CONTAINER || "ojt-tracker-face-service-dev";

function runCapture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    code: typeof r.status === "number" ? r.status : 1,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

function dockerAvailable() {
  const r = runCapture("docker", ["version"], { cwd: faceDir, env: process.env });
  return r.code === 0;
}

function dockerImageExists() {
  const r = runCapture("docker", ["image", "inspect", DOCKER_IMAGE], { cwd: faceDir, env: process.env });
  return r.code === 0;
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", (err) => reject(err));
    child.on("exit", (code, signal) => {
      if (signal) return resolve({ code: 1, signal });
      resolve({ code: typeof code === "number" ? code : 1 });
    });
  });
}

async function dockerBuildImage() {
  console.log(`[face] Building Docker image (${DOCKER_IMAGE})…`);
  const r = await runCmd("docker", ["build", "-t", DOCKER_IMAGE, "."], { cwd: faceDir, env: process.env });
  if (r.code !== 0) throw new Error("Docker build failed for face-service.");
}

async function dockerRun(port, required) {
  // Best-effort cleanup from a previous run.
  runCapture("docker", ["rm", "-f", DOCKER_CONTAINER], { cwd: faceDir, env: process.env });

  if (!dockerImageExists()) {
    await dockerBuildImage();
  }

  console.log(`[face] Starting OpenFace face-service on port ${port}…`);

  const child = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      DOCKER_CONTAINER,
      "-p",
      `${port}:8000`,
      DOCKER_IMAGE,
    ],
    { cwd: faceDir, env: process.env, stdio: "inherit", windowsHide: true }
  );

  const forward = (signal) => {
    if (!child.killed) {
      try {
        child.kill(signal);
      } catch {
        // ignore
      }
    }
  };

  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));

  child.on("exit", (code) => {
    const exitCode = typeof code === "number" ? code : 1;
    process.exit(required ? exitCode : 0);
  });

  child.on("error", (e) => {
    console.error("[face] Failed to start Docker:", e);
    process.exit(required ? 1 : 0);
  });
}

async function main() {
  if (String(process.env.FACE_SERVICE_SKIP || "").toLowerCase() === "1") {
    console.log("[face] Skipped (FACE_SERVICE_SKIP=1)");
    return;
  }

  const required = String(process.env.FACE_SERVICE_REQUIRED || "").toLowerCase() === "1";
  const port = String(process.env.FACE_SERVICE_PORT || process.env.PORT || "8000");

  if (!dockerAvailable()) {
    console.error("[face] Docker is required for OpenFace face-service. Install Docker Desktop and ensure `docker version` works.");
    if (required) process.exit(1);
    return;
  }

  await dockerRun(port, required);
}

main().catch((err) => {
  console.error("[face]", err && err.message ? err.message : String(err));
  process.exit(1);
});
