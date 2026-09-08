/**
 * 3-hour Alpha V2 PAPER forward validation — gated launcher.
 * Usage: npx tsx scripts/run-3h-paper-alpha-v2.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile, runPaperCampaign } from "./paper-campaign-runner-core";

loadEnvFile();

const DURATION_MS = 180 * 60 * 1000;
const CAMPAIGN_ID =
  process.argv.find((a) => a.startsWith("--campaignId="))?.split("=")[1] ??
  `paper-alpha-v2-3h-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const RESULT_FILE = "kripto-alpha-v2-3h-paper-result.json";
const SCOREBOARD = path.join(process.cwd(), "artifacts", "alpha-research", "alpha-scoreboard.json");

function assertPaperGates() {
  if (!fs.existsSync(SCOREBOARD)) {
    throw new Error("PAPER_GATE_BLOCKED: alpha-scoreboard.json missing");
  }
  const scoreboard = JSON.parse(fs.readFileSync(SCOREBOARD, "utf8")) as Array<{
    alphaId: string;
    status: string;
    validationExpectancy: number | null;
    testExpectancy: number | null;
    testProfitFactor: number | null;
    testNetPnl: number | null;
    robustnessPassed: boolean;
  }>;
  const ready = scoreboard.find(
    (s) =>
      s.status === "ROBUSTNESS_PASS" &&
      (s.testExpectancy ?? 0) > 0 &&
      (s.testProfitFactor ?? 0) > 1 &&
      (s.testNetPnl ?? 0) > 0 &&
      s.robustnessPassed,
  );
  if (!ready) {
    throw new Error("PAPER_GATE_BLOCKED: no alpha passed validation + final + robustness");
  }
  return ready;
}

async function main() {
  const alpha = assertPaperGates();
  const artifactRoot = path.join(process.cwd(), "artifacts", "paper-campaigns", CAMPAIGN_ID);
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(
    path.join(artifactRoot, "frozen-config.json"),
    JSON.stringify({ alphaId: alpha.alphaId, frozenAt: new Date().toISOString(), durationMs: DURATION_MS }, null, 2),
  );
  const result = await runPaperCampaign({
    durationMs: DURATION_MS,
    campaignId: CAMPAIGN_ID,
    artifactRoot,
    resultFile: RESULT_FILE,
    heartbeatMs: 120_000,
    pollMs: 15_000,
    maxWaitSec: 600,
    budgetPerTrade: 1000,
    terminalWaitMs: 300_000,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
