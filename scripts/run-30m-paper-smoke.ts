/**
 * 30-minute PAPER smoke validation runner.
 */
import path from "node:path";
import { loadEnvFile, runPaperCampaign } from "./paper-campaign-runner-core";

loadEnvFile();

const DURATION_MINUTES = Number(
  process.argv.find((a) => a.startsWith("--durationMinutes="))?.split("=")[1] ?? 30,
);
const CAMPAIGN_ID = String(
  process.argv.find((a) => a.startsWith("--campaignId="))?.split("=")[1] ??
    `paper-30m-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

runPaperCampaign({
  durationMs: DURATION_MINUTES * 60 * 1000,
  campaignId: CAMPAIGN_ID,
  artifactRoot: path.join(process.cwd(), "artifacts", "paper-campaigns", CAMPAIGN_ID),
  resultFile: "kripto-30m-paper-smoke-result.json",
  heartbeatMs: 60_000,
  pollMs: 10_000,
  maxWaitSec: 600,
  budgetPerTrade: 1000,
  terminalWaitMs: 120_000,
})
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    if ((result as { phase?: string }).phase === "PREFLIGHT_BLOCKED") process.exit(2);
    if ((result as { phase?: string }).phase === "START_FAILED") process.exit(3);
    if ((result as { reachedTerminal?: boolean }).reachedTerminal === false) process.exit(4);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
