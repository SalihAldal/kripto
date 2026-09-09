/**
 * Gated short PAPER smoke for strategy validation winner.
 * Usage: npx tsx scripts/run-strategy-paper-smoke.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import path from "node:path";
import { loadEnvFile, runPaperCampaign } from "./paper-campaign-runner-core";

loadEnvFile();
process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";

const GATE = path.join(process.cwd(), "artifacts", "strategy-validation-result.json");
const DURATION_MS = 20 * 60 * 1000;

function assertGate() {
  if (!fs.existsSync(GATE)) throw new Error("PAPER_GATE_BLOCKED: run npm run strategy:validate first");
  const gate = JSON.parse(fs.readFileSync(GATE, "utf8")) as {
    paperEligible?: string | null;
    STRATEGY_VALIDATION_STATUS?: string;
    liveTradingEnabled?: boolean;
  };
  if (gate.STRATEGY_VALIDATION_STATUS !== "PASS" || !gate.paperEligible) {
    throw new Error("PAPER_GATE_BLOCKED: no paper-eligible strategy");
  }
  return gate;
}

async function main() {
  const gate = assertGate();
  const campaignId = `paper-strategy-${gate.paperEligible}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const artifactRoot = path.join(process.cwd(), "artifacts", "paper-campaigns", campaignId);
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(
    path.join(artifactRoot, "frozen-config.json"),
    JSON.stringify({ strategyVariant: gate.paperEligible, frozenAt: new Date().toISOString(), durationMs: DURATION_MS }, null, 2),
  );
  const result = await runPaperCampaign({
    durationMs: DURATION_MS,
    campaignId,
    artifactRoot,
    resultFile: "kripto-strategy-paper-smoke-result.json",
    heartbeatMs: 60_000,
    pollMs: 15_000,
    maxWaitSec: 300,
    budgetPerTrade: 1000,
    terminalWaitMs: 120_000,
  });
  fs.writeFileSync(path.join(process.cwd(), "artifacts", "strategy-paper-smoke-result.json"), JSON.stringify({ campaignId, gate: gate.paperEligible, result }, null, 2));
  console.log(JSON.stringify({ campaignId, status: "COMPLETED", ...result }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
