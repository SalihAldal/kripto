import type { AIProviderAdapter } from "@/src/server/ai/provider.interface";
import { analyzeWithRemoteModel } from "@/src/server/ai/providers/remote-llm";
import type { AIAnalysisInput, AIModelOutput, AIProviderConfig } from "@/src/types/ai";
import { clampScore } from "@/src/server/ai/utils";
import { buildIndicatorSnapshot } from "@/src/server/ai/indicator-suite";
import { buildStandardizedOutput } from "@/src/server/ai/providers/standardized-output";

function buildOutput(input: AIAnalysisInput, signalBias: number, riskPenalty: number, label: string): AIModelOutput {
  const recent = input.klines.slice(-24);
  const highs = recent.map((x) => x.high);
  const lows = recent.map((x) => x.low);
  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const rangePos = rangeHigh === rangeLow ? 0.5 : (input.lastPrice - rangeLow) / Math.max(rangeHigh - rangeLow, 0.0001);
  const microTrend =
    recent.length > 6
      ? (recent[recent.length - 1].close - recent[recent.length - 6].close) /
        Math.max(recent[recent.length - 6].close, 1)
      : 0;
  const confidence = clampScore(54 + signalBias * 28 - riskPenalty * 16 + microTrend * 120 + (rangePos - 0.5) * 10);
  const decision =
    confidence > 72 ? (signalBias >= 0 ? "BUY" : "SELL") : confidence < 45 ? "NO_TRADE" : "HOLD";
  const bullishFactors = [
    signalBias >= 0 ? "Flow and momentum bias positive" : "",
    microTrend > 0 ? "Micro trend upward" : "",
    rangePos >= 0.55 ? "Price positioned above local midpoint" : "",
  ].filter(Boolean);
  const bearishFactors = [
    signalBias < 0 ? "Flow and momentum bias negative" : "",
    microTrend < 0 ? "Micro trend downward" : "",
    rangePos <= 0.45 ? "Price positioned below local midpoint" : "",
  ].filter(Boolean);
  const noTradeTriggers = [
    confidence < 45 ? "confidence_below_threshold" : "",
    riskPenalty > 1 ? "risk_penalty_high" : "",
  ].filter(Boolean);
  return {
    decision,
    confidence,
    targetPrice: Number((input.lastPrice * (1 + (signalBias > 0 ? 0.006 : -0.006))).toFixed(2)),
    stopPrice: Number((input.lastPrice * (1 + (signalBias > 0 ? -0.004 : 0.004))).toFixed(2)),
    estimatedDurationSec: 180 + Math.round(Math.abs(signalBias) * 220),
    reasoningShort: `${label}: strict crypto analyst modu ile trend, micro-range ve momentum birlikte degerlendirildi.`,
    riskScore: clampScore(45 + riskPenalty * 25),
    standardizedOutput: buildStandardizedOutput({
      analysisInput: input,
      decision,
      confidenceScore: confidence,
      coreThesis: "Technical micro-structure, range position and short momentum blended.",
      bullishFactors,
      bearishFactors,
      riskFlags: riskPenalty > 0.8 ? ["elevated_risk_penalty"] : [],
      noTradeTriggers,
      explanationSummary: `${label}: trend+range+momentum blend output.`,
    }),
    metadata: {
      spread: input.spread,
      volatility: input.volatility,
      ratio: input.recentTradesSummary.buySellRatio,
      remote: false,
    },
  };
}

function resolveTrendDirection(input: AIAnalysisInput, indicators: ReturnType<typeof buildIndicatorSnapshot>) {
  const mtf = input.multiTimeframe;
  if (mtf?.dominantTrend === "BULLISH") return "BULLISH";
  if (mtf?.dominantTrend === "BEARISH") return "BEARISH";
  if (indicators.ema9 > indicators.ema21 && indicators.sma20 > indicators.sma50) return "BULLISH";
  if (indicators.ema9 < indicators.ema21 && indicators.sma20 < indicators.sma50) return "BEARISH";
  return "RANGE";
}

function buildTechnicalSpecialistOutput(input: AIAnalysisInput, label: string): AIModelOutput {
  const ind = buildIndicatorSnapshot(input);
  const trendDirection = resolveTrendDirection(input, ind);
  const tf = input.multiTimeframe;
  const redFlags: string[] = [];
  const confirmations: string[] = [];

  if (!tf || tf.conflict || !tf.trendAligned || !tf.entrySuitable) {
    redFlags.push(`Multi-timeframe uyumsuz: ${tf?.reason ?? "timeframe unavailable"}`);
  } else {
    confirmations.push("4h/1h yon ile 15m/5m giris uyumlu");
  }
  if (ind.fakeBreakout || ind.liquidity.fakeBreakoutDetected) {
    redFlags.push("Fake breakout / wick dominance riski");
  }
  if (ind.liquidity.nearUpperLiquidity || ind.liquidity.nearLowerLiquidity) {
    if (!ind.liquidity.stopHuntDetected) redFlags.push("Likidite temizligi beklenmeli");
    else confirmations.push("Likidite temizligi (stop hunt) tespit edildi");
  }
  if (input.volatility > 3.1 || input.spread > 0.2) {
    redFlags.push("Volatilite/spread entry icin agresif");
  }
  if (input.volume24h < 800_000 || ind.volumeBoost < 0.95) {
    redFlags.push("Hacim destegi zayif");
  } else {
    confirmations.push("Breakout/pullback hacimle destekleniyor");
  }
  if (ind.rsi14 >= 78 || ind.rsi14 <= 24) redFlags.push("Momentum exhaustion riski");

  const structureBull = ind.ema9 > ind.ema21 && ind.sma20 > ind.sma50 && ind.macd > ind.signalLine;
  const structureBear = ind.ema9 < ind.ema21 && ind.sma20 < ind.sma50 && ind.macd < ind.signalLine;
  const pullbackEntry =
    trendDirection === "BULLISH"
      ? input.lastPrice <= ind.vwap * 1.004 && input.lastPrice >= ind.vwap * 0.995
      : trendDirection === "BEARISH"
        ? input.lastPrice >= ind.vwap * 0.996 && input.lastPrice <= ind.vwap * 1.005
        : false;

  const noTrade = redFlags.length >= 2 || trendDirection === "RANGE" || (!structureBull && !structureBear);
  const decision = noTrade ? "NO_TRADE" : trendDirection === "BEARISH" ? "SELL" : "BUY";
  const technicalSetupName =
    decision === "NO_TRADE"
      ? "NO_TRADE_UNCERTAIN_STRUCTURE"
      : ind.liquidity.stopHuntDetected
        ? "LIQUIDITY_SWEEP_PULLBACK_CONTINUATION"
        : ind.breakoutUp || ind.breakoutDown
          ? "BREAKOUT_RETEST_CONTINUATION"
          : "TREND_PULLBACK_REENTRY";

  const idealEntry =
    Number.isFinite(ind.liquidity.safeEntryPoint) && ind.liquidity.safeEntryPoint > 0
      ? ind.liquidity.safeEntryPoint
      : Number(ind.vwap.toFixed(8));
  const atrRisk = Math.max(ind.atr14 * 0.9, input.lastPrice * 0.0035);
  const stopPrice =
    decision === "BUY"
      ? Number((idealEntry - atrRisk).toFixed(8))
      : decision === "SELL"
        ? Number((idealEntry + atrRisk).toFixed(8))
        : null;
  const targetPrice =
    decision === "BUY"
      ? Number((idealEntry + atrRisk * 2.1).toFixed(8))
      : decision === "SELL"
        ? Number((idealEntry - atrRisk * 2.1).toFixed(8))
        : null;
  const rr =
    stopPrice && targetPrice
      ? Math.abs((targetPrice - idealEntry) / Math.max(Math.abs(idealEntry - stopPrice), 0.0000001))
      : 0;

  const confidenceBase =
    (structureBull || structureBear ? 24 : 8) +
    (tf?.trendAligned ? 22 : 6) +
    (tf?.entrySuitable ? 16 : 5) +
    (ind.volumeBoost > 1.05 ? 10 : 4) +
    (ind.liquidity.stopHuntDetected ? 10 : 0) +
    (rr >= 1.6 ? 10 : 2) -
    redFlags.length * 8;
  const confidence = clampScore(confidenceBase + 26);
  const bullishFactors = [
    ...confirmations,
    structureBull ? "Bullish structure alignment" : "",
    ind.breakoutUp ? "Breakout continuation signal" : "",
  ].filter(Boolean);
  const bearishFactors = [
    structureBear ? "Bearish structure alignment" : "",
    ind.breakoutDown ? "Downside breakout pressure" : "",
    ...redFlags,
  ].filter(Boolean).slice(0, 8);
  const noTradeTriggers = decision === "NO_TRADE"
    ? [
        "uncertain_structure",
        ...redFlags.map((x) => x.toLowerCase().replace(/\s+/g, "_")),
      ].slice(0, 8)
    : [];

  return {
    decision,
    confidence,
    targetPrice,
    stopPrice,
    estimatedDurationSec: decision === "NO_TRADE" ? 120 : 260,
    reasoningShort:
      decision === "NO_TRADE"
        ? `${label}: teknik yapi belirsiz, no-trade.`
        : `${label}: teknik setup ${technicalSetupName}, pullback+structure uyumlu.`,
    riskScore: clampScore(100 - confidence + redFlags.length * 6),
    standardizedOutput: buildStandardizedOutput({
      analysisInput: input,
      decision,
      confidenceScore: confidence,
      coreThesis: `${technicalSetupName} with multi-timeframe structure and liquidity confirmation.`,
      bullishFactors,
      bearishFactors,
      riskFlags: redFlags,
      noTradeTriggers,
      explanationSummary:
        decision === "NO_TRADE"
          ? `Technical no-trade due to ${redFlags.slice(0, 3).join(" | ") || "uncertain structure"}`
          : `Technical setup ${technicalSetupName} aligned with timeframe structure.`,
    }),
    metadata: {
      remote: false,
      technicalExpert: true,
      symbol: input.symbol,
      trendDirection,
      technicalSetupName,
      entryZone:
        decision === "NO_TRADE"
          ? null
          : {
              low: Number((idealEntry * 0.9985).toFixed(8)),
              high: Number((idealEntry * 1.0015).toFixed(8)),
            },
      idealEntry,
      takeProfit: targetPrice,
      stopLoss: stopPrice,
      riskReward: Number(rr.toFixed(4)),
      technicalConfidenceScore: confidence,
      redFlags,
      tradeable: decision !== "NO_TRADE",
      reasonedSummary:
        decision === "NO_TRADE"
          ? `Teknik no-trade: ${redFlags.join(" | ") || "yapi net degil"}`
          : `Trend=${trendDirection}; setup=${technicalSetupName}; teyit=${confirmations.join(" | ")}`,
      structure: {
        marketStructure: trendDirection,
        breakOfStructure: ind.breakoutUp || ind.breakoutDown,
        changeOfCharacter: (trendDirection === "BULLISH" && ind.trend15m === "DOWN") || (trendDirection === "BEARISH" && ind.trend15m === "UP"),
      },
      supportResistance: {
        support: Number(ind.support.toFixed(8)),
        resistance: Number(ind.resistance.toFixed(8)),
        vwap: Number(ind.vwap.toFixed(8)),
        retestLikely: pullbackEntry,
      },
      indicators: {
        rsi: Number(ind.rsi14.toFixed(2)),
        macd: Number(ind.macd.toFixed(6)),
        signal: Number(ind.signalLine.toFixed(6)),
        bollingerMid: Number(ind.bollMid.toFixed(8)),
        ema9: Number(ind.ema9.toFixed(8)),
        ema21: Number(ind.ema21.toFixed(8)),
        sma20: Number(ind.sma20.toFixed(8)),
        sma50: Number(ind.sma50.toFixed(8)),
        atr: Number(ind.atr14.toFixed(8)),
        stochRsi: Number(ind.stochRsi.toFixed(2)),
        vwap: Number(ind.vwap.toFixed(8)),
        volumeBoost: Number(ind.volumeBoost.toFixed(4)),
      },
      priceAction: {
        bullishCandle: ind.bullishCandle,
        bearishCandle: ind.bearishCandle,
        wickDominance: ind.liquidity.wickDominance,
        fakeBreakout: ind.fakeBreakout,
      },
      pattern: {
        rangeBreakout: ind.breakoutUp || ind.breakoutDown,
        fakeBreakout: ind.fakeBreakout,
      },
      liquidityAnalysis: {
        liquidityZones: ind.liquidity.liquidityZones,
        probableStopClusters: ind.liquidity.probableStopClusters,
        sweepDetected: ind.liquidity.liquiditySweepDetected,
        fakeBreakoutRisk: ind.liquidity.fakeBreakoutRiskScore,
        safeEntryTiming: ind.liquidity.safeEntryTiming,
        liquidityRiskScore: ind.liquidity.liquidityRiskScore,
        trappedTradersScenario: ind.liquidity.trappedTradersScenario,
        breakoutTrap: ind.liquidity.breakoutTrap,
        rangeLiquidityGrab: ind.liquidity.rangeLiquidityGrab,
        smartMoneyStyleSummary: ind.liquidity.smartMoneyStyleSummary,
      },
      multiTimeframe: input.multiTimeframe ?? null,
      timeframeAlignment: input.multiTimeframe
        ? {
            higherTimeframeTrend: input.multiTimeframe.higher.trend,
            midTimeframeStructure: input.multiTimeframe.mid.structure,
            lowerTimeframeEntryQuality: input.multiTimeframe.lower.entryQuality,
            timeframeAlignmentScore: input.multiTimeframe.alignmentScore,
            conflictingSignals: input.multiTimeframe.conflictingSignals,
            finalAlignmentSummary: input.multiTimeframe.finalAlignmentSummary,
          }
        : null,
      volatilityVolume: {
        spread: input.spread,
        volatility: input.volatility,
        breakoutVolumeSupported: ind.volumeBoost > 1.05,
        atrStopLogical: stopPrice !== null,
      },
      policy: {
        onlyTechnical: true,
        noNewsCommentary: true,
        noRiskApproval: true,
        explainable: true,
      },
    },
  };
}

export class Provider1Adapter implements AIProviderAdapter {
  readonly config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  async analyzeTechnicalSignal(input: AIAnalysisInput): Promise<AIModelOutput> {
    const expertOutput = buildTechnicalSpecialistOutput(input, this.config.name);
    const remote = await analyzeWithRemoteModel(this.config, input, "technical");
    if (!remote) return expertOutput;
    const blendedConfidence = clampScore(expertOutput.confidence * 0.7 + remote.confidence * 0.3);
    const blendedRisk = clampScore(expertOutput.riskScore * 0.75 + remote.riskScore * 0.25);
    return {
      ...expertOutput,
      confidence: blendedConfidence,
      riskScore: blendedRisk,
      metadata: {
        ...expertOutput.metadata,
        remote: true,
        remoteEnrichmentUsed: true,
        remoteDecision: remote.decision,
        remoteConfidence: remote.confidence,
      },
    };
  }

  async analyzeMomentumSignal(input: AIAnalysisInput): Promise<AIModelOutput> {
    const ratio = input.recentTradesSummary.buySellRatio;
    const signalBias = ratio >= 1 ? Math.min(1, (ratio - 1) / 0.4) : -Math.min(1, (1 - ratio) / 0.4);
    const riskPenalty = input.spread > 0.08 ? 0.8 : 0.25;
    const fallback = buildOutput(input, signalBias, riskPenalty, this.config.name);
    const remote = await analyzeWithRemoteModel(this.config, input, "momentum");
    if (remote) {
      return {
        ...remote,
        standardizedOutput: remote.standardizedOutput ?? fallback.standardizedOutput,
      };
    }
    return fallback;
  }

  async analyzeRiskAssessment(input: AIAnalysisInput): Promise<AIModelOutput> {
    const riskPenalty = input.volatility > 3 ? 1.2 : input.volatility > 2 ? 0.8 : 0.2;
    const fallback = buildOutput(input, 0.05, riskPenalty, this.config.name);
    const remote = await analyzeWithRemoteModel(this.config, input, "risk");
    if (remote) {
      return {
        ...remote,
        standardizedOutput: remote.standardizedOutput ?? fallback.standardizedOutput,
      };
    }
    return fallback;
  }
}
