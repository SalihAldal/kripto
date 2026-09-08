/**
 * 3-hour external microstructure alpha PAPER — gated launcher.
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile, runPaperCampaign } from "./paper-campaign-runner-core";

loadEnvFile();

const DURATION_MS = 180 * 60 * 1000;
const CAMPAIGN_ID =
  process.argv.find((a) => a.startsWith("--campaignId="))?.split("=")[1] ??
  `paper-external-alpha-v2-3h-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const GATE_FILE = path.join(process.cwd(), "kripto-external-microstructure-alpha-final-result.json");

function assertGates() {
  if (!fs.existsSync(GATE_FILE)) throw new Error("PAPER_GATE_BLOCKED: gate file missing");
  const gate = JSON.parse(fs.readFileSync(GATE_FILE, "utf8")) as { externalAlphaFound?: boolean };
  if (!gate.externalAlphaFound) throw new Error("PAPER_GATE_BLOCKED: external alpha not found");
}

async function main() {
  assertGates();
  const artifactRoot = path.join(process.cwd(), "artifacts", "paper-campaigns", CAMPAIGN_ID);
  fs.mkdirSync(artifactRoot, { recursive: true });
  const result = await runPaperCampaign({
    durationMs: DURATION_MS,
    campaignId: CAMPAIGN_ID,
    artifactRoot,
    resultFile: "kripto-external-alpha-v2-3h-paper-result.json",
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
