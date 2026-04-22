const { spawn, spawnSync } = require("child_process");
const net = require("net");
const path = require("path");
const fs = require("fs");

const isWin = process.platform === "win32";
const comspec = process.env.ComSpec || "cmd.exe";
const npmCmd = "npm";

function dockerAvailable() {
  try {
    const r = spawnSync("docker", ["version"], { stdio: "ignore", windowsHide: true });
    return typeof r.status === "number" && r.status === 0;
  } catch {
    return false;
  }
}

function parseDotEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    const text = fs.readFileSync(filePath, "utf8");
    const out = {};

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();

      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }

      out[key] = val;
    }

    return out;
  } catch {
    return {};
  }
}

function npmCommand(npmArgs) {
  if (!isWin) return { cmd: npmCmd, args: npmArgs };
  // Avoid Node's shell=true warning by explicitly running through cmd.exe.
  return { cmd: comspec, args: ["/d", "/s", "/c", npmCmd, ...npmArgs] };
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    // Bind to all interfaces to detect conflicts with typical dev servers.
    srv.listen(port);
  });
}

async function pickPort(preferred, maxTries = 20) {
  for (let p = preferred; p < preferred + maxTries; p++) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No free port found starting at ${preferred}.`);
}

function spawnProc(label, cmd, args, env) {
  const child = spawn(cmd, args, {
    cwd: path.join(__dirname, ".."),
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  child.__label = label;
  return child;
}

function spawnNpm(label, npmArgs, env) {
  const { cmd, args } = npmCommand(npmArgs);
  return spawnProc(label, cmd, args, env);
}

function runOnce(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: path.join(__dirname, ".."),
      env,
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("exit", (code) => resolve(typeof code === "number" ? code : 1));
    child.on("error", () => resolve(1));
  });
}

function killTree(child) {
  if (!child || child.killed) return;

  if (isWin && typeof child.pid === "number") {
    // Ensure we stop the whole process tree (npm -> node -> next/ts-node-dev).
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
}

async function main() {
  const backendEnvPath = path.join(__dirname, "..", "backend", ".env");
  const backendEnvFromFile = parseDotEnvFile(backendEnvPath);
  // Shell env overrides file env.
  const baseEnv = { ...backendEnvFromFile, ...process.env };

  const preferredFrontend = toInt(baseEnv.FRONTEND_PORT) ?? 3000;
  const preferredBackend = toInt(baseEnv.BACKEND_PORT) ?? 4000;
  const preferredFace = toInt(baseEnv.FACE_SERVICE_PORT) ?? 8000;

  const frontendPort = await pickPort(preferredFrontend);
  const backendPort = await pickPort(preferredBackend);

  const skipFace = String(baseEnv.FACE_SERVICE_SKIP || "").toLowerCase() === "1";
  const requiredFace = String(baseEnv.FACE_SERVICE_REQUIRED || "").toLowerCase() === "1";

  const hasDocker = dockerAvailable();
  const wantFace = !skipFace;

  // If the user explicitly provided a remote face-service URL, never override it.
  const externalFaceUrl = (baseEnv.FACE_SERVICE_URL || "").trim() || null;

  // Respect explicit FACE_ENGINE if provided.
  const explicitEngine = String(baseEnv.FACE_ENGINE || "").trim().toLowerCase();
  const engineForcedOff = explicitEngine === "off";
  const engineForcedLocal = explicitEngine === "local";
  const engineForcedRemote = explicitEngine === "remote";

  const useExternalRemote = wantFace && !!externalFaceUrl && !engineForcedOff && !engineForcedLocal;
  const runDockerFace = wantFace && !useExternalRemote && !engineForcedOff && !engineForcedLocal && hasDocker;
  const useLocalFace = wantFace && !useExternalRemote && !engineForcedOff && !runDockerFace;

  // Only reserve a face-service port if we intend to run the Docker face-service.
  const facePort = runDockerFace ? await pickPort(preferredFace) : null;

  const frontendUrl = `http://localhost:${frontendPort}`;
  const backendUrl = `http://localhost:${backendPort}`;

  console.log(`[dev] Frontend: ${frontendUrl}`);
  console.log(`[dev] Backend:  ${backendUrl}`);
  if (useExternalRemote) console.log(`[dev] Face:     ${externalFaceUrl} (external)`);
  else if (facePort) console.log(`[dev] Face:     http://localhost:${facePort}`);
  else if (useLocalFace) console.log(`[dev] Face:     local (no Docker)`);
  else console.log(`[dev] Face:     disabled`);

  const fresh = process.argv.includes("--fresh");
  if (fresh) {
    const { cmd, args } = npmCommand(["run", "clean", "--prefix", "frontend"]);
    const code = await runOnce(cmd, args, baseEnv);
    if (code !== 0) process.exit(code);
  }

  const children = [];

  if (runDockerFace) {
    const env = {
      ...baseEnv,
      FACE_SERVICE_PORT: String(facePort),
      PORT: String(facePort),
    };
    children.push(spawnNpm("face", ["run", "dev:face"], env));
  }

  {
    const env = {
      ...baseEnv,
      PORT: String(backendPort),
      FRONTEND_URL: frontendUrl,
      ...(runDockerFace && facePort ? { FACE_SERVICE_URL: `http://localhost:${facePort}` } : {}),
      ...(useLocalFace && !baseEnv.FACE_ENGINE ? { FACE_ENGINE: "local" } : {}),
    };
    children.push(spawnNpm("backend", ["run", "dev", "--prefix", "backend"], env));
  }

  {
    const env = {
      ...baseEnv,
      BACKEND_URL: backendUrl,
    };
    children.push(spawnNpm("frontend", ["run", "dev", "--prefix", "frontend", "--", "-p", String(frontendPort)], env));
  }

  function shutdownAll(exitCode) {
    for (const c of children) killTree(c);
    process.exit(exitCode);
  }

  for (const c of children) {
    c.on("exit", (code) => {
      const exitCode = typeof code === "number" ? code : 1;
      if (c.__label === "face" && !requiredFace) {
        // face-service is optional unless explicitly required
        return;
      }
      if (exitCode !== 0) shutdownAll(exitCode);
    });

    c.on("error", () => {
      if (c.__label === "face" && !requiredFace) return;
      shutdownAll(1);
    });
  }

  process.on("SIGINT", () => shutdownAll(0));
  process.on("SIGTERM", () => shutdownAll(0));
}

main().catch((err) => {
  // Print full error for debugging spawn failures on Windows.
  console.error("[dev]", err);
  process.exit(1);
});
