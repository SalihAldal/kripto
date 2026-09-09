/**
 * Gated short PAPER smoke for strategy validation winner.
 * Usage: npx tsx scripts/run-strategy-paper-smoke.ts
 */
import "./load-dotenv.cjs";
import fs from "node:fs";
import { sourceFingerprint } from "./strategy-evidence-io";
import { TRY_REPLAY_VERSION } from "../src/server/alpha-engine-v2/try-spot-replay.service";
import path from "node:path";
import { loadEnvFile, runPaperCampaign } from "./paper-campaign-runner-core";

process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";

const GATE = path.join(process.cwd(), "artifacts", "strategy-validation-result.json");
const DURATION_MS = 20 * 60 * 1000;

function assertGate() {
  if (!fs.existsSync(GATE)) throw new Error("PAPER_GATE_BLOCKED: run npm run strategy:validate first");
  const gate = JSON.parse(fs.readFileSync(GATE, "utf8")) as {
    status?: string; sourceHash?: string; replayVersion?: string; diagnostic?: boolean; researchOnly?: boolean;
    paperEligible?: string | null;
    STRATEGY_VALIDATION_STATUS?: string;
    liveTradingEnabled?: boolean;
  };
  if (gate.status !== "COMPLETED" || gate.replayVersion !== TRY_REPLAY_VERSION || gate.sourceHash !== sourceFingerprint() || gate.diagnostic || gate.researchOnly || gate.STRATEGY_VALIDATION_STATUS !== "PASS" || !gate.paperEligible) {
    throw new Error("PAPER_GATE_BLOCKED: no paper-eligible strategy");
  }
  return gate;
}

async function main() {
  const gate = assertGate();
  loadEnvFile();
  process.env.TRADE_DECISION_CORE_ENABLED = "true";
  process.env.TRADE_DECISION_CORE_VARIANT_ID = gate.paperEligible!;
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
  console.log(JSON.stringify({ status: "phase" in result ? result.phase : "COMPLETED", ...result }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
