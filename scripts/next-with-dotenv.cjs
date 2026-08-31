const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { sanitizeNodeOptions } = require("./node-options-utils.cjs");
require("./load-dotenv.cjs");

function main() {
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const args = process.argv.slice(2);
  const requestedCommand = String(args[0] ?? "").toLowerCase();
  const nodeOptions = sanitizeNodeOptions(process.env.NODE_OPTIONS ?? "");
  const hasHeap = /--max-old-space-size=/.test(nodeOptions.sanitized);
  const resolvedNodeOptions = hasHeap
    ? nodeOptions.sanitized
    : `${nodeOptions.sanitized} --max-old-space-size=6144`.trim();
  const normalizedNodeEnv =
    process.env.NODE_ENV === "production" || process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
      ? process.env.NODE_ENV
      : undefined;
  const forceProduction = requestedCommand === "build";
  const env = {
    ...process.env,
    NODE_OPTIONS: resolvedNodeOptions,
    ...(forceProduction
      ? { NODE_ENV: "production" }
      : normalizedNodeEnv
        ? { NODE_ENV: normalizedNodeEnv }
        : {}),
  };
  if (!nodeOptions.valid) {
    const removed = nodeOptions.removed.map((row) => row.token).join(", ");
    console.warn(`[NODE_OPTIONS_SANITIZED] Removed unsupported tokens: ${removed}`);
  }
  const run = spawnSync(process.execPath, [nextBin, ...args], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  if (run.error) {
    console.error(run.error.message);
    process.exit(1);
  }
  process.exit(run.status ?? 1);
}

main();
