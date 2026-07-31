import type { DecisionTimelineStage, Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import type { FeatureSnapshotInput, RejectReasonInput } from "@/src/server/observability/decision-observability.types";

function scheduleReplayEnqueue(decisionId: string) {
  void import("@/src/server/replay/decision-replay-queue")
    .then(({ enqueueReplayJob }) =>
      enqueueReplayJob({ type: "REPLAY_SINGLE", decisionId, cadence: "INCREMENTAL" }),
    )
    .catch(() => null);
}

function scheduleShadowCapture(decisionId: string) {
  void import("@/src/server/shadow-validation/shadow-validation-queue")
    .then(({ scheduleShadowCapture }) => scheduleShadowCapture(decisionId))
    .catch(() => null);
}

function scheduleDecisionLearning(decisionId: string) {
  void import("@/src/server/learning-engine/learning-engine-queue")
    .then(({ scheduleDecisionLearning }) => scheduleDecisionLearning(decisionId))
    .catch(() => null);
}

export type PersistDecisionLogInput = {
  decisionId: string;
  analysisId?: string;
  symbol: string;
  timestamp?: Date;
  scannerScore?: number | null;
  technicalScore?: number | null;
  volumeScore?: number | null;
  momentumScore?: number | null;
  trendScore?: number | null;
  regimeScore?: number | null;
  riskScore?: number | null;
  liquidityScore?: number | null;
  newsScore?: number | null;
  confidence?: number | null;
  decision: string;
  humanSummary?: string | null;
  rejectReasons?: Prisma.InputJsonValue;
  reasonWeights?: Prisma.InputJsonValue;
  marketState?: Prisma.InputJsonValue;
  strategyUsed?: string | null;
  executionAllowed: boolean;
  metadata?: Prisma.InputJsonValue;
  rejectReasonRows?: RejectReasonInput[];
  features?: FeatureSnapshotInput;
  timeline?: Array<{
    stage: DecisionTimelineStage;
    stepOrder: number;
    outcome: string;
    message?: string | null;
    details?: Prisma.InputJsonValue;
  }>;
};

export async function upsertDecisionLogRecord(input: PersistDecisionLogInput) {
  return prisma.$transaction(async (tx) => {
    const decision = await tx.decisionLog.upsert({
      where: { decisionId: input.decisionId },
      create: {
        decisionId: input.decisionId,
        analysisId: input.analysisId ?? input.decisionId,
        symbol: input.symbol.toUpperCase(),
        timestamp: input.timestamp ?? new Date(),
        scannerScore: input.scannerScore ?? undefined,
        technicalScore: input.technicalScore ?? undefined,
        volumeScore: input.volumeScore ?? undefined,
        momentumScore: input.momentumScore ?? undefined,
        trendScore: input.trendScore ?? undefined,
        regimeScore: input.regimeScore ?? undefined,
        riskScore: input.riskScore ?? undefined,
        liquidityScore: input.liquidityScore ?? undefined,
        newsScore: input.newsScore ?? undefined,
        confidence: input.confidence ?? undefined,
        decision: input.decision,
        humanSummary: input.humanSummary ?? undefined,
        rejectReasons: input.rejectReasons ?? undefined,
        reasonWeights: input.reasonWeights ?? undefined,
        marketState: input.marketState ?? undefined,
        strategyUsed: input.strategyUsed ?? undefined,
        executionAllowed: input.executionAllowed,
        metadata: input.metadata ?? undefined,
      },
      update: {
        analysisId: input.analysisId ?? undefined,
        symbol: input.symbol.toUpperCase(),
        scannerScore: input.scannerScore ?? undefined,
        technicalScore: input.technicalScore ?? undefined,
        volumeScore: input.volumeScore ?? undefined,
        momentumScore: input.momentumScore ?? undefined,
        trendScore: input.trendScore ?? undefined,
        regimeScore: input.regimeScore ?? undefined,
        riskScore: input.riskScore ?? undefined,
        liquidityScore: input.liquidityScore ?? undefined,
        newsScore: input.newsScore ?? undefined,
        confidence: input.confidence ?? undefined,
        decision: input.decision,
        humanSummary: input.humanSummary ?? undefined,
        rejectReasons: input.rejectReasons ?? undefined,
        reasonWeights: input.reasonWeights ?? undefined,
        marketState: input.marketState ?? undefined,
        strategyUsed: input.strategyUsed ?? undefined,
        executionAllowed: input.executionAllowed,
        metadata: input.metadata ?? undefined,
        updatedAt: new Date(),
      },
    });

    if (input.rejectReasonRows && input.rejectReasonRows.length > 0) {
      await tx.rejectReason.deleteMany({ where: { decisionId: input.decisionId } });
      await tx.rejectReason.createMany({
        data: input.rejectReasonRows.map((row) => ({
          decisionId: input.decisionId,
          reason: row.reason,
          category: row.category,
          weight: row.weight,
          severity: row.severity,
          rank: row.rank ?? null,
        })),
      });
    }

    if (input.features) {
      await tx.featureSnapshot.upsert({
        where: { decisionId: input.decisionId },
        create: {
          decisionId: input.decisionId,
          indicators: input.features.indicators as Prisma.InputJsonValue,
          momentum: input.features.momentum as Prisma.InputJsonValue,
          volume: input.features.volume as Prisma.InputJsonValue,
          orderBook: input.features.orderBook as Prisma.InputJsonValue,
          liquidity: input.features.liquidity as Prisma.InputJsonValue,
          spread: input.features.spread as Prisma.InputJsonValue,
          volatility: input.features.volatility as Prisma.InputJsonValue,
          atr: input.features.atr as Prisma.InputJsonValue,
          vwap: input.features.vwap as Prisma.InputJsonValue,
          rsi: input.features.rsi as Prisma.InputJsonValue,
          macd: input.features.macd as Prisma.InputJsonValue,
          ema: input.features.ema as Prisma.InputJsonValue,
          regime: input.features.regime as Prisma.InputJsonValue,
          funding: input.features.funding as Prisma.InputJsonValue,
          openInterest: input.features.openInterest as Prisma.InputJsonValue,
          whale: input.features.whale as Prisma.InputJsonValue,
          news: input.features.news as Prisma.InputJsonValue,
          raw: input.features.raw as Prisma.InputJsonValue,
        },
        update: {
          indicators: input.features.indicators as Prisma.InputJsonValue,
          momentum: input.features.momentum as Prisma.InputJsonValue,
          volume: input.features.volume as Prisma.InputJsonValue,
          orderBook: input.features.orderBook as Prisma.InputJsonValue,
          liquidity: input.features.liquidity as Prisma.InputJsonValue,
          spread: input.features.spread as Prisma.InputJsonValue,
          volatility: input.features.volatility as Prisma.InputJsonValue,
          atr: input.features.atr as Prisma.InputJsonValue,
          vwap: input.features.vwap as Prisma.InputJsonValue,
          rsi: input.features.rsi as Prisma.InputJsonValue,
          macd: input.features.macd as Prisma.InputJsonValue,
          ema: input.features.ema as Prisma.InputJsonValue,
          regime: input.features.regime as Prisma.InputJsonValue,
          funding: input.features.funding as Prisma.InputJsonValue,
          openInterest: input.features.openInterest as Prisma.InputJsonValue,
          whale: input.features.whale as Prisma.InputJsonValue,
          news: input.features.news as Prisma.InputJsonValue,
          raw: input.features.raw as Prisma.InputJsonValue,
        },
      });
    }

    if (input.timeline && input.timeline.length > 0) {
      await tx.decisionTimelineEvent.deleteMany({ where: { decisionId: input.decisionId } });
      await tx.decisionTimelineEvent.createMany({
        data: input.timeline.map((event) => ({
          decisionId: input.decisionId,
          stage: event.stage,
          stepOrder: event.stepOrder,
          outcome: event.outcome,
          message: event.message ?? null,
          details: event.details ?? undefined,
        })),
      });
    }

    return decision;
  }).then((decision) => {
    scheduleReplayEnqueue(input.decisionId);
    scheduleShadowCapture(input.decisionId);
    scheduleDecisionLearning(input.decisionId);
    return decision;
  });
}

export async function getDecisionLogByDecisionId(decisionId: string) {
  return prisma.decisionLog.findUnique({
    where: { decisionId },
    include: {
      rejectReasonRows: { orderBy: [{ rank: "asc" }, { weight: "desc" }] },
      featureSnapshot: true,
      timelineEvents: { orderBy: { stepOrder: "asc" } },
    },
  });
}

export async function listDecisionLogs(input?: {
  symbol?: string;
  decision?: string;
  limit?: number;
  since?: Date;
}) {
  const limit = Math.max(1, Math.min(500, Number(input?.limit ?? 100)));
  return prisma.decisionLog.findMany({
    where: {
      symbol: input?.symbol ? input.symbol.toUpperCase() : undefined,
      decision: input?.decision,
      createdAt: input?.since ? { gte: input.since } : undefined,
    },
    include: {
      rejectReasonRows: { orderBy: [{ rank: "asc" }, { weight: "desc" }], take: 10 },
      timelineEvents: { orderBy: { stepOrder: "asc" } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function appendDecisionTimelineEvents(
  decisionId: string,
  events: Array<{
    stage: DecisionTimelineStage;
    stepOrder: number;
    outcome: string;
    message?: string | null;
    details?: Prisma.InputJsonValue;
  }>,
) {
  if (events.length === 0) return;
  await prisma.decisionTimelineEvent.createMany({
    data: events.map((event) => ({
      decisionId,
      stage: event.stage,
      stepOrder: event.stepOrder,
      outcome: event.outcome,
      message: event.message ?? null,
      details: event.details ?? undefined,
    })),
  });
}
