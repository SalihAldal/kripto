import { env } from "@/lib/config";
import { evaluateMomentumBreakout } from "@/src/server/scanner/momentum-breakout.service";
import type { MarketContext, ScannerScore } from "@/src/types/scanner";

/** Stable signal generation policy contract for API/status consumers. */
export const SIGNAL_GENERATION_POLICY = {
  preTradeScoringRequired: true,
  momentumBreakoutGateEnabled: true,
  rankingBeforeAiConsensus: true,
  qualityGateAfterAiConsensus: true,
  workerSnapshotPreferred: true,
} as const;

function normalize(value: number, min: number, max: number) {
  if (value <= min) return 0;
  if (value >= max) return 100;
  return ((value - min) / (max - min)) * 100;
}

export function scoreContext(context: MarketContext): ScannerScore {
  const shortMomentumPercent = Number(context.metadata.shortMomentumPercent ?? 0);
  const tradeVelocity = Number(context.metadata.tradeVelocity ?? 0);
  const shortFlowImbalance = Number(context.metadata.shortFlowImbalance ?? 0);

  const upwardMomentum = Math.max(0, context.momentumPercent);
  const upwardMicroMomentum = Math.max(0, shortMomentumPercent);
  const momentum = normalize(upwardMomentum, 0.03, 1.1);
  const microMomentum = normalize(upwardMicroMomentum, 0.005, 0.35);
  const volume = normalize(context.volume24h, env.SCANNER_MIN_VOLUME_24H, env.SCANNER_MIN_VOLUME_24H * 8);
  const spread = 100 - normalize(context.spreadPercent, 0.01, env.SCANNER_MAX_SPREAD_PERCENT * 1.5);
  const volatility = 100 - normalize(context.volatilityPercent, 0.3, 4.5);
  const orderBook = normalize(Math.abs(context.orderBookImbalance), 0.01, 0.45);
  const pressure = normalize(Math.abs(context.buyPressure - 0.5), 0.02, 0.35);
  const microFlow = normalize(Math.abs(shortFlowImbalance), 0.02, 0.6);
  const velocity = normalize(tradeVelocity, 0.2, 3.5);
  const candle = normalize(Math.abs(context.shortCandleSignal), 0.5, 4);
  const pumpBoost = normalize(context.pumpIntensity ?? 0, 35, 100);
  const pumpRiskPenalty = normalize(context.pumpRisk ?? 0, 25, 95);
  const fakeSpikePenalty = normalize(context.fakeSpikeScore ?? 0, 0, 4);
  const futuresRiskPenalty = normalize(Number(context.metadata.futuresRiskScore ?? 0), 45, 90);
  const leverageStressPenalty = normalize(Number(context.metadata.leverageStressScore ?? 0), 45, 90);
  const regimeTransitionPenalty = normalize(Number(context.metadata.regimeTransitionProbability ?? 0), 35, 90);
  const regimeFlipPenalty = normalize(Number(context.metadata.regimeFlipRisk ?? 0), 35, 90);
  const regimeStabilityBoost = normalize(Number(context.metadata.regimeStabilityScore ?? 50), 62, 88);
  const liquidityPenalty = context.volume24h < env.SCANNER_MIN_VOLUME_24H ? 40 : 0;

  const rawScore =
    momentum * 0.12 +
    microMomentum * 0.16 +
    volume * 0.14 +
    spread * 0.12 +
    volatility * 0.08 +
    orderBook * 0.12 +
    pressure * 0.1 +
    microFlow * 0.08 +
    velocity * 0.08 +
    candle * 0.1 -
    pumpRiskPenalty * 0.1 +
    fakeSpikePenalty * 0.12 -
    futuresRiskPenalty * 0.08 -
    leverageStressPenalty * 0.06 -
    regimeTransitionPenalty * 0.07 -
    regimeFlipPenalty * 0.05 +
    regimeStabilityBoost * 0.035 -
    liquidityPenalty +
    pumpBoost * 0.06;

  const score = Math.max(0, Math.min(100, Number(rawScore.toFixed(2))));
  const confidence = Math.max(0, Math.min(100, Number((score * 0.9 + (context.tradable ? 8 : -10)).toFixed(2))));
  const reasons = [...context.rejectReasons];
  const marketRegime = String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
  const momentumBreakout = evaluateMomentumBreakout(context);
  const bullishSignal =
    (context.momentumPercent > 0 || shortMomentumPercent > 0) &&
    context.buyPressure >= 0.5 &&
    shortFlowImbalance >= -0.08;
  const bearishSignal =
    (context.momentumPercent < 0 || shortMomentumPercent < 0) &&
    context.buyPressure <= 0.5 &&
    shortFlowImbalance <= 0.08;
  if (!bullishSignal && !bearishSignal) reasons.push("Directional edge not clear");
  if (score < env.SCANNER_MIN_SCORE) reasons.push("Score below threshold");
  if (marketRegime === "LOW_VOLUME_DEAD_MARKET") reasons.push("Regime LOW_VOLUME_DEAD_MARKET: trade disabled");
  if (Number(context.metadata.futuresRiskScore ?? 0) >= 72) {
    reasons.push(`Futures risk elevated: ${String(context.metadata.futuresRiskSummary ?? context.metadata.futuresIntent ?? "unknown")}`);
  }
  if (Number(context.metadata.leveragedTrapProbability ?? 0) >= 72) {
    reasons.push("Leveraged trap probability high");
  }
  if (Number(context.metadata.regimeTransitionProbability ?? 0) >= 62) {
    reasons.push(`Regime transition phase: ${String(context.metadata.regimeLifecyclePhase ?? "TRANSITION")}`);
  }
  if (Boolean(context.metadata.regimeChopWarning)) {
    reasons.push("Regime chop/rapid switching warning");
  }
  if (marketRegime === "LOW_VOLATILITY_CALM" && Math.abs(shortMomentumPercent) < 0.08) {
    reasons.push("Regime LOW_VOLATILITY: momentum zayif, mean reversion disinda riskli");
  }
  if (
    (marketRegime === "HIGH_VOLATILITY_CHAOS" || marketRegime === "NEWS_DRIVEN_UNSTABLE") &&
    (context.spreadPercent > 0.12 || context.fakeSpikeScore > 1.8) &&
    !momentumBreakout.ok
  ) {
    reasons.push("Regime CHAOS/UNSTABLE: spread/wick strict filter");
  }
  if ((marketRegime === "STRONG_BEARISH_TREND" || marketRegime === "WEAK_BEARISH_TREND") && !bullishSignal) {
    reasons.push("Regime BEARISH: only selective bounce setup allowed");
  }
  const directionalGated = bullishSignal || bearishSignal;
  const regimeGate =
    marketRegime !== "LOW_VOLUME_DEAD_MARKET" &&
    Number(context.metadata.futuresRiskScore ?? 0) < 88 &&
    Number(context.metadata.leveragedTrapProbability ?? 0) < 90 &&
    Number(context.metadata.regimeChaosProbability ?? 0) < 88 &&
    !Boolean(context.metadata.regimeChopWarning) &&
    !(
      (marketRegime === "HIGH_VOLATILITY_CHAOS" || marketRegime === "NEWS_DRIVEN_UNSTABLE") &&
      (context.spreadPercent > 0.12 || context.fakeSpikeScore > 1.8) &&
      !momentumBreakout.ok
    ) &&
    !((marketRegime === "STRONG_BEARISH_TREND" || marketRegime === "WEAK_BEARISH_TREND") && !bullishSignal);

  return {
    symbol: context.symbol,
    score,
    confidence,
    status: context.tradable && (directionalGated || momentumBreakout.ok) && regimeGate && (score >= env.SCANNER_MIN_SCORE || momentumBreakout.ok) ? "QUALIFIED" : "REJECTED",
    reasons,
    metrics: {
      momentum: Number(momentum.toFixed(2)),
      microMomentum: Number(microMomentum.toFixed(2)),
      volume: Number(volume.toFixed(2)),
      spread: Number(spread.toFixed(2)),
      volatility: Number(volatility.toFixed(2)),
      orderBook: Number(orderBook.toFixed(2)),
      pressure: Number(pressure.toFixed(2)),
      microFlow: Number(microFlow.toFixed(2)),
      velocity: Number(velocity.toFixed(2)),
      candle: Number(candle.toFixed(2)),
      pumpBoost: Number(pumpBoost.toFixed(2)),
      pumpRiskPenalty: Number(pumpRiskPenalty.toFixed(2)),
      fakeSpikePenalty: Number(fakeSpikePenalty.toFixed(2)),
      futuresRiskPenalty: Number(futuresRiskPenalty.toFixed(2)),
      leverageStressPenalty: Number(leverageStressPenalty.toFixed(2)),
      regimeTransitionPenalty: Number(regimeTransitionPenalty.toFixed(2)),
      regimeFlipPenalty: Number(regimeFlipPenalty.toFixed(2)),
      regimeStabilityBoost: Number(regimeStabilityBoost.toFixed(2)),
      liquidityPenalty: Number(liquidityPenalty.toFixed(2)),
    },
  };
}
