/**
 * 8-hour wall-clock PAPER campaign runner.
 */
import path from "node:path";
import { loadEnvFile, runPaperCampaign } from "./paper-campaign-runner-core";

loadEnvFile();

const cli = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg) => arg.trim())
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [k, ...rest] = arg.slice(2).split("=");
      return [k, rest.length ? rest.join("=") : "true"];
    }),
);

const DURATION_HOURS = Number(cli.durationHours ?? cli.hours ?? 8);
const CAMPAIGN_ID = String(cli.campaignId ?? `paper-8h-${new Date().toISOString().replace(/[:.]/g, "-")}`);

runPaperCampaign({
  durationMs: DURATION_HOURS * 60 * 60 * 1000,
  campaignId: CAMPAIGN_ID,
  artifactRoot: path.join(process.cwd(), "artifacts", "paper-campaigns", CAMPAIGN_ID),
  resultFile: String(cli.out ?? "kripto-8h-paper-result.json"),
  heartbeatMs: Number(cli.heartbeatMs ?? 5 * 60_000),
  pollMs: Number(cli.pollMs ?? 15_000),
  maxWaitSec: Number(cli.maxWaitSec ?? 600),
  budgetPerTrade: Number(cli.budgetPerTrade ?? 1000),
  terminalWaitMs: Number(cli.terminalWaitMs ?? 120_000),
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
