/**
 * Poll until 8h paper campaign writes final-snapshot.json, then generate full report.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const CAMPAIGN_ID = process.argv.find((a) => a.startsWith("--campaignId="))?.split("=")[1] ?? "paper-8h-2026-09-07T0012Z";
const POLL_MS = Number(process.argv.find((a) => a.startsWith("--pollMs="))?.split("=")[1] ?? 60_000);
const MAX_WAIT_MS = Number(process.argv.find((a) => a.startsWith("--maxWaitHours="))?.split("=")[1] ?? 10) * 3_600_000;

const ARTIFACT_ROOT = path.join(process.cwd(), "artifacts", "paper-campaigns", CAMPAIGN_ID);
const FINAL_SNAPSHOT = path.join(ARTIFACT_ROOT, "final-snapshot.json");
const RESULT_FILE = path.join(process.cwd(), "kripto-8h-paper-result.json");

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function runGenerator() {
  return new Promise<number>((resolve) => {
    const child = spawn(
      process.execPath,
      [
        "-r",
        path.join(process.cwd(), "scripts", "load-dotenv.cjs"),
        path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
        path.join(process.cwd(), "scripts", "generate-8h-paper-final-report.ts"),
        `--campaignId=${CAMPAIGN_ID}`,
      ],
      { cwd: process.cwd(), stdio: "inherit", shell: false },
    );
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const started = Date.now();
  console.log(`[wait-report] watching ${FINAL_SNAPSHOT}`);
  while (Date.now() - started < MAX_WAIT_MS) {
    if (fs.existsSync(FINAL_SNAPSHOT)) {
      console.log("[wait-report] final-snapshot detected");
      const code = await runGenerator();
      process.exit(code);
    }
    const result = fs.existsSync(RESULT_FILE) ? JSON.parse(fs.readFileSync(RESULT_FILE, "utf8")) : null;
    if (result?.phase === "COMPLETED" || result?.endedAt) {
      console.log("[wait-report] result file shows completion");
      const code = await runGenerator();
      process.exit(code);
    }
    await sleep(POLL_MS);
  }
  console.error("[wait-report] timeout waiting for campaign completion");
  process.exit(2);
}

main();
