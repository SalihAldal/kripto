import { clamp } from "@/src/server/opportunity/normalize";
import { FINAL_WEIGHTS, type MicrostructureConfig } from "@/src/server/microstructure/config";
import type {
  AiAdvisory,
  FinalRankedCandidate,
  HardRejectCode,
  MicroFeatures,
  MicroScoreBreakdown,
  MicroState,
  TdiShadow,
} from "@/src/server/microstructure/types";
import type { OpportunityCandidate } from "@/src/server/opportunity/types";
import { reasonCodesFor } from "@/src/server/microstructure/score";

export function combineFinalScore(input: {
  opportunityScore: number;
  microScore: number;
  liquidityScore: number;
  aiModifier: number;
}) {
  const base =
    input.opportunityScore * FINAL_WEIGHTS.opportunity +
    input.microScore * FINAL_WEIGHTS.micro +
    input.liquidityScore * FINAL_WEIGHTS.liquidity;
  return clamp(base + input.aiModifier, 0, 100);
}

export function tdiShadow(decision?: string, canonicalScore?: number): TdiShadow {
  const text = (decision ?? "SHADOW_NEUTRAL").toUpperCase();
  const tdiBearish = text.includes("SELL") || text.includes("REJECT") || text.includes("VETO");
  return {
    role: "SHADOW",
    decision: text,
    agreesWithCanonical: canonicalScore == null ? null : tdiBearish ? canonicalScore < 55 : canonicalScore >= 55,
    canReject: false,
  };
}

export function resolveMicroState(input: {
  previous: MicroState | null;
  hotAt: number;
  now: number;
  config: MicrostructureConfig;
  warmed: boolean;
  stale: boolean;
  hardReject: HardRejectCode | null;
  microScore: number;
  executionQuality: number;
  finalScore: number;
  spreadBps: number;
}): MicroState {
  if (input.hardReject) return "HARD_REJECT";
  if (input.now - input.hotAt > input.config.ttlMs) return "EXPIRED";
  if (input.stale) return input.previous === "EXECUTION_READY" ? "COOLING" : "WARMING";
  if (!input.warmed) return "WARMING";
  const confirmed = input.microScore >= input.config.confirmThreshold && input.finalScore >= input.config.dropThreshold;
  const executionFloor = Math.max(input.config.dropThreshold + 6, input.config.executionThreshold - 12);
  const ready =
    confirmed &&
    input.finalScore >= executionFloor &&
    input.executionQuality >= 56 &&
    input.spreadBps < input.config.wideSpreadBps;
  if (input.previous === "EXECUTION_READY") {
    if (ready) return "EXECUTION_READY";
    if (confirmed) return "MICRO_CONFIRMED";
    return input.finalScore < input.config.dropThreshold ? "COOLING" : "MICRO_CONFIRMED";
  }
  if (ready) return "EXECUTION_READY";
  if (confirmed) return "MICRO_CONFIRMED";
  if (input.previous === "MICRO_CONFIRMED" && input.finalScore >= input.config.dropThreshold) return "MICRO_CONFIRMED";
  if (input.previous === "COOLING" && input.finalScore < input.config.dropThreshold) return "EXPIRED";
  return "COOLING";
}

export function buildFinalCandidate(input: {
  opportunity: OpportunityCandidate;
  features: MicroFeatures;
  microScore: number;
  breakdown: MicroScoreBreakdown;
  liquidityScore: number;
  executionQuality: number;
  ai: AiAdvisory;
  previous?: FinalRankedCandidate;
  hotAt: number;
  now: number;
  config: MicrostructureConfig;
  hardReject: HardRejectCode | null;
  tdiDecision?: string;
  deepSubscribed: boolean;
}): FinalRankedCandidate {
  const finalScore = combineFinalScore({
    opportunityScore: input.opportunity.score,
    microScore: input.microScore,
    liquidityScore: input.liquidityScore,
    aiModifier: input.ai.modifier,
  });
  const smoothedScore = input.previous
    ? Number((input.previous.smoothedScore * 0.65 + finalScore * 0.35).toFixed(2))
    : finalScore;
  const warmed =
    input.now - input.hotAt >= input.config.warmupMs || input.features.tradeCount >= input.config.warmupTrades;
  const stale =
    !input.features.lastAggTradeAt ||
    input.now - input.features.lastAggTradeAt > input.config.staleMs ||
    (input.features.lastBookTickerAt > 0 && input.now - input.features.lastBookTickerAt > input.config.staleMs);
  const state = resolveMicroState({
    previous: input.previous?.state ?? null,
    hotAt: input.hotAt,
    now: input.now,
    config: input.config,
    warmed,
    stale,
    hardReject: input.hardReject,
    microScore: input.microScore,
    executionQuality: input.executionQuality,
    finalScore: smoothedScore,
    spreadBps: input.features.spreadBps,
  });
  const executionFloor = Math.max(input.config.dropThreshold + 6, input.config.executionThreshold - 12);
  const confirmed = input.microScore >= input.config.confirmThreshold && smoothedScore >= input.config.dropThreshold;
  const reasons = reasonCodesFor(input.features, input.breakdown);
  if (!warmed) reasons.push("MICRO_WARMING");
  if (stale) reasons.push("MICRO_DATA_STALE");
  if (confirmed && state !== "EXECUTION_READY") {
    if (smoothedScore < executionFloor) reasons.push("EXECUTION_FINAL_SCORE_BELOW_THRESHOLD");
    if (input.executionQuality < 56) reasons.push("EXECUTION_QUALITY_BELOW_THRESHOLD");
    if (input.features.spreadBps >= input.config.wideSpreadBps) reasons.push("EXECUTION_SPREAD_TOO_WIDE");
  }
  const warnings = reasons.filter((code) =>
    [
      "MICRO_SELL_FLOW_DOMINANT",
      "MICRO_FLOW_DIVERGENCE",
      "MICRO_ASK_RELOAD",
      "MICRO_BID_WITHDRAWAL",
      "MICRO_FAILED_BREAKOUT",
      "MICRO_EXHAUSTION",
      "MICRO_LOW_ACTIVITY",
      "MICRO_WIDE_SPREAD",
      "MICRO_DATA_STALE",
    ].includes(code),
  );
  const timingBase = input.previous?.timing;
  const firstAggTradeAt = input.features.lastAggTradeAt > 0 ? input.features.lastAggTradeAt : timingBase?.firstAggTradeAt ?? null;
  const firstBookTickerAt =
    input.features.lastBookTickerAt > 0 ? input.features.lastBookTickerAt : timingBase?.firstBookTickerAt ?? null;
  const deepActiveAt =
    (firstAggTradeAt && firstBookTickerAt ? Math.min(firstAggTradeAt, firstBookTickerAt) : firstAggTradeAt || firstBookTickerAt) ??
    timingBase?.deepActiveAt ??
    null;
  const microWarmupStartedAt =
    state === "WARMING"
      ? timingBase?.microWarmupStartedAt ?? input.now
      : timingBase?.microWarmupStartedAt ?? null;
  const microDataReadyAt =
    state === "WARMING"
      ? timingBase?.microDataReadyAt ?? null
      : timingBase?.microDataReadyAt ?? input.now;
  const terminalState = state === "EXECUTION_READY" || state === "MICRO_CONFIRMED" || state === "HARD_REJECT" || state === "EXPIRED";
  const deepSubscribeRequestedAt = timingBase?.deepSubscribeRequestedAt ?? null;
  const subscribeActivationLatencyMs =
    deepSubscribeRequestedAt && deepActiveAt ? Math.max(0, deepActiveAt - deepSubscribeRequestedAt) : null;
  const firstDeepEventLatencyMs = deepActiveAt ? Math.max(0, deepActiveAt - input.hotAt) : null;
  const warmupDurationMs =
    microWarmupStartedAt && microDataReadyAt ? Math.max(0, microDataReadyAt - microWarmupStartedAt) : null;
  const hotToMicroAnalyzeLatencyMs = Math.max(0, input.now - input.hotAt);
  return {
    candidateId: input.opportunity.candidateId,
    symbol: input.opportunity.symbol,
    quoteVolume24h: input.opportunity.features.quoteVolume24h,
    change24h: input.opportunity.features.change24h,
    lane: input.opportunity.primaryLane,
    opportunityScore: input.opportunity.score,
    opportunityBreakdown: input.opportunity.breakdown,
    microScore: input.microScore,
    microBreakdown: input.breakdown,
    liquidityScore: input.liquidityScore,
    executionQuality: input.executionQuality,
    ai: input.ai,
    tdi: tdiShadow(input.tdiDecision, smoothedScore),
    finalScore,
    smoothedScore,
    rank: 0,
    confidence: clamp(40 + smoothedScore * 0.5, 0, 96),
    state,
    reasonCodes: reasons,
    warnings,
    hardReject: input.hardReject,
    firstDetectedAt: input.opportunity.firstDetectedAt,
    firstDetectionPrice: input.opportunity.firstDetectionPrice,
    hotAt: input.hotAt,
    microReadyAt:
      state === "MICRO_CONFIRMED" || state === "EXECUTION_READY"
        ? input.previous?.microReadyAt ?? input.now
        : null,
    currentPrice: input.opportunity.currentPrice,
    features: input.features,
    deepSubscribed: input.deepSubscribed,
    timing: {
      hotAt: input.hotAt,
      deepSubscribeRequestedAt,
      deepActiveAt,
      firstAggTradeAt,
      firstBookTickerAt,
      microWarmupStartedAt,
      microDataReadyAt,
      microAnalyzedAt: input.now,
      terminalAt: terminalState ? input.now : timingBase?.terminalAt ?? null,
      subscribeActivationLatencyMs,
      firstDeepEventLatencyMs,
      warmupDurationMs,
      hotToMicroAnalyzeLatencyMs,
    },
  };
}

export function rankWithHysteresis(rows: FinalRankedCandidate[], previous: FinalRankedCandidate[]) {
  const sorted = [...rows].sort((a, b) => b.smoothedScore - a.smoothedScore);
  const prevLeader = previous.find((row) => row.rank === 1);
  if (prevLeader && sorted[0] && sorted[0].candidateId !== prevLeader.candidateId) {
    const oldLeader = sorted.find((row) => row.candidateId === prevLeader.candidateId);
    if (oldLeader && sorted[0].smoothedScore - oldLeader.smoothedScore < 2.2) {
      sorted.splice(sorted.indexOf(oldLeader), 1);
      sorted.unshift(oldLeader);
    }
  }
  return sorted.map((row, index) => {
    row.rank = index + 1;
    return row;
  });
}
