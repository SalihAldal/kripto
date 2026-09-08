/**
 * 3-hour OI Impulse Alpha V2 PAPER forward validation — gated launcher.
 * Usage: npx tsx scripts/run-oi-alpha-v2-3h-paper.ts --campaignId=...
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile, runPaperCampaign } from "./paper-campaign-runner-core";

loadEnvFile();

const DURATION_MS = 180 * 60 * 1000;
const CAMPAIGN_ID =
  process.argv.find((a) => a.startsWith("--campaignId="))?.split("=")[1] ??
  `paper-oi-alpha-v2-3h-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const RESULT_FILE = "kripto-oi-alpha-v2-3h-paper-result.json";
const GATE_FILE = path.join(process.cwd(), "kripto-oi-alpha-final-profitability-result.json");

function assertPaperGates() {
  if (!fs.existsSync(GATE_FILE)) {
    throw new Error("PAPER_GATE_BLOCKED: oi-alpha-final gate file missing");
  }
  const gate = JSON.parse(fs.readFileSync(GATE_FILE, "utf8")) as {
    deepDataGatePass?: boolean;
    blocker?: string | null;
    bestAlpha?: { walkForwardPass?: boolean };
    smoke?: { passed?: boolean };
  };
  if (!gate.deepDataGatePass) {
    throw new Error(`PAPER_GATE_BLOCKED: ${gate.blocker ?? "DEEP_DATA_GATE_FAIL"}`);
  }
  if (!gate.bestAlpha?.walkForwardPass) {
    throw new Error("PAPER_GATE_BLOCKED: OI walk-forward not passed");
  }
  if (!gate.smoke?.passed) {
    throw new Error("PAPER_GATE_BLOCKED: smoke not passed");
  }
  return gate;
}

async function main() {
  assertPaperGates();
  const artifactRoot = path.join(process.cwd(), "artifacts", "paper-campaigns", CAMPAIGN_ID);
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(
    path.join(artifactRoot, "frozen-config.json"),
    JSON.stringify(
      { alphaId: "OI_IMPULSE_LONG_V2", frozenAt: new Date().toISOString(), durationMs: DURATION_MS, liveTradingEnabled: false },
      null,
      2,
    ),
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
