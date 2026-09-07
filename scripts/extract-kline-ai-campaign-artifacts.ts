/**
 * Extract kline/AI provider telemetry artifacts from tradeEventLog for a campaign window.
 */
import fs from "node:fs";
import path from "node:path";

export type ExtractKlineAiArtifactsInput = {
  campaignId: string;
  jobId: string;
  artifactRoot: string;
  startedAt: string;
  endedAt: string;
};

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function extractKlineAiCampaignArtifacts(input: ExtractKlineAiArtifactsInput) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (!(k in process.env)) process.env[k] = v;
  }

  const { prisma } = await import("@/src/server/db/prisma");
  const started = new Date(input.startedAt);
  const ended = new Date(input.endedAt);
  const job = input.jobId
    ? await prisma.autoRoundJob.findUnique({
        where: { id: input.jobId },
        include: { rounds: { orderBy: { roundNo: "asc" } } },
      })
    : null;

  const selectedSymbols = (job?.rounds ?? [])
    .filter((r) => r.symbol)
    .map((r) => String(r.symbol).toUpperCase());

  const eventTypes = ["AI_KLINE_INPUT", "AI_KLINE_STALE", "AI_ANALYSIS_STARTED", "AI_ANALYSIS_RESULT"];
  const logs = await prisma.tradeEventLog.findMany({
    where: {
      createdAt: { gte: started, lte: ended },
      eventType: { in: eventTypes },
      ...(selectedSymbols.length > 0 ? { symbol: { in: selectedSymbols } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });

  const klineInputTrace = logs
    .filter((row) => row.eventType === "AI_KLINE_INPUT")
    .map((row) => ({
      at: row.createdAt.toISOString(),
      symbol: row.symbol,
      ...(row.newValue as Record<string, unknown>),
    }));

  const klineRefreshTrace = klineInputTrace.map((row) => ({
    symbol: row.symbol,
    count: row.count,
    ageSec: row.ageSec,
    source: row.source,
    refreshAttempted: row.refreshAttempted,
    refreshSucceeded: row.refreshSucceeded,
    refreshed: row.refreshed,
    fresh: row.fresh,
    reasonCode: row.reasonCode,
  }));

  const aiProviderTrace = logs
    .filter((row) => row.eventType === "AI_ANALYSIS_RESULT")
    .map((row) => ({
      at: row.createdAt.toISOString(),
      symbol: row.symbol,
      reason: row.reason,
      aiConfidence: row.aiConfidence,
      ...(row.newValue as Record<string, unknown>),
    }));

  const consensusTrace = aiProviderTrace.map((row) => ({
    symbol: row.symbol,
    providerAttemptCount: row.providerAttemptCount ?? 0,
    providerSuccessCount: row.providerSuccessCount ?? 0,
    providerFailureCount: row.providerFailureCount ?? 0,
    outputsCount: row.outputsCount ?? 0,
    consensusDecision: row.consensusDecision ?? row.decision,
    consensusConfidence: row.consensusConfidence ?? row.confidence,
    consensusRisk: row.consensusRisk ?? row.riskScore,
    stale: String(row.reason ?? "").includes("Kline data missing or stale"),
  }));

  const staleEvents = logs
    .filter((row) => row.eventType === "AI_KLINE_STALE")
    .map((row) => ({
      at: row.createdAt.toISOString(),
      symbol: row.symbol,
      reason: row.reason,
      ...(row.newValue as Record<string, unknown>),
    }));

  writeJson(path.join(input.artifactRoot, "kline-input-trace.json"), {
    campaignId: input.campaignId,
    jobId: input.jobId,
    selectedSymbols,
    events: klineInputTrace,
  });
  writeJson(path.join(input.artifactRoot, "kline-refresh-trace.json"), {
    campaignId: input.campaignId,
    traces: klineRefreshTrace,
    staleEvents,
  });
  writeJson(path.join(input.artifactRoot, "ai-provider-trace.json"), {
    campaignId: input.campaignId,
    events: aiProviderTrace,
  });
  writeJson(path.join(input.artifactRoot, "consensus-trace.json"), {
    campaignId: input.campaignId,
    traces: consensusTrace,
  });

  await prisma.$disconnect();
  return {
    selectedSymbols,
    klineInputCount: klineInputTrace.length,
    staleCount: staleEvents.length,
    analysisResultCount: aiProviderTrace.length,
    providerAttempts: aiProviderTrace.reduce((s, r) => s + Number(r.providerAttemptCount ?? 0), 0),
    providerSuccesses: aiProviderTrace.reduce((s, r) => s + Number(r.providerSuccessCount ?? 0), 0),
    providerOutputs: aiProviderTrace.reduce((s, r) => s + Number(r.outputsCount ?? 0), 0),
    realConsensusCount: consensusTrace.filter(
      (r) => Number(r.outputsCount ?? 0) > 0 && Number(r.providerSuccessCount ?? 0) > 0,
    ).length,
    freshKlineInputs: klineInputTrace.filter((r) => r.fresh === true).length,
    refreshAttempts: klineInputTrace.filter((r) => r.refreshAttempted === true).length,
    refreshSuccess: klineInputTrace.filter((r) => r.refreshSucceeded === true).length,
  };
}

if (require.main === module) {
  const campaignId = process.argv.find((a) => a.startsWith("--campaignId="))?.split("=")[1];
  const jobId = process.argv.find((a) => a.startsWith("--jobId="))?.split("=")[1] ?? "";
  const artifactRoot =
    process.argv.find((a) => a.startsWith("--artifactRoot="))?.split("=")[1] ??
    path.join(process.cwd(), "artifacts", "paper-campaigns", campaignId ?? "unknown");
  const startedAt = process.argv.find((a) => a.startsWith("--startedAt="))?.split("=")[1] ?? new Date(0).toISOString();
  const endedAt = process.argv.find((a) => a.startsWith("--endedAt="))?.split("=")[1] ?? new Date().toISOString();
  if (!campaignId) {
    console.error("usage: --campaignId=... [--jobId=...] [--artifactRoot=...]");
    process.exit(1);
  }
  extractKlineAiCampaignArtifacts({ campaignId, jobId, artifactRoot, startedAt, endedAt })
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
