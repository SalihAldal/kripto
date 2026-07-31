import type { DecisionVerdict } from "@prisma/client";
import type { ReplayMetrics } from "@/src/server/replay/replay.types";
import { computeMissedProfit } from "@/src/server/replay/replay-verdict.service";

export function buildMissedOpportunityRecord(input: {
  decisionId: string;
  symbol: string;
  decisionTime: Date;
  priceAtDecision: number;
  originalDecision: string;
  executionAllowed: boolean;
  verdict: DecisionVerdict;
  confidence?: number | null;
  marketRegime?: string | null;
  reasonRejected?: string | null;
  metrics: ReplayMetrics;
}) {
  const missed = computeMissedProfit({
    originalDecision: input.originalDecision,
    executionAllowed: input.executionAllowed,
    metrics: input.metrics,
  });

  const isMissed =
    input.verdict === "MISSED_WINNER" ||
    input.verdict === "MISSED_BREAKOUT" ||
    input.verdict === "MISSED_PUMP" ||
    missed.missedProfitPct >= 2;

  if (!isMissed) return null;

  return {
    decisionId: input.decisionId,
    symbol: input.symbol.toUpperCase(),
    decisionTime: input.decisionTime,
    priceAtDecision: input.priceAtDecision,
    highestPrice: input.metrics.highestPrice,
    lowestPrice: input.metrics.lowestPrice,
    bestReturnPct: input.metrics.peakProfitPct,
    worstReturnPct: input.metrics.maePct,
    missedProfitPct: missed.missedProfitPct,
    missedLossPct: missed.missedLossPct,
    classification: input.verdict,
    confidence: input.confidence ?? null,
    marketRegime: input.marketRegime ?? null,
    reasonRejected: input.reasonRejected ?? null,
    horizonBreakdown: input.metrics.horizonReturns,
  };
}
