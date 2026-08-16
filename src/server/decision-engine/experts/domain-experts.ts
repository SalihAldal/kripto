import type { AIAnalysisInput, AIProviderResult } from "@/src/types/ai";
import { buildExpertResult, clampScore, scoreToOpinion } from "@/src/server/decision-engine/experts/expert.utils";
import {
  hasMomentumExpertTelemetry,
  scoreMomentumContinuation,
  scoreMomentumImpulse,
  scoreMomentumRelativeStrength,
  scoreMomentumVelocity,
} from "@/src/server/decision-engine/experts/momentum-expert.utils";

export function analyzeMarketExpert(input: AIAnalysisInput, providers?: AIProviderResult[]) {
  const regime = input.marketRegime;
  const mtf = input.multiTimeframe;
  const signals = input.marketSignals;
  const regimeScore = clampScore(regime?.confidenceScore ?? 50);
  const alignmentScore = clampScore(mtf?.alignmentScore ?? 50);
  const healthScore = clampScore(100 - (signals?.futuresRiskScore ?? 0) * 0.4 - (signals?.leverageStressScore ?? 0) * 0.3);
  const btcBias = signals?.btcDominanceBias ?? 0;
  const change24h = signals?.change24h ?? 0;
  const score = clampScore(regimeScore * 0.35 + alignmentScore * 0.35 + healthScore * 0.2 + (change24h > 0 ? 10 : 0) + btcBias * 5);
  const techProvider = providers?.find((row) => row.ok && row.output)?.output;
  const bullishBias = techProvider?.decision === "BUY" ? 4 : techProvider?.decision === "SELL" ? -4 : 0;

  return buildExpertResult({
    expertType: "MARKET",
    opinion: scoreToOpinion(score, bullishBias),
    score,
    summary: `Regime ${regime?.mode ?? "UNKNOWN"} alignment=${alignmentScore.toFixed(0)} health=${healthScore.toFixed(0)}`,
    positiveFactors: [
      regime?.openTradeAllowed ? "openTradeAllowed" : "",
      mtf?.trendAligned ? "multiTimeframeAligned" : "",
      change24h > 0 ? "positive24hChange" : "",
    ].filter(Boolean),
    negativeFactors: [
      mtf?.conflict ? "timeframeConflict" : "",
      (signals?.macroUncertaintyLevel ?? 0) > 0.6 ? "macroUncertainty" : "",
      regime?.mode?.includes("BEAR") ? "bearishRegime" : "",
    ].filter(Boolean),
    topRisks: [
      (signals?.regimeTransitionProbability ?? 0) > 0.5 ? "regimeTransition" : "",
      (signals?.regimeChaosProbability ?? 0) > 0.4 ? "regimeChaos" : "",
    ].filter(Boolean),
    metadata: { regime: regime?.mode, alignmentScore, healthScore },
  });
}

export function analyzeMomentumExpert(input: AIAnalysisInput, providers?: AIProviderResult[]) {
  const signals = input.marketSignals;
  if (!hasMomentumExpertTelemetry(input)) {
    return buildExpertResult({
      expertType: "MOMENTUM",
      opinion: "NO_OPINION",
      score: 50,
      summary: "Insufficient short-window momentum telemetry",
      positiveFactors: [],
      negativeFactors: [],
      topRisks: ["insufficientMomentumTelemetry"],
      metadata: { sampleSize: input.klines?.length ?? 0 },
    });
  }
  const mom = scoreMomentumImpulse(input);
  const continuation = scoreMomentumContinuation(input);
  const velocity = scoreMomentumVelocity(input);
  const relStrength = scoreMomentumRelativeStrength(input);
  const score = clampScore(mom * 0.35 + continuation * 0.25 + velocity * 0.2 + relStrength * 0.2);
  const momentumProvider = providers?.find((row) => row.providerId.includes("2") || row.providerName.toLowerCase().includes("sentiment"));
  const bias = momentumProvider?.output?.decision === "BUY" ? 5 : momentumProvider?.output?.decision === "SELL" ? -5 : 0;
  const shortMomentumPercent = Number(signals?.shortMomentumPercent ?? 0);

  return buildExpertResult({
    expertType: "MOMENTUM",
    opinion: scoreToOpinion(score, bias),
    score,
    summary: `Momentum ${mom.toFixed(0)} continuation ${continuation.toFixed(0)} velocity ${velocity.toFixed(0)}`,
    positiveFactors: [shortMomentumPercent > 1 ? "shortMomentumPositive" : "", (signals?.change5m ?? 0) > 0 ? "5mAcceleration" : ""].filter(Boolean),
    negativeFactors: [shortMomentumPercent < -1 ? "shortMomentumNegative" : "", (signals?.change5m ?? 0) < 0 ? "5mDeceleration" : ""].filter(Boolean),
    topRisks: [(signals?.regimeUnstableBreakoutCondition ?? false) ? "unstableBreakout" : ""].filter(Boolean),
    metadata: { mom, continuation, velocity, relStrength },
  });
}

export function analyzeVolumeExpert(input: AIAnalysisInput) {
  const signals = input.marketSignals;
  const buy = input.recentTradesSummary.buyVolume;
  const sell = input.recentTradesSummary.sellVolume;
  const delta = buy - sell;
  const cvdScore = clampScore(50 + (delta / Math.max(buy + sell, 1)) * 50);
  const spikeScore = clampScore((signals?.volumeSpikeRatio ?? 1) * 35);
  const pressureScore = clampScore(50 + (signals?.shortFlowImbalance ?? 0) * 50);
  const volume24hScore = clampScore(Math.log10(Math.max(1, input.volume24h)) * 12);
  const score = clampScore(cvdScore * 0.35 + spikeScore * 0.25 + pressureScore * 0.25 + volume24hScore * 0.15);

  return buildExpertResult({
    expertType: "VOLUME",
    opinion: scoreToOpinion(score, delta > 0 ? 3 : delta < 0 ? -3 : 0),
    score,
    summary: `Volume delta=${delta.toFixed(0)} spike=${(signals?.volumeSpikeRatio ?? 1).toFixed(2)} pressure=${pressureScore.toFixed(0)}`,
    positiveFactors: [delta > 0 ? "positiveDelta" : "", (signals?.volumeSpikeRatio ?? 0) > 1.5 ? "volumeSpike" : ""].filter(Boolean),
    negativeFactors: [delta < 0 ? "negativeDelta" : "", input.volume24h <= 0 ? "missingVolume" : ""].filter(Boolean),
    topRisks: [(signals?.volumeSpikeRatio ?? 0) > 3 ? "abnormalVolumeSpike" : ""].filter(Boolean),
    metadata: { cvdScore, spikeScore, pressureScore },
  });
}

export function analyzeLiquidityExpert(input: AIAnalysisInput) {
  const spreadScore = clampScore(100 - input.spread * 400);
  const depth = input.orderBookSummary.bidDepth + input.orderBookSummary.askDepth;
  const depthScore = clampScore(Math.log10(Math.max(1, depth)) * 18);
  const imbalance = (input.orderBookSummary.bidDepth - input.orderBookSummary.askDepth) / Math.max(depth, 1);
  const bookScore = clampScore(50 + imbalance * 40);
  const absorptionScore = clampScore(spreadScore * 0.5 + depthScore * 0.5);
  const score = clampScore(spreadScore * 0.35 + depthScore * 0.3 + bookScore * 0.2 + absorptionScore * 0.15);

  return buildExpertResult({
    expertType: "LIQUIDITY",
    opinion: scoreToOpinion(score),
    score,
    summary: `Liquidity spread=${input.spread.toFixed(4)} depth=${depth.toFixed(0)} imbalance=${imbalance.toFixed(3)}`,
    positiveFactors: [spreadScore > 60 ? "tightSpread" : "", depthScore > 55 ? "adequateDepth" : ""].filter(Boolean),
    negativeFactors: [input.spread > 0.12 ? "wideSpread" : "", depthScore < 35 ? "thinBook" : ""].filter(Boolean),
    topRisks: [input.spread > 0.2 ? "liquidityTrapRisk" : "", imbalance > 0.5 ? "bookImbalance" : ""].filter(Boolean),
    metadata: { spreadScore, depthScore, bookScore },
  });
}

export function analyzeRiskExpert(input: AIAnalysisInput, providers?: AIProviderResult[]) {
  const signals = input.marketSignals;
  const volScore = clampScore(100 - (input.volatility ?? 0) * 8);
  const futuresRisk = clampScore(100 - (signals?.futuresRiskScore ?? 0));
  const leverageStress = clampScore(100 - (signals?.leverageStressScore ?? 0));
  const trapRisk = clampScore(100 - (signals?.leveragedTrapProbability ?? 0));
  const atrProxy = input.klines.length > 14 ? clampScore(100 - Math.abs(input.klines[input.klines.length - 1].high - input.klines[input.klines.length - 1].low) / Math.max(input.lastPrice, 1) * 500) : 50;
  const riskProvider = providers?.find((row) => row.providerId.includes("3") || row.providerName.toLowerCase().includes("risk"));
  const providerRisk = riskProvider?.output?.riskScore ?? 50;
  const score = clampScore(volScore * 0.25 + futuresRisk * 0.2 + leverageStress * 0.15 + trapRisk * 0.15 + atrProxy * 0.15 + (100 - providerRisk) * 0.1);

  return buildExpertResult({
    expertType: "RISK",
    opinion: scoreToOpinion(score, score < 45 ? -8 : 0),
    score,
    summary: `Risk vol=${input.volatility?.toFixed(2)} futuresRisk=${signals?.futuresRiskScore ?? 0} leverageStress=${signals?.leverageStressScore ?? 0}`,
    positiveFactors: [volScore > 60 ? "controlledVolatility" : "", futuresRisk > 60 ? "futuresRiskAcceptable" : ""].filter(Boolean),
    negativeFactors: [input.volatility > 6 ? "highVolatility" : "", (signals?.squeezeProbability ?? 0) > 60 ? "squeezeRisk" : ""].filter(Boolean),
    topRisks: [(signals?.manipulationPressureScore ?? 0) > 50 ? "manipulationPressure" : "", providerRisk > 70 ? "providerRiskElevated" : ""].filter(Boolean),
    metadata: { volScore, futuresRisk, leverageStress, providerRisk },
  });
}

export function analyzeNewsExpert(input: AIAnalysisInput) {
  const signals = input.marketSignals;
  const sentiment = signals?.newsSentiment ?? "NEUTRAL";
  const social = signals?.socialSentimentScore ?? 50;
  const funding = Math.abs(signals?.fundingRate ?? 0);
  const whaleScore = clampScore((signals?.liquidationImbalance ?? 0) * 0.5 + 50);
  const newsScore =
    sentiment === "POSITIVE" ? clampScore(65 + social * 0.3) : sentiment === "NEGATIVE" ? clampScore(35 - social * 0.2) : clampScore(social);
  const fundingScore = clampScore(100 - funding * 5000);
  const score = clampScore(newsScore * 0.45 + fundingScore * 0.25 + whaleScore * 0.3);

  return buildExpertResult({
    expertType: "NEWS",
    opinion: scoreToOpinion(score, sentiment === "POSITIVE" ? 4 : sentiment === "NEGATIVE" ? -6 : 0),
    score,
    summary: `News sentiment=${sentiment} social=${social} funding=${signals?.fundingRate ?? 0}`,
    positiveFactors: [sentiment === "POSITIVE" ? "positiveNews" : "", social > 60 ? "socialBullish" : ""].filter(Boolean),
    negativeFactors: [signals?.macroHighImpactNews ? "highImpactNews" : "", sentiment === "NEGATIVE" ? "negativeNews" : ""].filter(Boolean),
    topRisks: [(signals?.macroUncertaintyLevel ?? 0) > 0.7 ? "macroEventRisk" : ""].filter(Boolean),
    metadata: { sentiment, social, fundingScore },
  });
}

export function analyzeExecutionExpert(input: AIAnalysisInput) {
  const spreadPenalty = clampScore(100 - input.spread * 500);
  const slippageProxy = clampScore(100 - Math.abs(input.orderBookSummary.bestAsk - input.orderBookSummary.bestBid) / Math.max(input.lastPrice, 1) * 2000);
  const timingScore = clampScore((input.multiTimeframe?.entrySuitable ?? false) ? 80 : 50);
  const entryQuality = input.multiTimeframe?.lower?.entryQuality ?? "MEDIUM";
  const entryBoost = entryQuality === "HIGH" ? 12 : entryQuality === "LOW" ? -10 : 0;
  const score = clampScore(spreadPenalty * 0.4 + slippageProxy * 0.3 + timingScore * 0.3 + entryBoost);

  return buildExpertResult({
    expertType: "EXECUTION",
    opinion: scoreToOpinion(score),
    score,
    summary: `Execution spread=${input.spread.toFixed(4)} entryQuality=${entryQuality} timing=${timingScore.toFixed(0)}`,
    positiveFactors: [spreadPenalty > 70 ? "goodSpread" : "", entryQuality === "HIGH" ? "highEntryQuality" : ""].filter(Boolean),
    negativeFactors: [input.spread > 0.1 ? "executionSpreadWide" : "", entryQuality === "LOW" ? "poorEntryTiming" : ""].filter(Boolean),
    topRisks: [slippageProxy < 40 ? "slippageRisk" : ""].filter(Boolean),
    metadata: { spreadPenalty, slippageProxy, timingScore, entryQuality },
  });
}

export function analyzeLearningExpert(input: AIAnalysisInput) {
  const memory = input.analysisMemory ?? [];
  if (memory.length === 0) {
    return buildExpertResult({
      expertType: "LEARNING",
      opinion: "NO_OPINION",
      score: 50,
      summary: "No historical similarity records available",
      positiveFactors: [],
      negativeFactors: [],
      topRisks: ["insufficientHistory"],
      metadata: { sampleSize: 0 },
    });
  }
  const avgWin = avg(memory.map((row) => row.winRate));
  const avgReturn = avg(memory.map((row) => row.avgReturn));
  const sampleSize = memory.reduce((sum, row) => sum + row.sampleCount, 0);
  const score = clampScore(avgWin * 0.55 + Math.max(0, 50 + avgReturn * 10) * 0.45);

  return buildExpertResult({
    expertType: "LEARNING",
    opinion: scoreToOpinion(score, avgReturn > 0 ? 3 : avgReturn < 0 ? -3 : 0),
    score,
    summary: `Learning winRate=${avgWin.toFixed(1)} avgReturn=${avgReturn.toFixed(2)} samples=${sampleSize}`,
    positiveFactors: [avgWin > 55 ? "historicalWinRateStrong" : "", avgReturn > 0 ? "positiveHistoricalReturn" : ""].filter(Boolean),
    negativeFactors: [avgWin < 45 ? "weakHistoricalWinRate" : "", avgReturn < 0 ? "negativeHistoricalReturn" : ""].filter(Boolean),
    topRisks: [sampleSize < 5 ? "lowSampleSize" : ""].filter(Boolean),
    metadata: { avgWin, avgReturn, sampleSize },
  });
}

function avg(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
