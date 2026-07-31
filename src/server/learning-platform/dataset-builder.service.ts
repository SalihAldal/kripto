import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import {
  createTrainingDataset,
  persistLabeledRow,
  updateTrainingDatasetCounts,
} from "@/src/server/learning-platform/learning-platform.repository";
import { validateLabeledRow } from "@/src/server/learning-platform/dataset-validation.service";
import { extractLabelsFromReplay } from "@/src/server/learning-platform/label-extraction.service";
import { emitLearningPlatformEvent, LEARNING_PLATFORM_EVENT } from "@/src/server/learning-platform/learning-platform.events";

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inferCoinCategory(symbol: string) {
  const upper = symbol.toUpperCase();
  if (upper.includes("BTC")) return "BTC_RELATED";
  if (upper.includes("ETH")) return "ETH_RELATED";
  if (upper.endsWith("USDT")) return "USDT_PAIR";
  return "ALT";
}

export async function buildLabeledDataset(input?: { limit?: number; datasetId?: string }) {
  const limit = input?.limit ?? env.LEARNING_PLATFORM_DATASET_LIMIT;
  const humanDatasetId = input?.datasetId ?? `ds_${Date.now()}`;

  const dataset = await createTrainingDataset({
    datasetId: humanDatasetId,
    featureVersion: env.LEARNING_PLATFORM_FEATURE_VERSION,
    schemaVersion: env.LEARNING_PLATFORM_SCHEMA_VERSION,
    labelVersion: env.LEARNING_PLATFORM_LABEL_VERSION,
    metadata: { source: "learning-platform", limit },
  });

  const decisions = await prisma.decisionLog.findMany({
    where: {
      featureSnapshot: { isNot: null },
      replays: { some: { status: "COMPLETED", evaluation: { isNot: null } } },
    },
    include: {
      featureSnapshot: true,
      replays: {
        where: { status: "COMPLETED" },
        include: {
          evaluation: true,
          historicalOutcomes: true,
        },
        orderBy: { completedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  let valid = 0;
  let rejected = 0;
  let windowStart: Date | undefined;
  let windowEnd: Date | undefined;

  for (const decision of decisions) {
    const replay = decision.replays[0];
    if (!replay?.evaluation || !decision.featureSnapshot) continue;

    const labels = extractLabelsFromReplay(replay.evaluation, replay.historicalOutcomes);
    const meta = (decision.metadata as Record<string, unknown> | null) ?? {};
    const regimeSnap = decision.featureSnapshot.regime as Record<string, unknown> | null;
    const marketRegime = String(
      replay.evaluation.marketRegimeAfter ?? regimeSnap?.label ?? meta.marketRegime ?? "UNKNOWN",
    );

    const executionLog = await prisma.executionLog.findFirst({
      where: { symbol: decision.symbol.toUpperCase(), submittedAt: { gte: decision.timestamp } },
      orderBy: { submittedAt: "asc" },
    });

    const learningTrade = await prisma.learningTrade.findFirst({
      where: { symbol: decision.symbol.toUpperCase(), closedAt: { gte: decision.timestamp } },
      orderBy: { closedAt: "asc" },
    });

    const entryAnalysis = await prisma.entryAnalysis.findFirst({
      where: { symbol: decision.symbol.toUpperCase(), analyzedAt: { gte: decision.timestamp } },
      orderBy: { analyzedAt: "asc" },
    });

    const rowPayload = {
      trainingDatasetId: dataset.id,
      decisionId: decision.decisionId,
      symbol: decision.symbol.toUpperCase(),
      decision: decision.decision,
      featureSnapshot: decision.featureSnapshot as unknown as Record<string, unknown>,
      labels: labels as unknown as Record<string, unknown>,
      replayMetrics: {
        verdict: replay.evaluation.verdict,
        mfePct: replay.evaluation.mfePct,
        maePct: replay.evaluation.maePct,
        peakProfitPct: replay.evaluation.peakProfitPct,
        missedProfitPct: replay.evaluation.missedProfitPct,
      },
      executionMetrics: executionLog
        ? {
            slippagePct: executionLog.slippagePct,
            latencyMs: executionLog.latencyMs,
            fee: executionLog.fee,
            filledQuantity: executionLog.filledQuantity,
          }
        : undefined,
      entryMetrics: entryAnalysis
        ? {
            entryScore: entryAnalysis.entryScore,
            entryConfidence: entryAnalysis.entryConfidence,
            entryType: entryAnalysis.entryType,
            verdict: entryAnalysis.verdict,
          }
        : undefined,
      marketRegime,
      coinCategory: inferCoinCategory(decision.symbol),
      pnlPct: learningTrade ? num(learningTrade.returnPercent) : num(replay.evaluation.peakProfitPct),
      holdingTimeMinutes: learningTrade
        ? learningTrade.openedAt && learningTrade.closedAt
          ? (learningTrade.closedAt.getTime() - learningTrade.openedAt.getTime()) / 60_000
          : learningTrade.holdSec
            ? learningTrade.holdSec / 60
            : undefined
        : undefined,
      slippagePct: executionLog?.slippagePct ?? undefined,
      feePct: executionLog?.fee && executionLog.averageFillPrice
        ? (executionLog.fee / (executionLog.averageFillPrice * num(executionLog.filledQuantity, 1))) * 100
        : undefined,
      decisionTimestamp: decision.timestamp,
    };

    const validation = validateLabeledRow({
      ...rowPayload,
      replayCompletedAt: replay.completedAt,
    });

    await persistLabeledRow({
      ...rowPayload,
      validationStatus: validation.valid ? "VALID" : "REJECTED",
      rejectionReason: validation.reason,
    });

    if (validation.valid) {
      valid += 1;
      if (!windowStart || decision.timestamp < windowStart) windowStart = decision.timestamp;
      if (!windowEnd || decision.timestamp > windowEnd) windowEnd = decision.timestamp;
    } else {
      rejected += 1;
    }
  }

  const status = valid >= env.LEARNING_PLATFORM_MIN_DATASET_ROWS ? "READY" : valid > 0 ? "VALIDATED" : "REJECTED";
  await updateTrainingDatasetCounts(dataset.id, {
    rowCount: valid + rejected,
    validRowCount: valid,
    rejectedRowCount: rejected,
    status,
  });

  await prisma.trainingDataset.update({
    where: { id: dataset.id },
    data: { trainingWindowStart: windowStart, trainingWindowEnd: windowEnd },
  });

  emitLearningPlatformEvent(LEARNING_PLATFORM_EVENT.DATASET_BUILT, {
    datasetId: humanDatasetId,
    valid,
    rejected,
    status,
  });

  return { datasetId: humanDatasetId, trainingDatasetId: dataset.id, valid, rejected, status };
}
