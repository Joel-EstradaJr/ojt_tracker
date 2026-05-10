const { spawn, spawnSync } = require("child_process");
const net = require("net");
const path = require("path");
const fs = require("fs");

const isWin = process.platform === "win32";
const comspec = process.env.ComSpec || "cmd.exe";
const npmCmd = "npm";
const backendImage = "ojt-backend-openface";
const backendContainer = "ojt-openface-dev";

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
  const preferredBackend = toInt(baseEnv.BACKEND_PORT) ?? 10000;

  const frontendPort = await pickPort(preferredFrontend);
  const backendPort = await pickPort(preferredBackend);

  const frontendUrl = `http://localhost:${frontendPort}`;
  const backendUrl = `http://localhost:${backendPort}`;

  console.log(`[dev] Frontend: ${frontendUrl}`);
  console.log(`[dev] Backend:  ${backendUrl}`);
  console.log("[dev] Face:     Docker backend includes the OpenFace CLI runtime");

  const fresh = process.argv.includes("--fresh");
  if (fresh) {
    const { cmd, args } = npmCommand(["run", "clean", "--prefix", "frontend"]);
    const code = await runOnce(cmd, args, baseEnv);
    if (code !== 0) process.exit(code);
  }

  const buildCode = await runOnce("docker", ["build", "-t", backendImage, "backend"], baseEnv);
  if (buildCode !== 0) process.exit(buildCode);

  await runOnce("docker", ["rm", "-f", backendContainer], baseEnv);

  const children = [];

  {
    const env = {
      ...baseEnv,
      PORT: "10000",
      FRONTEND_URL: frontendUrl,
      FACE_ENGINE: "openface-cli",
      OPENFACE_CLI_PATH: "/opt/openface/build/bin/FeatureExtraction",
      OPENBLAS_NUM_THREADS: "1",
      OMP_NUM_THREADS: "1",
      VECLIB_MAXIMUM_THREADS: "1",
    };
    // Rewrite DATABASE_URL so the container can reach the host's PostgreSQL.
    // Inside Docker, "localhost" means the container itself, so we swap it
    // for "host.docker.internal" which Docker resolves to the host machine.
    const rawDbUrl = baseEnv.DATABASE_URL || "";
    const dockerDbUrl = rawDbUrl.replace(
      /localhost(:\d+)/,
      "host.docker.internal$1"
    );

    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      backendContainer,
      "--add-host=host.docker.internal:host-gateway",
      "-p",
      `${backendPort}:10000`,
      "--env-file",
      backendEnvPath,
      "-e",
      `DATABASE_URL=${dockerDbUrl}`,
      "-e",
      "PORT=10000",
      "-e",
      `FRONTEND_URL=${frontendUrl}`,
      "-e",
      "FACE_ENGINE=openface-cli",
      "-e",
      "OPENFACE_CLI_PATH=/opt/openface/build/bin/FeatureExtraction",
      "-e",
      "OPENBLAS_NUM_THREADS=1",
      "-e",
      "OMP_NUM_THREADS=1",
      "-e",
      "VECLIB_MAXIMUM_THREADS=1",
      backendImage,
    ];
    children.push(spawnProc("backend", "docker", dockerArgs, env));
  }

  {
    const env = {
      ...baseEnv,
      BACKEND_URL: backendUrl,
      NEXT_PUBLIC_API_URL: backendUrl,
      PORT: String(frontendPort),
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
      if (exitCode !== 0) shutdownAll(exitCode);
    });

    c.on("error", () => {
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
