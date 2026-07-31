import type { AIAnalysisInput, AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";
import type { SignalQualityResult } from "@/src/server/execution/signal-quality-gate.service";
import type {
  DecisionScoreSnapshot,
  FeatureSnapshotInput,
  RejectReasonInput,
} from "@/src/server/observability/decision-observability.types";

const REJECT_CATEGORY_RULES: Array<{ pattern: RegExp; category: string; severity: number }> = [
  { pattern: /liquidity|likidite|volume|dead market/i, category: "liquidity", severity: 0.95 },
  { pattern: /order book|orderbook|book deviation|spread/i, category: "liquidity", severity: 0.85 },
  { pattern: /momentum|flow|velocity|breakout stage/i, category: "momentum", severity: 0.8 },
  { pattern: /regime|chop|transition|volatility calm|bear|bull/i, category: "regime", severity: 0.75 },
  { pattern: /risk|trap|leverage|futures|funding|oi|open interest/i, category: "risk", severity: 0.9 },
  { pattern: /mtf|timeframe|trend|alignment|technical|indicator/i, category: "trend", severity: 0.7 },
  { pattern: /news|sentiment|macro|haber/i, category: "news", severity: 0.65 },
  { pattern: /data quality|stale|missing|degraded|kline/i, category: "data_quality", severity: 0.88 },
  { pattern: /quality|score below|confirmation|setup/i, category: "quality", severity: 0.82 },
  { pattern: /orchestration|learning|memory|cooldown|safe mode|emergency/i, category: "policy", severity: 0.78 },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function categorizeRejectReason(reason: string, weightHint?: number): RejectReasonInput {
  const matched = REJECT_CATEGORY_RULES.find((rule) => rule.pattern.test(reason));
  const weight = weightHint ?? (matched?.severity ?? 0.5);
  return {
    reason,
    category: matched?.category ?? "general",
    weight: Number(weight.toFixed(4)),
    severity: Number((matched?.severity ?? 0.5).toFixed(4)),
  };
}

export function rankRejectReasons(reasons: RejectReasonInput[], limit = 10): RejectReasonInput[] {
  const deduped = new Map<string, RejectReasonInput>();
  for (const reason of reasons) {
    const key = `${reason.category}:${reason.reason}`;
    const existing = deduped.get(key);
    if (!existing || reason.weight > existing.weight) {
      deduped.set(key, reason);
    }
  }
  return Array.from(deduped.values())
    .sort((a, b) => b.weight - a.weight || b.severity - a.severity)
    .slice(0, limit)
    .map((reason, index) => ({ ...reason, rank: index + 1 }));
}

export function buildHumanDecisionSummary(input: {
  symbol: string;
  decision: string;
  executionAllowed: boolean;
  topReasons: RejectReasonInput[];
  confidence?: number | null;
}): string {
  const symbol = input.symbol.toUpperCase();
  const decision = input.decision.toUpperCase();
  if (input.executionAllowed) {
    return `${symbol} trade approved with ${decision} decision${input.confidence != null ? ` at ${input.confidence.toFixed(1)}% confidence` : ""}.`;
  }
  if (input.topReasons.length === 0) {
    return `${symbol} trade rejected with ${decision} decision; no structured rejection reasons were captured.`;
  }
  const primary = input.topReasons.slice(0, 3).map((row) => row.reason).join("; ");
  return `Trade rejected for ${symbol} because ${primary}.`;
}

export function extractScoresFromAi(result: AIConsensusResult, scannerScore?: number): DecisionScoreSnapshot {
  const technical = result.roleScores?.find((row) => row.role === "AI-1_TECHNICAL")?.score;
  const sentiment = result.roleScores?.find((row) => row.role === "AI-2_SENTIMENT")?.score;
  const riskRole = result.roleScores?.find((row) => row.role === "AI-3_RISK")?.score;
  const scorecard = result.analysisScorecard as Record<string, unknown> | undefined;
  return {
    scannerScore: scannerScore ?? (typeof result.score === "number" ? result.score : null),
    technicalScore: technical ?? (typeof scorecard?.technicalScore === "number" ? scorecard.technicalScore : null),
    volumeScore: typeof scorecard?.volumeScore === "number" ? scorecard.volumeScore : null,
    momentumScore: typeof scorecard?.momentumScore === "number" ? scorecard.momentumScore : null,
    trendScore: typeof scorecard?.trendScore === "number" ? scorecard.trendScore : result.decisionPayload?.timeframeAnalysis?.alignmentScore ?? null,
    regimeScore: typeof scorecard?.regimeScore === "number" ? scorecard.regimeScore : result.decisionPayload?.regimeStability?.stabilityScore ?? null,
    riskScore: result.finalRiskScore ?? riskRole ?? null,
    liquidityScore: typeof scorecard?.liquidityScore === "number" ? scorecard.liquidityScore : null,
    newsScore: sentiment ?? (typeof scorecard?.newsScore === "number" ? scorecard.newsScore : null),
    confidence: result.finalConfidence ?? null,
  };
}

export function extractFeatureSnapshotFromAiInput(input: AIAnalysisInput, result?: AIConsensusResult): FeatureSnapshotInput {
  const signals = input.marketSignals ?? {};
  const payload = result?.decisionPayload as Record<string, unknown> | undefined;
  const scorecard = result?.analysisScorecard as Record<string, unknown> | undefined;
  const liquidityIntel = payload?.liquidityIntel as Record<string, unknown> | undefined;
  const regimeStability = payload?.regimeStability as Record<string, unknown> | undefined;
  return {
    indicators: {
      scorecard,
      roleScores: result?.roleScores ?? [],
      hybridPayload: payload ?? null,
    },
    momentum: {
      shortMomentumPercent: signals.shortMomentumPercent ?? null,
      shortFlowImbalance: signals.shortFlowImbalance ?? null,
      tradeVelocity: signals.tradeVelocity ?? null,
      volumeSpikeRatio: signals.volumeSpikeRatio ?? null,
      pumpStage: signals.pumpStage ?? null,
      pumpPriorityScore: signals.pumpPriorityScore ?? null,
    },
    volume: {
      volume24h: input.volume24h,
      buyVolume: input.recentTradesSummary.buyVolume,
      sellVolume: input.recentTradesSummary.sellVolume,
      buySellRatio: input.recentTradesSummary.buySellRatio,
    },
    orderBook: {
      bestBid: input.orderBookSummary.bestBid,
      bestAsk: input.orderBookSummary.bestAsk,
      bidDepth: input.orderBookSummary.bidDepth,
      askDepth: input.orderBookSummary.askDepth,
      imbalance: input.orderBookSummary.bidDepth + input.orderBookSummary.askDepth > 0
        ? (input.orderBookSummary.bidDepth - input.orderBookSummary.askDepth) /
          Math.max(input.orderBookSummary.bidDepth + input.orderBookSummary.askDepth, 1)
        : 0,
    },
    liquidity: liquidityIntel ?? null,
    spread: {
      spreadPercent: input.spread,
      safeEntryTiming: liquidityIntel?.safeEntryTiming ?? null,
    },
    volatility: {
      volatilityPercent: input.volatility,
      atr: payload?.atr ?? null,
    },
    atr: (payload?.atr as Record<string, unknown> | null | undefined) ?? null,
    vwap: (payload?.vwap as Record<string, unknown> | null | undefined) ?? null,
    rsi: (payload?.rsi as Record<string, unknown> | null | undefined) ?? (scorecard?.rsi as Record<string, unknown> | null | undefined) ?? null,
    macd: (payload?.macd as Record<string, unknown> | null | undefined) ?? (scorecard?.macd as Record<string, unknown> | null | undefined) ?? null,
    ema: (payload?.ema as Record<string, unknown> | null | undefined) ?? (scorecard?.ema as Record<string, unknown> | null | undefined) ?? null,
    regime: {
      marketRegime: input.marketRegime ?? null,
      regimeStability: regimeStability ?? null,
      lifecyclePhase: signals.regimeLifecyclePhase ?? null,
      transitionProbability: signals.regimeTransitionProbability ?? null,
      chaosProbability: signals.regimeChaosProbability ?? null,
    },
    funding: {
      fundingRate: signals.fundingRate ?? null,
      fundingDelta: signals.fundingDelta ?? null,
    },
    openInterest: {
      openInterest: signals.openInterest ?? null,
      openInterestDelta: signals.openInterestDelta ?? null,
      longShortRatio: signals.longShortRatio ?? null,
      liquidationImbalance: signals.liquidationImbalance ?? null,
    },
    whale: {
      positioningPressure: signals.positioningPressure ?? null,
      aggressivePositioningScore: signals.aggressivePositioningScore ?? null,
      overcrowdedLongScore: signals.overcrowdedLongScore ?? null,
      overcrowdedShortScore: signals.overcrowdedShortScore ?? null,
    },
    news: {
      newsSentiment: signals.newsSentiment ?? null,
      macroHighImpactNews: signals.macroHighImpactNews ?? null,
      macroUncertaintyLevel: signals.macroUncertaintyLevel ?? null,
      socialSentimentScore: signals.socialSentimentScore ?? null,
    },
    raw: {
      klineCount: input.klines.length,
      lastPrice: input.lastPrice,
      futuresIntent: signals.futuresIntent ?? null,
      futuresRiskScore: signals.futuresRiskScore ?? null,
      leverageStressScore: signals.leverageStressScore ?? null,
      leveragedTrapProbability: signals.leveragedTrapProbability ?? null,
    },
  };
}

export function extractRejectReasonsFromAi(result: AIConsensusResult): RejectReasonInput[] {
  const reasons: RejectReasonInput[] = [];
  const extended = result as AIConsensusResult & { noTradeReasonList?: string[] };
  if (result.rejectReason) reasons.push(categorizeRejectReason(result.rejectReason, 0.9));
  if (Array.isArray(extended.noTradeReasonList)) {
    for (const reason of extended.noTradeReasonList) {
      if (typeof reason === "string" && reason.trim()) reasons.push(categorizeRejectReason(reason, 0.75));
    }
  }
  if (result.explanation && result.finalDecision !== "BUY") {
    reasons.push(categorizeRejectReason(result.explanation, 0.6));
  }
  return reasons;
}

export function extractRejectReasonsFromQualityGate(qualityGate: SignalQualityResult): RejectReasonInput[] {
  const reasons = [...qualityGate.whyRejected, ...qualityGate.reasons];
  return reasons
    .filter(Boolean)
    .map((reason) => categorizeRejectReason(reason, qualityGate.decision === "REJECT" ? 0.85 : 0.55));
}

export function extractRejectReasonsFromScanner(reasons: string[]): RejectReasonInput[] {
  return reasons.filter(Boolean).map((reason) => categorizeRejectReason(reason, 0.7));
}

export function extractScoresFromCandidate(candidate: ScannerCandidate, ai?: AIConsensusResult): DecisionScoreSnapshot {
  const base = ai ? extractScoresFromAi(ai, candidate.score.score) : {};
  return {
    ...base,
    scannerScore: candidate.score.score,
    confidence: ai?.finalConfidence ?? candidate.score.confidence,
    momentumScore:
      base.momentumScore ??
      Number(candidate.context.metadata.shortMomentumPercent ?? candidate.context.metadata.hourMomentumPercent ?? 0),
    volumeScore: base.volumeScore ?? clamp((candidate.context.volume24h / Math.max(1, candidate.context.volume24h)) * 100, 0, 100),
    liquidityScore: base.liquidityScore ?? clamp(100 - candidate.context.spreadPercent * 100, 0, 100),
    trendScore: base.trendScore ?? Number(candidate.context.metadata.mtfAlignmentScore ?? 0),
    regimeScore: base.regimeScore ?? Number(candidate.context.metadata.regimeStabilityScore ?? 0),
    newsScore: base.newsScore ?? Number(candidate.context.metadata.socialSentimentScore ?? 0),
    riskScore: base.riskScore ?? Number(candidate.context.metadata.futuresRiskScore ?? ai?.finalRiskScore ?? 0),
  };
}

export function extractFeatureSnapshotFromCandidate(candidate: ScannerCandidate, ai?: AIConsensusResult): FeatureSnapshotInput {
  const metadata = candidate.context.metadata;
  const aiInputLike = {
    symbol: candidate.context.symbol,
    lastPrice: candidate.context.lastPrice,
    klines: [],
    volume24h: candidate.context.volume24h,
    orderBookSummary: {
      bestBid: Number(metadata.bestBid ?? 0),
      bestAsk: Number(metadata.bestAsk ?? 0),
      bidDepth: Number(metadata.orderBookBidDepth ?? metadata.bidDepth ?? 0),
      askDepth: Number(metadata.orderBookAskDepth ?? metadata.askDepth ?? 0),
    },
    recentTradesSummary: {
      buyVolume: Number(metadata.recentBuyVolume ?? 0),
      sellVolume: Number(metadata.recentSellVolume ?? 0),
      buySellRatio: Number(metadata.buySellRatio ?? 0),
    },
    spread: candidate.context.spreadPercent,
    volatility: candidate.context.volatilityPercent,
    marketSignals: metadata,
    marketRegime: metadata.marketRegime
      ? ({
          mode: String(metadata.marketRegime),
          reason: String(metadata.marketRegimeReason ?? ""),
          selectedStrategy: String(metadata.marketRegimeStrategy ?? ""),
          openTradeAllowed: Boolean(metadata.marketRegimeOpenTradeAllowed ?? true),
          tpMultiplier: Number(metadata.marketRegimeTpMultiplier ?? 1),
          slMultiplier: Number(metadata.marketRegimeSlMultiplier ?? 1),
          riskMultiplier: Number(metadata.marketRegimeRiskMultiplier ?? 1),
        } as AIAnalysisInput["marketRegime"])
      : undefined,
  } as AIAnalysisInput;

  return extractFeatureSnapshotFromAiInput(aiInputLike, ai);
}
