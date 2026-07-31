import { env } from "@/lib/config";
import type { MarketContext } from "@/src/types/scanner";

export type MomentumBreakoutAssessment = {
  ok: boolean;
  score: number;
  stage: "EARLY" | "ACTIVE" | "LATE" | "NONE";
  direction: "BUY" | "SELL" | "NONE";
  reasons: string[];
};

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function resolveEffectiveShortMomentum(context: MarketContext) {
  const tapeMomentum = num(context.metadata.shortMomentumPercent);
  const hourMomentum = num(context.metadata.hourMomentumPercent);
  const shortFlow = num(context.metadata.shortFlowImbalance);
  if (tapeMomentum >= 0.08) return tapeMomentum;
  if (hourMomentum >= 2.5 && tapeMomentum >= 0.03 && shortFlow >= 0.5) return tapeMomentum;
  if (hourMomentum > 0 && tapeMomentum <= 0) return tapeMomentum;
  return Math.min(tapeMomentum, hourMomentum);
}

export function evaluateMomentumBreakout(context: MarketContext): MomentumBreakoutAssessment {
  const tapeMomentum = num(context.metadata.shortMomentumPercent);
  const hourMomentum = num(context.metadata.hourMomentumPercent);
  const shortFlow = num(context.metadata.shortFlowImbalance);
  const tradeVelocity = num(context.metadata.tradeVelocity);
  const volumeMultiple = context.volume24h / Math.max(1, env.SCANNER_MIN_VOLUME_24H);
  const spreadOk = context.spreadPercent <= 0.22;
  const fakeSpikeOk = context.fakeSpikeScore <= 2.35;
  const pumpRiskOk = context.pumpRisk <= 74;
  const volumeOk = volumeMultiple >= 4 || hourMomentum >= 1.5;
  const velocityOk = tradeVelocity >= 0.45 || hourMomentum >= 2;
  const buyMomentum =
    (tapeMomentum >= 0.15 && shortFlow >= 0.045) ||
    (hourMomentum >= 1 && tapeMomentum >= 0.08 && shortFlow >= 0.25) ||
    (hourMomentum >= 1.5 && tapeMomentum >= 0.06 && shortFlow >= 0.18) ||
    (hourMomentum >= 2.2 && tapeMomentum >= 0.04 && shortFlow >= 0.28);
  const sellMomentum = tapeMomentum <= -0.25 && shortFlow <= -0.045;
  const direction = buyMomentum ? "BUY" : sellMomentum ? "SELL" : "NONE";
  const score = Math.max(
    0,
    Math.min(
      100,
      tapeMomentum * 30 +
        hourMomentum * 8 +
        Math.abs(shortFlow) * 120 +
        tradeVelocity * 8 +
        Math.min(20, volumeMultiple * 1.8) -
        context.spreadPercent * 45 -
        context.fakeSpikeScore * 8 -
        Math.max(0, context.pumpRisk - 55) * 0.45,
    ),
  );
  const stage =
    direction === "NONE"
      ? "NONE"
      : context.pumpRisk >= 70 || context.fakeSpikeScore >= 2.15 || tapeMomentum >= 1.4
        ? "LATE"
        : tapeMomentum >= 0.55 || tradeVelocity >= 1
          ? "ACTIVE"
          : "EARLY";
  const reasons = [
    direction === "NONE" ? "momentum/flow breakout yonu net degil" : "",
    !volumeOk ? `volume multiple ${volumeMultiple.toFixed(2)} < 4` : "",
    !velocityOk ? `trade velocity ${tradeVelocity.toFixed(2)} < 0.45` : "",
    !spreadOk ? `spread ${context.spreadPercent.toFixed(4)}% > 0.22%` : "",
    !fakeSpikeOk ? `fake spike ${context.fakeSpikeScore.toFixed(2)} > 2.35` : "",
    !pumpRiskOk ? `pump risk ${context.pumpRisk.toFixed(2)} > 74` : "",
    stage === "LATE" && score < 55 ? "momentum gec kalmis/pullback beklenmeli" : "",
  ].filter(Boolean);
  return {
    ok: reasons.length === 0 && score >= 42,
    score: Number(score.toFixed(2)),
    stage,
    direction,
    reasons,
  };
}
