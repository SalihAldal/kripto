/**
 * 3-hour Funding/Basis Alpha V3 PAPER forward validation — gated launcher.
 * Usage: npx tsx scripts/run-funding-basis-v3-3h-paper.ts --campaignId=...
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile, runPaperCampaign } from "./paper-campaign-runner-core";

loadEnvFile();

const DURATION_MS = 180 * 60 * 1000;
const CAMPAIGN_ID =
  process.argv.find((a) => a.startsWith("--campaignId="))?.split("=")[1] ??
  `paper-funding-basis-v3-3h-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const RESULT_FILE = "kripto-funding-basis-v3-3h-paper-result.json";
const GATE_FILE = path.join(process.cwd(), "kripto-funding-basis-alpha-v3-3h-result.json");

function assertPaperGates() {
  if (!fs.existsSync(GATE_FILE)) {
    throw new Error("PAPER_GATE_BLOCKED: funding-basis-v3 gate file missing");
  }
  const gate = JSON.parse(fs.readFileSync(GATE_FILE, "utf8")) as {
    alpha?: { walkForwardPass?: boolean; robustnessPassed?: boolean; freshExpectancy?: number; freshPF?: number };
    verdict?: string;
  };
  if (!gate.alpha?.walkForwardPass || !gate.alpha?.robustnessPassed) {
    throw new Error("PAPER_GATE_BLOCKED: funding basis v3 walk-forward or robustness not passed");
  }
  if ((gate.alpha?.freshExpectancy ?? 0) <= 0 || (gate.alpha?.freshPF ?? 0) <= 1) {
    throw new Error("PAPER_GATE_BLOCKED: fresh unseen metrics fail");
  }
  return gate;
}

async function main() {
  assertPaperGates();
  const artifactRoot = path.join(process.cwd(), "artifacts", "paper-campaigns", CAMPAIGN_ID);
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(
    path.join(artifactRoot, "frozen-config.json"),
    JSON.stringify({ alphaId: "FUNDING_BASIS_ALPHA_V3", frozenAt: new Date().toISOString(), durationMs: DURATION_MS }, null, 2),
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
