import { env } from "@/lib/config";
import { buildIndicatorSnapshot } from "@/src/server/ai/indicator-suite";
import type { AIAnalysisInput, AIDecision, AIConsensusResult, AIProviderResult, AIRoleScore } from "@/src/types/ai";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function decisionScore(decision: AIDecision) {
  if (decision === "BUY") return 1;
  if (decision === "SELL") return -1;
  return 0;
}

function normalizeConfidence(value: number) {
  return clamp(value, 0, 100);
}

function getRoleProvider(
  role: "AI-1_TECHNICAL" | "AI-2_SENTIMENT" | "AI-3_RISK",
  technical: AIProviderResult[],
  momentum: AIProviderResult[],
  risk: AIProviderResult[],
) {
  const id = role === "AI-1_TECHNICAL" ? "provider-1" : role === "AI-2_SENTIMENT" ? "provider-2" : "provider-3";
  const source = role === "AI-1_TECHNICAL" ? technical : role === "AI-2_SENTIMENT" ? momentum : risk;
  const row = source.find((x) => x.providerId === id && x.ok && x.output) ?? source.find((x) => x.ok && x.output);
  return row ?? null;
}

function computeRiskReward(entry: number, target: number | null, stop: number | null) {
  if (!entry || !target || !stop) return 0;
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return 0;
  return reward / risk;
}

function resolveRegimePolicy(regime: AIAnalysisInput["marketRegime"] | undefined) {
  const mode = regime?.mode ?? "RANGE_SIDEWAYS";
  if (mode === "STRONG_BULLISH_TREND") {
    return {
      mode,
      minCompositeDelta: -5,
      minTechDelta: -3,
      minSentimentDelta: -2,
      forceSkip: false,
      forceSkipReason: "",
      strategy: regime?.selectedStrategy ?? "BREAKOUT_CONTINUATION",
    };
  }
  if (mode === "WEAK_BULLISH_TREND") {
    return {
      mode,
      minCompositeDelta: -1,
      minTechDelta: 0,
      minSentimentDelta: 0,
      forceSkip: false,
      forceSkipReason: "",
      strategy: regime?.selectedStrategy ?? "TREND_PULLBACK",
    };
  }
  if (mode === "STRONG_BEARISH_TREND") {
    return {
      mode,
      minCompositeDelta: 11,
      minTechDelta: 8,
      minSentimentDelta: 5,
      forceSkip: false,
      forceSkipReason: "",
      strategy: regime?.selectedStrategy ?? "BOUNCE_ONLY",
    };
  }
  if (mode === "WEAK_BEARISH_TREND") {
    return {
      mode,
      minCompositeDelta: 8,
      minTechDelta: 6,
      minSentimentDelta: 4,
      forceSkip: false,
      forceSkipReason: "",
      strategy: regime?.selectedStrategy ?? "BOUNCE_ONLY",
    };
  }
  if (mode === "HIGH_VOLATILITY_CHAOS") {
    return {
      mode,
      minCompositeDelta: 12,
      minTechDelta: 6,
      minSentimentDelta: 5,
      forceSkip: false,
      forceSkipReason: "",
      strategy: regime?.selectedStrategy ?? "VOLATILITY_DEFENSIVE",
    };
  }
  if (mode === "NEWS_DRIVEN_UNSTABLE") {
    return {
      mode,
      minCompositeDelta: 14,
      minTechDelta: 6,
      minSentimentDelta: 6,
      forceSkip: false,
      forceSkipReason: "",
      strategy: regime?.selectedStrategy ?? "VOLATILITY_DEFENSIVE",
    };
  }
  if (mode === "LOW_VOLUME_DEAD_MARKET") {
    return {
      mode,
      minCompositeDelta: 99,
      minTechDelta: 99,
      minSentimentDelta: 99,
      forceSkip: true,
      forceSkipReason: regime?.reason ?? "Low volume regime",
      strategy: regime?.selectedStrategy ?? "NO_TRADE_OR_MICRO_RISK",
    };
  }
  return {
    mode,
    minCompositeDelta: 2,
    minTechDelta: 0,
    minSentimentDelta: 0,
    forceSkip: false,
    forceSkipReason: "",
    strategy: regime?.selectedStrategy ?? "RANGE_MEAN_REVERSION",
  };
}

function toTimeframePayload(input: AIAnalysisInput["multiTimeframe"]) {
  if (!input) return undefined;
  const hasLayered = "higher" in input && "mid" in input && "lower" in input;
  if (!hasLayered) {
    const legacy = input as unknown as {
      entry: {
        m1?: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
        m15?: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
        m5: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
      };
      trend: {
        m15?: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
        h1: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
      };
      macro: {
        h4: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
        d1: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
      };
      dominantTrend: "BULLISH" | "BEARISH" | "RANGE";
      trendAligned: boolean;
      entrySuitable: boolean;
      conflict: boolean;
      reason: string;
      alignmentScore?: number;
      conflictingSignals?: string[];
      finalAlignmentSummary?: string;
    };
    const legacyM15 = legacy.entry.m15 ?? legacy.trend.m15 ?? legacy.entry.m1 ?? {
      direction: legacy.entry.m5.direction,
      strength: legacy.entry.m5.strength,
      slopePercent: legacy.entry.m5.slopePercent,
    };
    const lowerQuality =
      legacy.entrySuitable && legacy.trendAligned
        ? "HIGH"
        : legacy.trendAligned
          ? "MEDIUM"
          : "LOW";
    return {
      higher: {
        d1: legacy.macro.d1,
        h4: legacy.macro.h4,
        trend: legacy.dominantTrend,
        confidence: 60,
      },
      mid: {
        h1: legacy.trend.h1,
        structure: legacy.trendAligned ? "TREND_CONTINUATION" : "POTENTIAL_REVERSAL",
        momentumBias: legacy.trend.h1.direction,
      },
      lower: {
        m15: legacyM15,
        m5: legacy.entry.m5,
        entryQuality: lowerQuality as "HIGH" | "MEDIUM" | "LOW",
      },
      entry: {
        m15: legacyM15,
        m5: legacy.entry.m5,
      },
      trend: {
        h1: legacy.trend.h1,
      },
      macro: legacy.macro,
      dominantTrend: legacy.dominantTrend,
      alignmentScore: Number(legacy.alignmentScore ?? (legacy.trendAligned ? 68 : 42)),
      trendAligned: legacy.trendAligned,
      entrySuitable: legacy.entrySuitable,
      conflict: legacy.conflict,
      conflictingSignals: legacy.conflictingSignals ?? [],
      finalAlignmentSummary: legacy.finalAlignmentSummary ?? legacy.reason,
      reason: legacy.reason,
    };
  }
  return {
    higher: {
      d1: {
        direction: input.higher.d1.direction,
        strength: input.higher.d1.strength,
        slopePercent: input.higher.d1.slopePercent,
      },
      h4: {
        direction: input.higher.h4.direction,
        strength: input.higher.h4.strength,
        slopePercent: input.higher.h4.slopePercent,
      },
      trend: input.higher.trend,
      confidence: input.higher.confidence,
    },
    mid: {
      h1: {
        direction: input.mid.h1.direction,
        strength: input.mid.h1.strength,
        slopePercent: input.mid.h1.slopePercent,
      },
      structure: input.mid.structure,
      momentumBias: input.mid.momentumBias,
    },
    lower: {
      m15: {
        direction: input.lower.m15.direction,
        strength: input.lower.m15.strength,
        slopePercent: input.lower.m15.slopePercent,
      },
      m5: {
        direction: input.lower.m5.direction,
        strength: input.lower.m5.strength,
        slopePercent: input.lower.m5.slopePercent,
      },
      entryQuality: input.lower.entryQuality,
    },
    entry: {
      m15: {
        direction: input.entry.m15.direction,
        strength: input.entry.m15.strength,
        slopePercent: input.entry.m15.slopePercent,
      },
      m5: {
        direction: input.entry.m5.direction,
        strength: input.entry.m5.strength,
        slopePercent: input.entry.m5.slopePercent,
      },
    },
    trend: {
      h1: {
        direction: input.trend.h1.direction,
        strength: input.trend.h1.strength,
        slopePercent: input.trend.h1.slopePercent,
      },
    },
    macro: {
      h4: {
        direction: input.macro.h4.direction,
        strength: input.macro.h4.strength,
        slopePercent: input.macro.h4.slopePercent,
      },
      d1: {
        direction: input.macro.d1.direction,
        strength: input.macro.d1.strength,
        slopePercent: input.macro.d1.slopePercent,
      },
    },
    dominantTrend: input.dominantTrend,
    alignmentScore: input.alignmentScore,
    trendAligned: input.trendAligned,
    entrySuitable: input.entrySuitable,
    conflict: input.conflict,
    conflictingSignals: input.conflictingSignals,
    finalAlignmentSummary: input.finalAlignmentSummary,
    reason: input.reason,
  };
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function scoreTechnical(input: AIAnalysisInput, provider: AIProviderResult | null): AIRoleScore {
  const ind = buildIndicatorSnapshot(input);
  const rationale: string[] = [];
  let score = 50;
  if (ind.ema9 > ind.ema21) {
    score += 8;
    rationale.push("EMA9 EMA21 uzeri (trend yukari)");
  } else {
    score -= 8;
    rationale.push("EMA9 EMA21 alti (trend asagi)");
  }
  if (ind.sma20 > ind.sma50) {
    score += 6;
    rationale.push("SMA20 SMA50 uzeri");
  } else {
    score -= 6;
    rationale.push("SMA20 SMA50 alti");
  }
  if (ind.rsi14 > 45 && ind.rsi14 < 68) {
    score += 7;
    rationale.push(`RSI dengeli (${ind.rsi14.toFixed(1)})`);
  } else if (ind.rsi14 >= 75 || ind.rsi14 <= 28) {
    score -= 8;
    rationale.push(`RSI asiri bolgede (${ind.rsi14.toFixed(1)})`);
  }
  if (ind.macd > ind.signalLine) {
    score += 6;
    rationale.push("MACD sinyal cizgisi uzeri");
  } else {
    score -= 5;
    rationale.push("MACD sinyal cizgisi alti");
  }
  if (ind.breakoutUp && !ind.fakeBreakout) {
    score += 8;
    rationale.push("Breakout teyitli");
  }
  if (ind.fakeBreakout) {
    score -= 10;
    rationale.push("Fake breakout riski");
  }
  if (ind.mtfAligned) {
    score += 7;
    rationale.push("Multi-timeframe trend uyumlu");
  } else {
    score -= 6;
    rationale.push("Multi-timeframe uyumsuz");
  }
  if (ind.volumeBoost > 1.15) {
    score += 5;
    rationale.push("Hacim destekli");
  }
  if (ind.bullishCandle) score += 3;
  if (ind.bearishCandle) score -= 3;
  if (Math.abs(ind.liquiditySkew) > 0.2) {
    score += ind.liquiditySkew > 0 ? 3 : -3;
    rationale.push("Likidite bolgesi skew sinyali");
  }
  const stopHuntDetected = Boolean(ind.liquidity.stopHuntDetected);
  const fakeBreakoutDetected = Boolean(ind.liquidity.fakeBreakoutDetected);
  const nearUpperLiquidity = Boolean(ind.liquidity.nearUpperLiquidity);
  const nearLowerLiquidity = Boolean(ind.liquidity.nearLowerLiquidity);
  if (fakeBreakoutDetected) {
    score -= 12;
    rationale.push("Fake breakout tespit edildi");
  }
  if (nearUpperLiquidity || nearLowerLiquidity) {
    score -= 7;
    rationale.push("Likidite havuzu yakininda direkt giris riski");
  }
  if (stopHuntDetected) {
    score += 9;
    rationale.push("Stop hunt sonrasi mean-reversion firsati");
  }

  const providerConfidence = provider?.output?.confidence ?? 50;
  const providerDecision = provider?.output?.decision ?? "HOLD";
  score = score * 0.65 + providerConfidence * 0.35;
  const decision: AIDecision =
    score >= 62 ? (providerDecision === "SELL" ? "SELL" : "BUY") : score <= 42 ? "NO_TRADE" : "HOLD";
  return {
    role: "AI-1_TECHNICAL",
    score: Number(clamp(score, 0, 100).toFixed(2)),
    decision,
    confidence: Number(normalizeConfidence(providerConfidence).toFixed(2)),
    rationale,
  };
}

function scoreSentiment(input: AIAnalysisInput, provider: AIProviderResult | null): AIRoleScore {
  const rationale: string[] = [];
  let score = 50;
  const change24h = Number(input.marketSignals?.change24h ?? 0);
  const flow = Number(input.marketSignals?.shortFlowImbalance ?? 0);
  const momentum = Number(input.marketSignals?.shortMomentumPercent ?? 0);
  const velocity = Number(input.marketSignals?.tradeVelocity ?? 0);
  const btcDom = Number(input.marketSignals?.btcDominanceBias ?? 0);
  const social = Number(input.marketSignals?.socialSentimentScore ?? 50);
  const news = input.marketSignals?.newsSentiment ?? "NEUTRAL";

  score += clamp(change24h, -10, 10) * 0.7;
  score += clamp(momentum, -2, 2) * 5;
  score += clamp(flow, -1, 1) * 8;
  score += clamp(velocity, 0, 5) * 2;
  score += (social - 50) * 0.18;
  if (news === "POSITIVE") {
    score += 6;
    rationale.push("Haber akisi pozitif");
  } else if (news === "NEGATIVE") {
    score -= 8;
    rationale.push("Haber akisi negatif");
  } else {
    rationale.push("Haber akisi notr");
  }
  if (btcDom > 0.5) {
    score -= 5;
    rationale.push("BTC dominansi altcoinleri baskiliyor");
  }
  if (momentum > 0.2 && flow > 0.05) rationale.push("Momentum ve akis destekli");
  if (momentum < -0.2 && flow < -0.05) rationale.push("Negatif momentum baskin");

  const metadata = (provider?.output?.metadata ?? {}) as Record<string, unknown>;
  const specialistMomentum = Number(metadata.momentumStrengthScore ?? NaN);
  const sustainability = Number(metadata.sustainabilityScore ?? NaN);
  const hypeRisk = Number(metadata.hypeRisk ?? NaN);
  const marketAlignment = Number(metadata.marketAlignment ?? NaN);
  const tradeSupportive = metadata.tradeSupportive === true;
  const specialistNewsBias = String(metadata.newsBias ?? "").toUpperCase();
  const specialistSummary = typeof metadata.summary === "string" ? metadata.summary : "";
  const specialistFlags = Array.isArray(metadata.redFlags)
    ? metadata.redFlags.filter((x): x is string => typeof x === "string").slice(0, 3)
    : [];

  if (Number.isFinite(specialistMomentum)) {
    score += (specialistMomentum - 50) * 0.2;
    rationale.push(`Momentum quality skoru ${specialistMomentum.toFixed(1)}`);
  }
  if (Number.isFinite(sustainability)) {
    score += (sustainability - 50) * 0.2;
    rationale.push(`Sürdürülebilirlik skoru ${sustainability.toFixed(1)}`);
  }
  if (Number.isFinite(marketAlignment)) {
    score += (marketAlignment - 50) * 0.12;
  }
  if (Number.isFinite(hypeRisk) && hypeRisk > 65) {
    score -= (hypeRisk - 65) * 0.25;
    rationale.push(`Hype/FOMO riski yuksek (${hypeRisk.toFixed(1)})`);
  }
  if (specialistNewsBias === "POSITIVE") {
    score += 3;
  } else if (specialistNewsBias === "NEGATIVE") {
    score -= 4;
  }
  if (!tradeSupportive) {
    score -= 7;
    rationale.push("AI-2 no-support verdi");
  }
  if (specialistFlags.length > 0) {
    rationale.push(`Red flags: ${specialistFlags.join(" | ")}`);
  } else if (specialistSummary) {
    rationale.push(specialistSummary.slice(0, 96));
  }

  const providerConfidence = provider?.output?.confidence ?? 50;
  const providerDecision = provider?.output?.decision ?? "HOLD";
  score = score * 0.6 + providerConfidence * 0.4;
  const decision: AIDecision =
    score >= 60 ? (providerDecision === "SELL" ? "SELL" : "BUY") : score <= 40 ? "NO_TRADE" : "HOLD";
  return {
    role: "AI-2_SENTIMENT",
    score: Number(clamp(score, 0, 100).toFixed(2)),
    decision,
    confidence: Number(normalizeConfidence(providerConfidence).toFixed(2)),
    rationale,
  };
}

function scoreRisk(
  input: AIAnalysisInput,
  provider: AIProviderResult | null,
  target: number | null,
  stop: number | null,
  runtimeMaxRiskScore: number,
): AIRoleScore {
  const ind = buildIndicatorSnapshot(input);
  const rationale: string[] = [];
  let score = 72;
  let veto = false;
  if (input.spread > env.AI_HYBRID_MAX_SPREAD_PERCENT) {
    score -= 25;
    veto = true;
    rationale.push(`Spread cok yuksek (${input.spread.toFixed(4)}%)`);
  }
  if (input.volume24h < env.SCANNER_MIN_VOLUME_24H) {
    score -= 18;
    veto = true;
    rationale.push("Hacim yetersiz");
  }
  if (input.volatility > env.AI_HYBRID_MAX_VOLATILITY_PERCENT) {
    score -= 20;
    veto = true;
    rationale.push(`Volatilite asiri (${input.volatility.toFixed(3)}%)`);
  }
  const rr = computeRiskReward(input.lastPrice, target, stop);
  if (rr > 0 && rr < env.AI_HYBRID_MIN_RR_RATIO) {
    score -= 14;
    rationale.push(`Risk/Odul yetersiz (${rr.toFixed(2)})`);
  }
  if (rr === 0) {
    score -= 10;
    rationale.push("Target/stop tutarsiz");
  }
  const providerRisk = provider?.output?.riskScore ?? 50;
  if (providerRisk > runtimeMaxRiskScore) {
    score -= 22;
    veto = true;
    rationale.push(`Risk AI veto (score=${providerRisk.toFixed(2)})`);
  }
  if (ind.liquidity.fakeBreakoutDetected) {
    score -= 16;
    veto = true;
    rationale.push("Liquidity/fake breakout veto");
  }
  if ((ind.liquidity.nearUpperLiquidity || ind.liquidity.nearLowerLiquidity) && !ind.liquidity.stopHuntDetected) {
    score -= 10;
    rationale.push("Likidite ustune direkt giris yasak");
  }
  if (ind.liquidity.stopHuntDetected) {
    score += 7;
    rationale.push("Stop hunt sonrasi giris pencere puani");
  }

  const metadata = (provider?.output?.metadata ?? {}) as Record<string, unknown>;
  const specialistRiskScore = Number(metadata.riskScore ?? NaN);
  const approveRejectCaution = String(metadata.approveRejectCaution ?? "").toUpperCase();
  const vetoReasons = Array.isArray(metadata.vetoReasonList)
    ? metadata.vetoReasonList.filter((x): x is string => typeof x === "string")
    : [];
  const cautionList = Array.isArray(metadata.cautionList)
    ? metadata.cautionList.filter((x): x is string => typeof x === "string")
    : [];
  const portfolioSafetyStatus = String(metadata.portfolioSafetyStatus ?? "");
  const finalRiskSummary = typeof metadata.finalRiskSummary === "string" ? metadata.finalRiskSummary : "";
  if (Number.isFinite(specialistRiskScore)) {
    score = score * 0.82 + (100 - specialistRiskScore) * 0.18;
    rationale.push(`AI-3 risk exposure=${specialistRiskScore.toFixed(1)}`);
  }
  if (approveRejectCaution === "REJECT") {
    score -= 20;
    veto = true;
    rationale.push("AI-3 veto: reject");
  } else if (approveRejectCaution === "CAUTION") {
    score -= 8;
    rationale.push("AI-3 caution: korumali mod");
  }
  if (portfolioSafetyStatus === "BLOCKED_OPEN_POSITION") {
    score -= 20;
    veto = true;
    rationale.push("Portfoy guvenligi: acik pozisyon blokaji");
  } else if (portfolioSafetyStatus === "COOLDOWN_ACTIVE") {
    score -= 10;
    rationale.push("Portfoy guvenligi: cooldown aktif");
  }
  if (vetoReasons.length > 0) {
    rationale.push(`Veto nedenleri: ${vetoReasons.slice(0, 3).join(" | ")}`);
  } else if (cautionList.length > 0) {
    rationale.push(`Risk uyarilari: ${cautionList.slice(0, 3).join(" | ")}`);
  } else if (finalRiskSummary) {
    rationale.push(finalRiskSummary.slice(0, 96));
  }

  score = score * 0.72 + (100 - providerRisk) * 0.28;
  const decision: AIDecision = veto ? "NO_TRADE" : score >= 58 ? "BUY" : score <= 40 ? "NO_TRADE" : "HOLD";
  return {
    role: "AI-3_RISK",
    score: Number(clamp(score, 0, 100).toFixed(2)),
    decision,
    confidence: Number(normalizeConfidence(100 - providerRisk).toFixed(2)),
    rationale,
    veto,
  };
}

export function buildHybridDecision(input: {
  analysisInput: AIAnalysisInput;
  technicalResults: AIProviderResult[];
  momentumResults: AIProviderResult[];
  riskResults: AIProviderResult[];
  allOutputs: AIProviderResult[];
}): AIConsensusResult {
  const techProvider = getRoleProvider("AI-1_TECHNICAL", input.technicalResults, input.momentumResults, input.riskResults);
  const sentProvider = getRoleProvider("AI-2_SENTIMENT", input.technicalResults, input.momentumResults, input.riskResults);
  const riskProvider = getRoleProvider("AI-3_RISK", input.technicalResults, input.momentumResults, input.riskResults);

  const strategyParams = (input.analysisInput.strategyParams ?? {}) as Record<string, unknown>;
  const runtimeMinTechScore = Number(strategyParams.technicalMinScore ?? env.AI_HYBRID_MIN_TECH_SCORE);
  const runtimeMinSentimentScore = Number(strategyParams.sentimentMinScore ?? env.AI_HYBRID_MIN_SENTIMENT_SCORE);
  const runtimeMinCompositeScore = Number(strategyParams.consensusMinScore ?? env.AI_HYBRID_MIN_COMPOSITE_SCORE);
  const runtimeMinQualityScore = Number(strategyParams.consensusMinScore ?? env.EXECUTION_MIN_TRADE_QUALITY_SCORE ?? 60);
  const runtimeMaxRiskScore = Number(strategyParams.riskVetoLevel ?? env.AI_MAX_RISK_SCORE);
  const target = techProvider?.output?.targetPrice ?? sentProvider?.output?.targetPrice ?? null;
  const stop = riskProvider?.output?.stopPrice ?? techProvider?.output?.stopPrice ?? null;
  const indicators = buildIndicatorSnapshot(input.analysisInput);
  const technical = scoreTechnical(input.analysisInput, techProvider);
  const sentiment = scoreSentiment(input.analysisInput, sentProvider);
  const risk = scoreRisk(input.analysisInput, riskProvider, target, stop, runtimeMaxRiskScore);
  const roleScores = [technical, sentiment, risk];
  const regimePolicy = resolveRegimePolicy(input.analysisInput.marketRegime);
  const composite =
    technical.score * 0.47 +
    sentiment.score * 0.26 +
    risk.score * 0.27;
  const riskVeto = Boolean(risk.veto) && env.AI_HYBRID_REQUIRE_RISK_VETO;
  const technicalOk = technical.score >= runtimeMinTechScore + regimePolicy.minTechDelta;
  const sentimentOk = sentiment.score >= runtimeMinSentimentScore + regimePolicy.minSentimentDelta;
  const compositeOk = composite >= runtimeMinCompositeScore + regimePolicy.minCompositeDelta;
  const mtf = input.analysisInput.multiTimeframe;
  const mtfConflict = Boolean(mtf?.conflict);
  const mtfTrendAligned = Boolean(mtf?.trendAligned);
  const mtfEntrySuitable = Boolean(mtf?.entrySuitable);
  const mtfAlignmentScore = Number(mtf?.alignmentScore ?? 0);
  const mtfRejectReason = mtfConflict
    ? `Multi-timeframe conflict: ${mtf?.reason ?? "trend mismatch"}`
    : !mtfTrendAligned
      ? `Multi-timeframe trend uyumsuz: ${mtf?.reason ?? "trend not aligned"}`
      : !mtfEntrySuitable && mtfAlignmentScore < 62
        ? `Entry timeframe uygun degil: ${mtf?.reason ?? "entry mismatch"}`
        : undefined;
  const pullbackTolerance = Math.max(0.05, Number(env.EXECUTION_PULLBACK_TOLERANCE_PERCENT ?? 0.35));
  const safeEntryPoint = Number(indicators.liquidity.safeEntryPoint ?? input.analysisInput.lastPrice);
  const lateEntryPercent = Math.abs(
    ((input.analysisInput.lastPrice - safeEntryPoint) / Math.max(input.analysisInput.lastPrice, 0.00000001)) * 100,
  );
  const shortMomentumAbs = Math.abs(Number(input.analysisInput.marketSignals?.shortMomentumPercent ?? 0));
  const lateEntryDetected =
    lateEntryPercent > pullbackTolerance * 2.2 &&
    shortMomentumAbs > 0.35 &&
    (Boolean(indicators.breakoutUp) ||
      Boolean(indicators.breakoutDown) ||
      Boolean(indicators.liquidity.nearUpperLiquidity) ||
      Boolean(indicators.liquidity.nearLowerLiquidity) ||
      String(indicators.liquidity.safeEntryTiming ?? "").includes("WAIT"));
  const uncertainDirection =
    regimePolicy.mode === "LOW_VOLUME_DEAD_MARKET" ||
    regimePolicy.mode === "NEWS_DRIVEN_UNSTABLE" ||
    regimePolicy.mode === "HIGH_VOLATILITY_CHAOS" ||
    (regimePolicy.mode === "RANGE_SIDEWAYS" &&
      (mtfConflict || !mtfTrendAligned || !mtfEntrySuitable || Number(mtf?.alignmentScore ?? 60) < 58)) ||
    mtf?.dominantTrend === "RANGE" ||
    Number(mtf?.higher?.confidence ?? 60) < 52;
  const recoverableEntryWindow =
    mtfTrendAligned &&
    !mtfConflict &&
    mtfAlignmentScore >= 72 &&
    (regimePolicy.mode === "RANGE_SIDEWAYS" || regimePolicy.mode === "WEAK_BULLISH_TREND" || regimePolicy.mode === "WEAK_BEARISH_TREND");
  const technicalWeak = technical.score < runtimeMinTechScore + regimePolicy.minTechDelta;
  const lowMomentumInput =
    Math.abs(Number(input.analysisInput.marketSignals?.shortMomentumPercent ?? 0)) < 0.08 &&
    Math.abs(Number(input.analysisInput.marketSignals?.shortFlowImbalance ?? 0)) < 0.03;
  const momentumWeak = sentiment.score < env.AI_HYBRID_MIN_SENTIMENT_SCORE + regimePolicy.minSentimentDelta || lowMomentumInput;
  const news = input.analysisInput.marketSignals?.newsSentiment ?? "NEUTRAL";
  const sentimentMeta = (sentProvider?.output?.metadata ?? {}) as Record<string, unknown>;
  const sentimentFlags = Array.isArray(sentimentMeta.redFlags)
    ? sentimentMeta.redFlags.filter((x): x is string => typeof x === "string")
    : [];
  const newsComplex = news === "NEGATIVE" || sentimentFlags.length >= 2 || sentimentMeta.tradeSupportive === false;
  const volatilityExtreme = input.analysisInput.volatility > env.AI_HYBRID_MAX_VOLATILITY_PERCENT;
  const volumeWeak = input.analysisInput.volume24h < env.SCANNER_MIN_VOLUME_24H;
  const fakeBreakoutHigh =
    indicators.liquidity.fakeBreakoutDetected ||
    Number(indicators.liquidity.fakeBreakoutRiskScore ?? 0) >= 62;
  const dirScore = decisionScore(technical.decision) * 0.55 + decisionScore(sentiment.decision) * 0.45;
  const externalQualityRaw = Number(
    strategyParams.tradeQualityScore ?? strategyParams.scannerScore ?? composite,
  );
  const tradeQualityScore = Number(clamp(externalQualityRaw, 0, 100).toFixed(2));
  const baseMinQualityThreshold = runtimeMinQualityScore;
  const canRelaxQualityThreshold =
    mtfAlignmentScore >= 70 &&
    mtfTrendAligned &&
    (riskProvider?.output?.riskScore ?? 100) <= 42 &&
    input.analysisInput.spread <= Math.max(0.12, env.AI_HYBRID_MAX_SPREAD_PERCENT * 0.8) &&
    input.analysisInput.volatility <= Math.max(2.5, env.AI_HYBRID_MAX_VOLATILITY_PERCENT * 0.9);
  const adaptiveQualityThreshold = clamp(
    baseMinQualityThreshold - (canRelaxQualityThreshold ? 8 : 0),
    48,
    baseMinQualityThreshold,
  );
  const minQualityThreshold = adaptiveQualityThreshold;
  const qualityStrong = canRelaxQualityThreshold
    ? tradeQualityScore >= Math.max(minQualityThreshold + 2, 58)
    : tradeQualityScore >= Math.max(minQualityThreshold + 4, 61);
  const qualityWeak = tradeQualityScore < minQualityThreshold;
  const regimeSuitable = !regimePolicy.forceSkip && (!uncertainDirection || recoverableEntryWindow) && !mtfRejectReason;
  const adaptiveTechnicalFloor =
    mtfTrendAligned &&
    !mtfConflict &&
    mtfAlignmentScore >= 68 &&
    sentiment.score >= 64 &&
    (riskProvider?.output?.riskScore ?? 100) <= 58
      ? Math.max(52, runtimeMinTechScore - 4)
      : Math.max(58, runtimeMinTechScore);
  const technicalStrong = technicalOk && technical.score >= adaptiveTechnicalFloor;
  const momentumSupportive = sentimentOk && !momentumWeak && !newsComplex;
  const rr = computeRiskReward(input.analysisInput.lastPrice, target, stop);
  const rrBad = rr <= 0 || rr < env.AI_HYBRID_MIN_RR_RATIO;
  const hardReject =
    riskVeto ||
    regimePolicy.forceSkip ||
    (volatilityExtreme && regimePolicy.mode === "HIGH_VOLATILITY_CHAOS") ||
    (volumeWeak && regimePolicy.mode === "LOW_VOLUME_DEAD_MARKET") ||
    fakeBreakoutHigh ||
    lateEntryDetected ||
    rrBad ||
    tradeQualityScore < 45;

  let finalDecision: AIDecision = "NO_TRADE";
  let consensusDecision: "BUY" | "WATCHLIST" | "NO-TRADE" | "REJECT" = "NO-TRADE";
  if (!hardReject && regimeSuitable && technicalStrong && momentumSupportive && compositeOk && qualityStrong && dirScore >= 0.2) {
    consensusDecision = "BUY";
    finalDecision = "BUY";
  } else if (!hardReject && regimeSuitable && technicalStrong && (!momentumSupportive || !qualityStrong || dirScore < 0.2)) {
    consensusDecision = "WATCHLIST";
    finalDecision = "HOLD";
  } else if (hardReject) {
    consensusDecision = "REJECT";
    finalDecision = "NO_TRADE";
  }

  if (
    (regimePolicy.mode === "STRONG_BEARISH_TREND" || regimePolicy.mode === "WEAK_BEARISH_TREND") &&
    finalDecision === "BUY" &&
    !(input.analysisInput.lastPrice > 0 && input.analysisInput.marketSignals && Number(input.analysisInput.marketSignals.shortMomentumPercent ?? 0) > 0.12)
  ) {
    finalDecision = "NO_TRADE";
  }

  if ((finalDecision === "BUY" || finalDecision === "SELL") && rr > 0 && rr < env.AI_HYBRID_MIN_RR_RATIO) {
    finalDecision = "NO_TRADE";
    consensusDecision = "REJECT";
  }
  const liquidityRejectReason =
    indicators.liquidity.fakeBreakoutDetected || indicators.liquidity.fakeBreakoutRiskScore >= 62
      ? "Fake breakout / wick dominance"
      : indicators.liquidity.safeEntryTiming === "WAIT_LIQUIDITY_CLEARANCE"
        ? "Likidite temizligi beklenmeli"
      : indicators.liquidity.safeEntryTiming === "NO_ENTRY_FAKE_BREAKOUT_RISK"
        ? "Likidite trap/fake breakout riski"
      : (indicators.liquidity.nearUpperLiquidity || indicators.liquidity.nearLowerLiquidity) && !indicators.liquidity.stopHuntDetected
        ? "Likidite havuzuna direkt giris riski"
        : undefined;
  if ((finalDecision === "BUY" || finalDecision === "SELL") && liquidityRejectReason) {
    finalDecision = "NO_TRADE";
    consensusDecision = "REJECT";
  }
  let noTradeReasonList = unique([
    uncertainDirection ? "Piyasa yonu belirsiz / market uygun degil" : "",
    mtfRejectReason ? "Timeframe'ler cakisiyor" : "",
    technicalWeak ? "Teknik setup zayif" : "",
    momentumWeak ? "Momentum guven vermiyor" : "",
    newsComplex ? "Haber/sentiment karmasik" : "",
    volatilityExtreme ? "Volatilite asiri" : "",
    volumeWeak ? "Hacim yetersiz" : "",
    fakeBreakoutHigh ? "Fake breakout riski yuksek" : "",
    rrBad ? "Risk/odul orani kotu" : "",
    lateEntryDetected ? "Giris cok gec kalmis" : "",
  ]).filter(Boolean);
  const blockedByAi = unique([
    technical.decision === "NO_TRADE" || technicalWeak || Boolean(mtfRejectReason) ? "AI-1_TECHNICAL" : null,
    sentiment.decision === "NO_TRADE" || momentumWeak || newsComplex ? "AI-2_SENTIMENT" : null,
    risk.decision === "NO_TRADE" || riskVeto || volatilityExtreme || volumeWeak || rrBad || fakeBreakoutHigh ? "AI-3_RISK" : null,
  ].filter((x): x is "AI-1_TECHNICAL" | "AI-2_SENTIMENT" | "AI-3_RISK" => Boolean(x)));
  if (noTradeReasonList.length > 0 && consensusDecision === "BUY") {
    finalDecision = "NO_TRADE";
    consensusDecision = "NO-TRADE";
  }
  const retryLaterSuggestion =
    volatilityExtreme || regimePolicy.mode === "HIGH_VOLATILITY_CHAOS"
      ? "Volatilite sakinlesince ve spread normalize olunca tekrar dene."
      : volumeWeak || regimePolicy.mode === "LOW_VOLUME_DEAD_MARKET"
        ? "Hacim artisi ve order-flow guclenmesi gorulene kadar bekle."
        : lateEntryDetected
          ? "Yeni pullback/retest olusunca tekrar degerlendir."
          : "Trend-timeframe uyumu ve temiz momentum teyidi geldikten sonra yeniden tara.";
  const marketNotSuitableSummary =
    noTradeReasonList.length > 0
      ? `No-trade disiplini aktif: ${noTradeReasonList.slice(0, 4).join(" | ")}`
      : "Market kosullari trade icin yeterli.";
  const alignedFactors = unique([
    regimeSuitable ? "Market regime uygun" : "",
    technicalStrong ? "Teknik setup guclu" : "",
    momentumSupportive ? "Momentum/haber destekli" : "",
    !riskVeto ? "AI-3 veto yok" : "",
    qualityStrong ? `Trade quality yuksek (${tradeQualityScore.toFixed(2)})` : "",
  ]).filter(Boolean);
  const conflictingFactors = unique([
    !regimeSuitable ? "Market regime/timeframe uygun degil" : "",
    !technicalStrong ? "Teknik setup yetersiz" : "",
    !momentumSupportive ? "Momentum/haber zayif veya karmasik" : "",
    riskVeto ? "AI-3 veto verdi" : "",
    !qualityStrong ? `Trade quality dusuk (${tradeQualityScore.toFixed(2)})` : "",
    lateEntryDetected ? "Giris cok gec" : "",
    rrBad ? "Risk/odul bozuk" : "",
  ]).filter(Boolean);
  let vetoBlockedBy = unique([
    riskVeto ? "AI-3_RISK" : null,
    regimePolicy.forceSkip ? "MARKET_REGIME" : null,
    qualityWeak ? "TRADE_QUALITY" : null,
  ].filter((x): x is "AI-3_RISK" | "MARKET_REGIME" | "TRADE_QUALITY" => Boolean(x)));
  const vetoReason = riskVeto
    ? "AI-3 risk veto"
    : regimePolicy.forceSkip
      ? `Market regime force skip (${regimePolicy.mode})`
      : qualityWeak
        ? `Trade quality esik alti (${tradeQualityScore.toFixed(2)} < ${minQualityThreshold})`
        : undefined;
  const criticismPoints: string[] = [];
  const hiddenRisks: string[] = [];
  let criticPenalty = 0;
  if (consensusDecision === "BUY") {
    if (lateEntryDetected) {
      criticismPoints.push("Giris gelebilecek retest bolgesine gore gec kalmis olabilir.");
      hiddenRisks.push("Late-entry nedeniyle R/R hizli bozulabilir.");
      criticPenalty += 16;
    }
    const setupCrowded =
      conflictingFactors.length >= 3 ||
      sentimentFlags.length >= 2 ||
      (Boolean(indicators.liquidity.nearUpperLiquidity) && Boolean(indicators.liquidity.nearLowerLiquidity));
    if (setupCrowded) {
      criticismPoints.push("Setup fazla kalabalik; sinyaller temiz degil.");
      hiddenRisks.push("Kalabalik setup false positive uretebilir.");
      criticPenalty += 12;
    }
    if (!momentumSupportive || newsComplex || sentimentMeta.tradeSupportive === false) {
      criticismPoints.push("Haber/momentum destegi net degil.");
      hiddenRisks.push("Haber teyidi zayif oldugunda move devam etmeyebilir.");
      criticPenalty += 11;
    }
    if (String((riskProvider?.output?.metadata as Record<string, unknown> | undefined)?.approveRejectCaution ?? "").toUpperCase() === "CAUTION") {
      criticismPoints.push("Risk motoru caution verdi; gizli riskler BUY'i bozabilir.");
      hiddenRisks.push("Caution modunda ani spread/slippage riski artar.");
      criticPenalty += 10;
    }
    const realizedRiskHigher = (riskProvider?.output?.riskScore ?? 55) > Math.max(runtimeMaxRiskScore - 18, 52);
    if (realizedRiskHigher) {
      criticismPoints.push("Risk gercekte tahmin edilenden yuksek olabilir.");
      hiddenRisks.push("Spread/volatilite kaynakli zarar buyuyebilir.");
      criticPenalty += 14;
    }
    if (fakeBreakoutHigh || liquidityRejectReason || indicators.liquidity.breakoutTrap) {
      criticismPoints.push("Likidite tuzagi/fake breakout ihtimali devam ediyor.");
      hiddenRisks.push("Stop avina yakalanma riski.");
      criticPenalty += 18;
    }
    if (rrBad) {
      criticismPoints.push("Islem basarisiz olabilir cunku risk/odul marji zayif.");
      hiddenRisks.push("Kucuk ters harekette avantaj kaybolabilir.");
      criticPenalty += 12;
    }
    if (tradeQualityScore < 85) {
      criticismPoints.push("Kalite skoru BUY icin sinirda; asiri ozguven riski var.");
      hiddenRisks.push("Kalite marji dar oldugunda false breakout yakalanabilir.");
      criticPenalty += 8;
    }
    if (input.analysisInput.spread > env.AI_HYBRID_MAX_SPREAD_PERCENT * 0.85) {
      criticismPoints.push("Spread sinira yakin; entry kalitesi bozulabilir.");
      hiddenRisks.push("Maliyet artisi beklenen edge'i silebilir.");
      criticPenalty += 8;
    }
    if (dirScore < 0.32) {
      criticismPoints.push("Yonsel uzlasma zayif, setup confirmation bias riski tasiyor.");
      hiddenRisks.push("Zayif uzlasmada ters hareket olasiligi yuksek.");
      criticPenalty += 6;
    }
  }
  const criticSeverity = clamp(criticPenalty, 0, 100);
  let criticOverride: "KEEP_BUY" | "DOWNGRADE_WATCHLIST" | "DOWNGRADE_NO_TRADE" = "KEEP_BUY";
  let finalApprovalOrDowngrade: "APPROVED" | "DOWNGRADED_WATCHLIST" | "DOWNGRADED_NO_TRADE" = "APPROVED";
  let selfCriticDowngraded = false;
  const cautionRiskForBuy =
    String((riskProvider?.output?.metadata as Record<string, unknown> | undefined)?.approveRejectCaution ?? "").toUpperCase() === "CAUTION" &&
    (riskProvider?.output?.riskScore ?? 0) >= 56;
  if (consensusDecision === "BUY" && cautionRiskForBuy) {
    criticOverride = "DOWNGRADE_WATCHLIST";
    finalApprovalOrDowngrade = "DOWNGRADED_WATCHLIST";
    selfCriticDowngraded = true;
    consensusDecision = "WATCHLIST";
    finalDecision = "HOLD";
  }
  if (consensusDecision === "BUY" && criticSeverity >= 54) {
    criticOverride = "DOWNGRADE_NO_TRADE";
    finalApprovalOrDowngrade = "DOWNGRADED_NO_TRADE";
    selfCriticDowngraded = true;
    consensusDecision = "NO-TRADE";
    finalDecision = "NO_TRADE";
    noTradeReasonList = unique([...noTradeReasonList, ...criticismPoints.slice(0, 3)]);
    vetoBlockedBy = unique([...vetoBlockedBy, "SELF_CRITIC"]);
  } else if (consensusDecision === "BUY" && criticSeverity >= 28) {
    criticOverride = "DOWNGRADE_WATCHLIST";
    finalApprovalOrDowngrade = "DOWNGRADED_WATCHLIST";
    selfCriticDowngraded = true;
    consensusDecision = "WATCHLIST";
    finalDecision = "HOLD";
    vetoBlockedBy = unique([...vetoBlockedBy, "SELF_CRITIC"]);
  }
  const reasons = [
    `regime=${regimePolicy.mode}`,
    `tech=${technical.score.toFixed(2)}`,
    `sentiment=${sentiment.score.toFixed(2)}`,
    `risk=${risk.score.toFixed(2)}`,
    `composite=${composite.toFixed(2)}`,
    riskVeto ? "risk_veto=true" : "risk_veto=false",
  ];
  const rejectReason =
    finalDecision === "NO_TRADE"
      ? regimePolicy.forceSkip
        ? `Market regime skip: ${regimePolicy.forceSkipReason}`
        : riskVeto
        ? "Risk katmani veto verdi"
        : consensusDecision === "WATCHLIST"
          ? "WATCHLIST: teknik setup var, destekleyici faktorler yetersiz"
        : noTradeReasonList.length > 0
          ? `No-trade mode: ${noTradeReasonList.join(" | ")}`
        : mtfRejectReason
          ? mtfRejectReason
        : !compositeOk
          ? "Composite skor esik altinda"
          : !technicalOk
            ? "Teknik skor yetersiz"
            : !sentimentOk
              ? "Sentiment skor yetersiz"
              : rr > 0 && rr < env.AI_HYBRID_MIN_RR_RATIO
                ? "Risk/odul orani yetersiz"
                : liquidityRejectReason
                  ? liquidityRejectReason
                : "Consensus yetersiz"
      : undefined;
  const rawDecisionConfidence = Number(
    clamp(
      (technical.confidence * 0.34) +
        (sentiment.confidence * 0.22) +
        ((100 - Number(clamp(riskProvider?.output?.riskScore ?? 55, 0, 100))) * 0.26) +
        (tradeQualityScore * 0.18) -
        (conflictingFactors.length * 4),
      0,
      100,
    ).toFixed(2),
  );
  const confidenceAdjusted = Number(
    clamp(
      rawDecisionConfidence -
        criticSeverity * 0.45 +
        (criticOverride === "KEEP_BUY" ? 2 : criticOverride === "DOWNGRADE_WATCHLIST" ? -4 : -9),
      0,
      100,
    ).toFixed(2),
  );
  const decisionConfidence = confidenceAdjusted;
  const reasonedFinalReport =
    consensusDecision === "BUY"
      ? `BUY: regime + teknik + momentum + risk + kalite hizali (${tradeQualityScore.toFixed(2)}). Self-critic onayi alindi.`
      : consensusDecision === "WATCHLIST"
        ? "WATCHLIST: teknik guclu ama self-critic veya destekleyici teyitler nedeniyle bekleme onerildi."
        : consensusDecision === "REJECT"
          ? `REJECT: kritik veto/hard risk bulundu. ${conflictingFactors.slice(0, 3).join(" | ")}`
          : `NO-TRADE: belirsizlikte disiplinli bekleme. ${conflictingFactors.slice(0, 3).join(" | ")}`;

  const confidenceBase = Number((roleScores.reduce((acc, x) => acc + x.confidence, 0) / roleScores.length).toFixed(2));
  const confidence = Number(
    clamp(
      confidenceBase * (input.analysisInput.marketRegime?.riskMultiplier ?? 1),
      0,
      100,
    ).toFixed(2),
  );
  const providerRisk = riskProvider?.output?.riskScore ?? 55;
  const finalRiskScore = Number(clamp(providerRisk, 0, 100).toFixed(2));

  return {
    finalDecision,
    finalConsensusDecision: consensusDecision,
    finalConsensusConfidence: decisionConfidence,
    finalConfidence: confidence,
    finalRiskScore,
    score: Number(composite.toFixed(4)),
    explanation: reasons.join(", "),
    outputs: input.allOutputs,
    rejected: finalDecision === "NO_TRADE",
    rejectReason,
    roleScores,
    decisionPayload: {
      coin: input.analysisInput.symbol,
      entryPrice: input.analysisInput.lastPrice,
      targetPrice: target,
      stopPrice: stop,
      riskRewardRatio: Number(rr.toFixed(4)),
      technicalReason: technical.rationale.slice(0, 4).join(" | "),
      sentimentReason: sentiment.rationale.slice(0, 4).join(" | "),
      riskAssessment: risk.rationale.slice(0, 4).join(" | "),
      confidenceScore: confidence,
      openTrade: finalDecision === "BUY" || finalDecision === "SELL",
      marketMode: input.analysisInput.marketRegime?.mode,
      marketModeReason: input.analysisInput.marketRegime?.reason,
      selectedStrategy: regimePolicy.strategy,
      marketRegimeProfile: {
        regimeName: String(input.analysisInput.marketRegime?.mode ?? "RANGE_SIDEWAYS"),
        confidenceScore: Number(input.analysisInput.marketRegime?.confidenceScore ?? 60),
        allowedStrategyTypes: Array.isArray(input.analysisInput.marketRegime?.allowedStrategyTypes)
          ? input.analysisInput.marketRegime?.allowedStrategyTypes ?? []
          : [],
        forbiddenStrategyTypes: Array.isArray(input.analysisInput.marketRegime?.forbiddenStrategyTypes)
          ? input.analysisInput.marketRegime?.forbiddenStrategyTypes ?? []
          : [],
        tradingAggressiveness: input.analysisInput.marketRegime?.tradingAggressiveness ?? "MEDIUM",
        marketSummary: String(input.analysisInput.marketRegime?.marketSummary ?? input.analysisInput.marketRegime?.reason ?? ""),
        entryThresholdScore: Number(input.analysisInput.marketRegime?.entryThresholdScore ?? 65),
      },
      strategyRuntime: {
        aiScoreThreshold: Number(strategyParams.aiScoreThreshold ?? env.AI_MIN_CONFIDENCE),
        technicalMinScore: Number(runtimeMinTechScore.toFixed(2)),
        sentimentMinScore: Number(runtimeMinSentimentScore.toFixed(2)),
        riskVetoLevel: Number(runtimeMaxRiskScore.toFixed(2)),
        consensusMinScore: Number(runtimeMinQualityScore.toFixed(2)),
        noTradeThreshold: Number(strategyParams.noTradeThreshold ?? 45),
      },
      executionAction: finalDecision === "BUY" || finalDecision === "SELL" ? "OPEN" : "SKIP",
      executionReason:
        consensusDecision === "BUY"
          ? "regime-compatible-open"
          : consensusDecision === "WATCHLIST"
            ? "watchlist-confirmation-needed"
          : noTradeReasonList.length > 0
            ? "no-trade-discipline-mode"
            : rejectReason ?? "regime-filtered",
      noTradeMode: {
        enabled: finalDecision === "NO_TRADE",
        reasonList: noTradeReasonList,
        blockedByAi,
        retryLaterSuggestion,
        marketNotSuitableSummary,
      },
      consensusEngine: {
        finalDecision: consensusDecision,
        decisionConfidence,
        alignedFactors,
        conflictingFactors,
        vetoStatus: {
          vetoed: hardReject || riskVeto || regimePolicy.forceSkip || qualityWeak || selfCriticDowngraded,
          blockedBy: vetoBlockedBy,
          vetoReason: selfCriticDowngraded ? `SELF_CRITIC: ${criticOverride}` : vetoReason,
        },
        reasonedFinalReport,
      },
      selfCriticReview: {
        criticismPoints,
        hiddenRisks,
        confidenceAdjusted,
        overrideSuggestion: criticOverride,
        finalApprovalOrDowngrade,
      },
      liquidityZones: indicators.liquidity.liquidityZones,
      riskyAreas: indicators.liquidity.riskyAreas,
      liquidityIntel: {
        probableStopClusters: indicators.liquidity.probableStopClusters,
        sweepDetected: Boolean(indicators.liquidity.liquiditySweepDetected),
        fakeBreakoutRisk: Number(indicators.liquidity.fakeBreakoutRiskScore ?? 0),
        safeEntryTiming: String(indicators.liquidity.safeEntryTiming ?? "STANDARD_CONFIRMATION"),
        liquidityRiskScore: Number(indicators.liquidity.liquidityRiskScore ?? 0),
        trappedTradersScenario: String(indicators.liquidity.trappedTradersScenario ?? "NONE"),
        breakoutTrap: Boolean(indicators.liquidity.breakoutTrap),
        rangeLiquidityGrab: Boolean(indicators.liquidity.rangeLiquidityGrab),
        smartMoneyStyleSummary: String(indicators.liquidity.smartMoneyStyleSummary ?? ""),
      },
      safeEntryPoint,
      entryRejectReason: rejectReason ?? liquidityRejectReason,
      timeframeAnalysis: toTimeframePayload(mtf),
    },
    generatedAt: new Date().toISOString(),
  };
}
