/**
 * 30-minute PAPER smoke for kline → AI provider consensus validation.
 */
import path from "node:path";
import { loadEnvFile, runPaperCampaign } from "./paper-campaign-runner-core";

loadEnvFile();

const DURATION_MINUTES = Number(
  process.argv.find((a) => a.startsWith("--durationMinutes="))?.split("=")[1] ?? 30,
);
const CAMPAIGN_ID = String(
  process.argv.find((a) => a.startsWith("--campaignId="))?.split("=")[1] ??
    `paper-kline-ai-30m-${new Date().toISOString().replace(/[:.]/g, "-")}`,
);

const artifactRoot = path.join(process.cwd(), "artifacts", "paper-campaigns", CAMPAIGN_ID);

runPaperCampaign({
  durationMs: DURATION_MINUTES * 60 * 1000,
  campaignId: CAMPAIGN_ID,
  artifactRoot,
  resultFile: "kripto-kline-ai-pipeline-validation-result.json",
  heartbeatMs: 60_000,
  pollMs: 10_000,
  maxWaitSec: 600,
  budgetPerTrade: 1000,
  terminalWaitMs: 180_000,
})
  .then(async (result) => {
    console.log(JSON.stringify(result, null, 2));
    try {
      const { extractKlineAiCampaignArtifacts } = await import("./extract-kline-ai-campaign-artifacts");
      await extractKlineAiCampaignArtifacts({
        campaignId: CAMPAIGN_ID,
        jobId: String((result as { jobId?: string }).jobId ?? ""),
        artifactRoot,
        startedAt: String((result as { jobStartedAt?: string }).jobStartedAt ?? ""),
        endedAt: String((result as { endedAt?: string }).endedAt ?? new Date().toISOString()),
      });
      const { buildKlineAiPipelineValidationReport } = await import("./build-kline-ai-pipeline-validation-report");
      await buildKlineAiPipelineValidationReport({ campaignId: CAMPAIGN_ID });
    } catch (error) {
      console.error("post-run artifact/report failed:", error instanceof Error ? error.message : String(error));
    }
    if ((result as { phase?: string }).phase === "PREFLIGHT_BLOCKED") process.exit(2);
    if ((result as { phase?: string }).phase === "START_FAILED") process.exit(3);
    if ((result as { reachedTerminal?: boolean }).reachedTerminal === false) process.exit(4);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
