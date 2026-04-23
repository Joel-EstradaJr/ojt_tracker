const fs = require("fs");
const path = require("path");
const yaml = require("yaml");

const specPath = path.join(__dirname, "..", "openapi.yaml");
const spec = yaml.parse(fs.readFileSync(specPath, "utf8"));
const specPaths = spec.paths || {};

const httpMethods = new Set(["get", "post", "put", "patch", "delete"]);
const specSet = new Set();
for (const [route, methods] of Object.entries(specPaths)) {
  for (const [method, value] of Object.entries(methods || {})) {
    if (!httpMethods.has(method)) continue;
    if (!value) continue;
    specSet.add(`${method.toUpperCase()} ${route}`);
  }
}

const baseByFile = {
  "auth.routes.ts": "/api/auth",
  "backup.routes.ts": "/api/backup",
  "email.routes.ts": "/api/email",
  "export.routes.ts": "/api/export",
  "face.routes.ts": "/api/face",
  "import.routes.ts": "/api/import",
  "log.routes.ts": "/api/logs",
  "script.routes.ts": "/api/scripts",
  "settings.routes.ts": "/api/settings",
  "supervisor.routes.ts": "/api/supervisors",
  "trainee.routes.ts": "/api/trainees",
};

const routeDir = path.join(__dirname, "..", "src", "routes");
const routeSet = new Set(["GET /health"]);

for (const file of fs.readdirSync(routeDir)) {
  if (!file.endsWith(".ts")) continue;
  const base = baseByFile[file];
  if (!base) continue;

  const fullPath = path.join(routeDir, file);
  const source = fs.readFileSync(fullPath, "utf8");
  const regex = /router\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  let match;

  while ((match = regex.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const route = match[2];

    const combined = route === "/" ? base : base + (route.startsWith("/") ? route : `/${route}`);
    let openApiPath = combined.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    if (openApiPath.startsWith("/api/logs/") && /\{[^}]+\}$/.test(openApiPath)) {
      openApiPath = "/api/logs/{id}";
    }
    routeSet.add(`${method} ${openApiPath}`);
  }
}

const missing = [...routeSet].filter((route) => !specSet.has(route));
if (missing.length > 0) {
  console.error("OpenAPI spec is missing the following routes:");
  for (const route of missing) {
    console.error(`- ${route}`);
  }
  process.exit(1);
}

console.log("OpenAPI spec covers all registered routes.");
