import type { DecisionVerdict, Prisma, ReplayJobCadence, ReplayWorkerJobType } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

export async function createReplayJob(input: {
  decisionId: string;
  symbol: string;
  originalDecision: string;
  decisionTime: Date;
  priceAtDecision?: number | null;
  cadence?: ReplayJobCadence;
}) {
  const existing = await prisma.decisionReplay.findFirst({
    where: { decisionId: input.decisionId, status: { in: ["PENDING", "RUNNING", "COMPLETED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing?.status === "COMPLETED") return existing;
  if (existing) {
    return prisma.decisionReplay.update({
      where: { id: existing.id },
      data: {
        status: "PENDING",
        errorMessage: null,
        cadence: input.cadence ?? existing.cadence,
      },
    });
  }
  return prisma.decisionReplay.create({
    data: {
      decisionId: input.decisionId,
      symbol: input.symbol.toUpperCase(),
      originalDecision: input.originalDecision,
      decisionTime: input.decisionTime,
      priceAtDecision: input.priceAtDecision ?? undefined,
      cadence: input.cadence ?? "INCREMENTAL",
      status: "PENDING",
    },
  });
}

export async function markReplayRunning(replayId: string) {
  return prisma.decisionReplay.update({
    where: { id: replayId },
    data: { status: "RUNNING", startedAt: new Date(), errorMessage: null },
  });
}

export async function markReplayFailed(replayId: string, errorMessage: string) {
  return prisma.decisionReplay.update({
    where: { id: replayId },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorMessage,
      retryCount: { increment: 1 },
    },
  });
}

export async function markReplaySkipped(replayId: string, reason: string) {
  return prisma.decisionReplay.update({
    where: { id: replayId },
    data: { status: "SKIPPED", completedAt: new Date(), errorMessage: reason },
  });
}

export async function persistReplayResult(input: {
  replayId: string;
  decisionId: string;
  evaluation: {
    verdict: DecisionVerdict;
    verdictConfidence?: number | null;
    metrics: {
      mfePct: number;
      maePct: number;
      peakProfitPct: number;
      maxDrawdownPct: number;
      atrMultiple: number | null;
      relativeStrengthAfter: number | null;
      volumeChangePct: number | null;
      volatilityChangePct: number | null;
      marketRegimeAfter: string | null;
      horizonReturns: Record<string, number>;
      missedProfitPct: number;
      missedLossPct: number;
    };
    summary?: string;
    metadata?: Record<string, unknown>;
  };
  historicalOutcomes: Array<{
    horizonLabel: string;
    horizonMs: number;
    targetTime: Date;
    priceAtHorizon: number;
    returnPct: number;
    highSinceDecision: number;
    lowSinceDecision: number;
    mfePct: number;
    maePct: number;
    volumeRatio?: number | null;
    volatilityPct?: number | null;
    regime?: string | null;
  }>;
  missedOpportunity?: Record<string, unknown> | null;
  attributions: Prisma.DecisionAttributionCreateManyInput[];
}) {
  return prisma.$transaction(async (tx) => {
    await tx.historicalOutcome.deleteMany({ where: { replayId: input.replayId } });
    await tx.decisionAttribution.deleteMany({ where: { replayId: input.replayId } });
    await tx.missedOpportunity.deleteMany({ where: { replayId: input.replayId } });
    await tx.decisionEvaluation.deleteMany({ where: { replayId: input.replayId } });

    await tx.decisionEvaluation.create({
      data: {
        replayId: input.replayId,
        decisionId: input.decisionId,
        verdict: input.evaluation.verdict,
        verdictConfidence: input.evaluation.verdictConfidence ?? undefined,
        mfePct: input.evaluation.metrics.mfePct,
        maePct: input.evaluation.metrics.maePct,
        peakProfitPct: input.evaluation.metrics.peakProfitPct,
        maxDrawdownPct: input.evaluation.metrics.maxDrawdownPct,
        atrMultiple: input.evaluation.metrics.atrMultiple ?? undefined,
        relativeStrengthAfter: input.evaluation.metrics.relativeStrengthAfter ?? undefined,
        volumeChangePct: input.evaluation.metrics.volumeChangePct ?? undefined,
        volatilityChangePct: input.evaluation.metrics.volatilityChangePct ?? undefined,
        marketRegimeAfter: input.evaluation.metrics.marketRegimeAfter ?? undefined,
        horizonReturns: asJson(input.evaluation.metrics.horizonReturns),
        missedProfitPct: input.evaluation.metrics.missedProfitPct,
        missedLossPct: input.evaluation.metrics.missedLossPct,
        summary: input.evaluation.summary,
        metadata: asJson(input.evaluation.metadata),
      },
    });

    if (input.historicalOutcomes.length > 0) {
      await tx.historicalOutcome.createMany({
        data: input.historicalOutcomes.map((row) => ({
          replayId: input.replayId,
          decisionId: input.decisionId,
          horizonLabel: row.horizonLabel,
          horizonMs: row.horizonMs,
          targetTime: row.targetTime,
          priceAtHorizon: row.priceAtHorizon,
          returnPct: row.returnPct,
          highSinceDecision: row.highSinceDecision,
          lowSinceDecision: row.lowSinceDecision,
          mfePct: row.mfePct,
          maePct: row.maePct,
          volumeRatio: row.volumeRatio ?? undefined,
          volatilityPct: row.volatilityPct ?? undefined,
          regime: row.regime ?? undefined,
        })),
      });
    }

    if (input.missedOpportunity) {
      const mo = input.missedOpportunity;
      await tx.missedOpportunity.create({
        data: {
          replayId: input.replayId,
          decisionId: String(mo.decisionId),
          symbol: String(mo.symbol),
          decisionTime: mo.decisionTime instanceof Date ? mo.decisionTime : new Date(String(mo.decisionTime)),
          priceAtDecision: Number(mo.priceAtDecision),
          highestPrice: Number(mo.highestPrice),
          lowestPrice: Number(mo.lowestPrice),
          bestReturnPct: Number(mo.bestReturnPct),
          worstReturnPct: Number(mo.worstReturnPct),
          missedProfitPct: Number(mo.missedProfitPct),
          missedLossPct: Number(mo.missedLossPct),
          classification: mo.classification as DecisionVerdict,
          confidence: mo.confidence != null ? Number(mo.confidence) : undefined,
          marketRegime: mo.marketRegime != null ? String(mo.marketRegime) : undefined,
          reasonRejected: mo.reasonRejected != null ? String(mo.reasonRejected) : undefined,
          horizonBreakdown: asJson(mo.horizonBreakdown),
        },
      });
    }

    if (input.attributions.length > 0) {
      await tx.decisionAttribution.createMany({ data: input.attributions });
    }

    return tx.decisionReplay.update({
      where: { id: input.replayId },
      data: { status: "COMPLETED", completedAt: new Date(), errorMessage: null },
    });
  });
}

export async function listPendingDecisionLogs(input?: { limit?: number; since?: Date; cursor?: string }) {
  const limit = Math.max(1, Math.min(500, input?.limit ?? 100));
  return prisma.decisionLog.findMany({
    where: {
      createdAt: input?.since ? { gte: input.since } : undefined,
      replays: { none: { status: "COMPLETED" } },
    },
    include: {
      rejectReasonRows: { orderBy: [{ rank: "asc" }, { weight: "desc" }] },
      featureSnapshot: true,
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    ...(input?.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
}

export async function listRejectedDecisions(input?: { limit?: number; since?: Date }) {
  const limit = Math.max(1, Math.min(500, input?.limit ?? 100));
  return prisma.decisionLog.findMany({
    where: {
      executionAllowed: false,
      decision: { in: ["NO_TRADE", "REJECT", "HOLD"] },
      createdAt: input?.since ? { gte: input.since } : undefined,
    },
    include: { rejectReasonRows: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getDecisionLogForReplay(decisionId: string) {
  return prisma.decisionLog.findUnique({
    where: { decisionId },
    include: {
      rejectReasonRows: { orderBy: [{ rank: "asc" }, { weight: "desc" }] },
      featureSnapshot: true,
      timelineEvents: { orderBy: { stepOrder: "asc" } },
    },
  });
}

export async function upsertReplayJobState(input: {
  jobType: ReplayWorkerJobType;
  cadence?: ReplayJobCadence;
  lastProcessedAt?: Date;
  lastDecisionId?: string;
  cursor?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.replayJobState.upsert({
    where: { jobType: input.jobType },
    create: {
      jobType: input.jobType,
      cadence: input.cadence,
      lastProcessedAt: input.lastProcessedAt,
      lastDecisionId: input.lastDecisionId,
      cursor: input.cursor,
      status: input.status ?? "IDLE",
      metadata: asJson(input.metadata),
    },
    update: {
      cadence: input.cadence ?? undefined,
      lastProcessedAt: input.lastProcessedAt ?? undefined,
      lastDecisionId: input.lastDecisionId ?? undefined,
      cursor: input.cursor ?? undefined,
      status: input.status ?? undefined,
      metadata: asJson(input.metadata),
    },
  });
}

export async function getReplayJobState(jobType: ReplayWorkerJobType) {
  return prisma.replayJobState.findUnique({ where: { jobType } });
}
