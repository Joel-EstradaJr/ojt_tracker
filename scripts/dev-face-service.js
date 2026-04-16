const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const faceDir = path.join(__dirname, "..", "face-service");
const isWin = process.platform === "win32";

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function pythonPathForVenv(venvDir) {
  return isWin ? path.join(venvDir, "Scripts", "python.exe") : path.join(venvDir, "bin", "python");
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

function isSupportedPythonVersion(version) {
  // Keep it conservative: InsightFace deps are typically available for 3.11/3.12.
  return version === "3.11" || version === "3.12";
}

function getPythonMajorMinor(cmd, prefixArgs) {
  const r = runCapture(cmd, [...prefixArgs, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"], {
    cwd: faceDir,
    env: process.env,
  });
  if (r.code !== 0) return null;
  return r.stdout || null;
}

function isVenvHealthy(pythonExe) {
  if (!exists(pythonExe)) return false;
  const r = runCapture(
    pythonExe,
    [
      "-c",
      [
        "import uvicorn", // runner
        "import fastapi", // app
        "import numpy", // deps
        "import insightface", // model
        "import onnxruntime", // runtime
        "print('ok')",
      ].join("; "),
    ],
    { cwd: faceDir, env: process.env }
  );
  return r.code === 0;
}

async function findPythonCandidate() {
  const override = process.env.FACE_SERVICE_PYTHON;
  if (override && override.trim()) {
    return { cmd: override.trim(), prefixArgs: [] };
  }

  const candidates = isWin
    ? [
        { cmd: "py", prefixArgs: ["-3.12"] },
        { cmd: "py", prefixArgs: ["-3.11"] },
        { cmd: "python3.12", prefixArgs: [] },
        { cmd: "python3.11", prefixArgs: [] },
        { cmd: "python", prefixArgs: [] },
      ]
    : [
        { cmd: "python3.12", prefixArgs: [] },
        { cmd: "python3.11", prefixArgs: [] },
        { cmd: "python3", prefixArgs: [] },
        { cmd: "python", prefixArgs: [] },
      ];

  for (const c of candidates) {
    try {
      const r = runCapture(c.cmd, [...c.prefixArgs, "--version"], { cwd: faceDir, env: process.env });
      if (r.code === 0) return c;
    } catch {
      // ignore
    }
  }

  return null;
}

async function ensureVenv() {
  if (!exists(path.join(faceDir, "requirements.txt")) || !exists(path.join(faceDir, "app.py"))) {
    throw new Error("face-service folder is missing requirements.txt or app.py");
  }

  // Prefer any existing healthy venv.
  const venvCandidates = [".venv", ".venv312", ".venv311"].map((d) => path.join(faceDir, d));
  for (const venvDir of venvCandidates) {
    const py = pythonPathForVenv(venvDir);
    if (isVenvHealthy(py)) return { venvDir, pythonExe: py };
  }

  const py = await findPythonCandidate();
  if (!py) {
    throw new Error(
      "No usable Python found. Install Python 3.11/3.12 (64-bit) or set FACE_SERVICE_PYTHON to a python executable."
    );
  }

  const version = getPythonMajorMinor(py.cmd, py.prefixArgs);
  if (!version || !isSupportedPythonVersion(version)) {
    throw new Error(
      `Face-service needs Python 3.11/3.12 (64-bit). Detected ${version || "unknown"}. Install 3.11/3.12 or set FACE_SERVICE_PYTHON, then re-run.`
    );
  }

  const venvDir = path.join(faceDir, version === "3.12" ? ".venv312" : ".venv311");
  const venvPython = pythonPathForVenv(venvDir);

  if (!exists(venvPython)) {
    console.log(`[face] Creating virtual environment (${path.basename(venvDir)})…`);
    const r = await runCmd(py.cmd, [...py.prefixArgs, "-m", "venv", path.basename(venvDir)], { cwd: faceDir, env: process.env });
    if (r.code !== 0) throw new Error("Failed to create venv for face-service.");
  }

  console.log("[face] Installing Python dependencies… (first run may take a while)");
  let r = await runCmd(venvPython, ["-m", "pip", "install", "-U", "pip"], { cwd: faceDir, env: process.env });
  if (r.code !== 0) throw new Error("Failed to upgrade pip in face-service venv.");

  r = await runCmd(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"], { cwd: faceDir, env: process.env });
  if (r.code !== 0) {
    throw new Error("Failed to install face-service requirements. Ensure Python 3.11/3.12 is installed.");
  }

  if (!isVenvHealthy(venvPython)) {
    throw new Error("Face-service venv was created but dependencies are still missing.");
  }

  return { venvDir, pythonExe: venvPython };
}

async function main() {
  if (String(process.env.FACE_SERVICE_SKIP || "").toLowerCase() === "1") {
    console.log("[face] Skipped (FACE_SERVICE_SKIP=1)");
    return;
  }

  const required = String(process.env.FACE_SERVICE_REQUIRED || "").toLowerCase() === "1";

  let env;
  try {
    env = await ensureVenv();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.error("[face]", msg);
    if (required) process.exit(1);
    return;
  }

  const port = String(process.env.FACE_SERVICE_PORT || process.env.PORT || "8000");

  console.log(`[face] Starting uvicorn on port ${port}…`);

  const child = spawn(
    env.pythonExe,
    ["-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", port],
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
    console.error("[face] Failed to start uvicorn:", e);
    process.exit(required ? 1 : 0);
  });
}

main().catch((err) => {
  console.error("[face]", err && err.message ? err.message : String(err));
  process.exit(1);
});
