/**
 * Post-process a completed 5-round stress session (no new rounds started).
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("Usage: npx tsx scripts/run-5round-stress-postprocess.ts <sessionId>");
  process.exit(1);
}

async function main() {
  const { finalizeStressSession } = await import("./run-5round-stress-validation");
  const { exitCode } = await finalizeStressSession(sessionId, { runnerDbDisconnect: true });
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
