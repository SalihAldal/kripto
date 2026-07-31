import type { ExecutionComparisonResult, ExecutionQualityBreakdown, LatencyBreakdown, SlippageBreakdown } from "@/src/server/exchange-simulator/exchange-simulator.types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Number(value.toFixed(2));
}

export function scoreExecutionQuality(input: {
  slippagePct: number;
  fillRatio: number;
  spreadPct: number;
  depthCoverage: number;
  latency: LatencyBreakdown;
}): ExecutionQualityBreakdown {
  const slippageScore = round2(clamp(100 - input.slippagePct * 25, 0, 100));
  const fillScore = round2(clamp(input.fillRatio * 100, 0, 100));
  const spreadScore = round2(clamp(100 - input.spreadPct * 40, 0, 100));
  const liquidityScore = round2(clamp(input.depthCoverage * 100, 0, 100));
  const latencyScore = round2(clamp(100 - input.latency.totalMs / 4, 0, 100));
  const overallScore = round2(
    slippageScore * 0.3 + liquidityScore * 0.25 + spreadScore * 0.15 + fillScore * 0.2 + latencyScore * 0.1,
  );
  return {
    overallScore,
    slippageScore,
    liquidityScore,
    spreadScore,
    fillScore,
    latencyScore,
  };
}

export function buildSlippageBreakdown(input: {
  referencePrice: number;
  avgFillPrice: number;
  bestPrice: number;
  worstPrice: number;
  spreadPct: number;
  side: "BUY" | "SELL";
}): SlippageBreakdown {
  const slippagePct =
    input.referencePrice > 0
      ? Math.abs(((input.avgFillPrice - input.referencePrice) / input.referencePrice) * 100)
      : 0;
  const impactPct =
    input.bestPrice > 0 ? Math.abs(((input.worstPrice - input.bestPrice) / input.bestPrice) * 100) : 0;
  return {
    slippagePct: round2(slippagePct),
    slippageBps: round2(slippagePct * 100),
    bestPrice: input.bestPrice,
    worstPrice: input.worstPrice,
    midPrice: input.referencePrice,
    spreadPct: round2(input.spreadPct),
    impactPct: round2(impactPct),
  };
}

export function buildExecutionComparison(input: {
  requestedPrice: number;
  executedPrice: number;
  bestPossiblePrice: number;
  worstPossiblePrice: number;
  fees: number;
  executionTimeMs: number;
  side: "BUY" | "SELL";
}): ExecutionComparisonResult {
  const slippagePct =
    input.requestedPrice > 0
      ? Math.abs(((input.executedPrice - input.requestedPrice) / input.requestedPrice) * 100)
      : 0;
  const improvementBps =
    input.requestedPrice > 0
      ? ((input.bestPossiblePrice - input.executedPrice) / input.requestedPrice) * 10_000 *
        (input.side === "BUY" ? 1 : -1)
      : 0;
  return {
    requestedPrice: input.requestedPrice,
    executedPrice: input.executedPrice,
    bestPossiblePrice: input.bestPossiblePrice,
    worstPossiblePrice: input.worstPossiblePrice,
    slippagePct: round2(slippagePct),
    fees: input.fees,
    executionTimeMs: input.executionTimeMs,
    improvementBps: round2(improvementBps),
  };
}
