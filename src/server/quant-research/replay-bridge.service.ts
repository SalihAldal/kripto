import { prisma } from "@/src/server/db/prisma";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";

export type ReplayTradeContext = {
  learningTradeId: string;
  tradeId: string;
  symbol: string;
  baselineReturnPct: number;
  baselineHoldSec: number;
  decisionId: string | null;
  outcomes: Array<{
    horizonLabel: string;
    horizonMs: number;
    returnPct: number;
    mfePct: number;
    maePct: number;
  }>;
  evaluation: {
    mfePct: number | null;
    maePct: number | null;
    peakProfitPct: number | null;
    maxDrawdownPct: number | null;
    missedProfitPct: number | null;
    missedLossPct: number | null;
  } | null;
};

export async function fetchCompletedTradesForCounterfactual(input?: {
  limit?: number;
  windowDays?: number;
}) {
  return researchDbOnly(async () => {
    const limit = input?.limit ?? 100;
    const since =
      input?.windowDays != null
        ? new Date(Date.now() - input.windowDays * 24 * 60 * 60 * 1000)
        : undefined;

    const trades = await prisma.learningTrade.findMany({
      where: {
        closedAt: since ? { gte: since } : { not: null },
      },
      orderBy: { closedAt: "desc" },
      take: limit,
      select: {
        id: true,
        tradeId: true,
        symbol: true,
        returnPercent: true,
        holdSec: true,
        metadata: true,
        outcome: true,
        entryPrice: true,
        exitPrice: true,
        stopLossPercent: true,
        targetProfitPercent: true,
      },
    });

    const contexts: ReplayTradeContext[] = [];
    for (const trade of trades) {
      const meta = (trade.metadata as Record<string, unknown> | null) ?? {};
      const decisionId = typeof meta.decisionId === "string" ? meta.decisionId : null;
      const replay = decisionId
        ? await prisma.decisionReplay.findFirst({
            where: { decisionId, status: "COMPLETED" },
            orderBy: { completedAt: "desc" },
            include: {
              evaluation: true,
              historicalOutcomes: { orderBy: { horizonMs: "asc" } },
            },
          })
        : null;

      contexts.push({
        learningTradeId: trade.id,
        tradeId: trade.tradeId,
        symbol: trade.symbol,
        baselineReturnPct: Number(trade.returnPercent ?? 0),
        baselineHoldSec: trade.holdSec ?? 3600,
        decisionId,
        outcomes: (replay?.historicalOutcomes ?? []).map((o) => ({
          horizonLabel: o.horizonLabel,
          horizonMs: o.horizonMs,
          returnPct: Number(o.returnPct ?? 0),
          mfePct: Number(o.mfePct ?? 0),
          maePct: Number(o.maePct ?? 0),
        })),
        evaluation: replay?.evaluation
          ? {
              mfePct: replay.evaluation.mfePct,
              maePct: replay.evaluation.maePct,
              peakProfitPct: replay.evaluation.peakProfitPct,
              maxDrawdownPct: replay.evaluation.maxDrawdownPct,
              missedProfitPct: replay.evaluation.missedProfitPct,
              missedLossPct: replay.evaluation.missedLossPct,
            }
          : null,
      });
    }

    return contexts;
  });
}

export async function fetchReplayAccuracyMetrics(windowDays = 90) {
  return researchDbOnly(async () => {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const replays = await prisma.decisionReplay.findMany({
      where: { status: "COMPLETED", completedAt: { gte: since } },
      include: { evaluation: true },
      take: 5000,
    });

    if (replays.length === 0) return { replayAccuracy: 0, sampleSize: 0 };

    const correct = replays.filter((r) => {
      const verdict = r.evaluation?.verdict;
      if (!verdict || verdict === "UNKNOWN") return false;
      return verdict === "CORRECT" || verdict === "PARTIALLY_CORRECT";
    });

    return {
      replayAccuracy: Number(((correct.length / replays.length) * 100).toFixed(2)),
      sampleSize: replays.length,
    };
  });
}
