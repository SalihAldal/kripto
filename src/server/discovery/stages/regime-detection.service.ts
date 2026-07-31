import type { DiscoveryRegime } from "@prisma/client";
import type { MarketContext } from "@/src/types/scanner";

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function detectDiscoveryRegime(context: MarketContext): DiscoveryRegime {
  const change = context.change24h ?? 0;
  const momentum = context.momentumPercent ?? 0;
  const vol = context.volatilityPercent ?? 0;
  const pump = context.pumpIntensity ?? 0;
  const pumpRisk = context.pumpRisk ?? 0;
  const imbalance = context.orderBookImbalance ?? 0;
  const buyPressure = context.buyPressure ?? 0;
  const fakeSpike = context.fakeSpikeScore ?? 0;
  const volumeSpike = context.volumeSpikePercent ?? 0;
  const newsSentiment = String(context.metadata?.newsSentiment ?? "NEUTRAL").toUpperCase();

  if (fakeSpike >= 70 && change > 8) return "FAKE_BREAKOUT";
  if (pump >= 75 && change > 12) return "PUMP";
  if (change <= -12 && momentum <= -4) return "DUMP";
  if (vol >= 8 && Math.abs(change) <= 2) return "HIGH_VOLATILITY";
  if (vol <= 1.5 && Math.abs(change) <= 1.5) return "LOW_VOLATILITY";
  if (volumeSpike >= 120 && change > 4 && buyPressure >= 55) return "BREAKOUT";
  if (volumeSpike >= 80 && change > 0 && momentum > 0 && buyPressure >= 50) return "ACCUMULATION";
  if (volumeSpike >= 80 && change < 0 && momentum < 0) return "DISTRIBUTION";
  if (imbalance >= 0.35 && change > 6) return "SHORT_SQUEEZE";
  if (imbalance <= -0.35 && change < -6) return "LONG_SQUEEZE";
  if (Math.abs(change) <= 2.5 && vol <= 4) return "RANGE";
  if (newsSentiment === "POSITIVE" && change > 3) return "NEWS_RALLY";
  if (context.spreadPercent >= 0.12 && volumeSpike >= 60) return "LIQUIDITY_TRAP";
  if (change >= 4 && momentum >= 2) return "BULL";
  if (change <= -4 && momentum <= -2) return "BEAR";

  return "UNKNOWN";
}

export function regimeConfidence(context: MarketContext, regime: DiscoveryRegime): number {
  const signals = [
    Math.abs(context.change24h ?? 0) * 4,
    Math.abs(context.momentumPercent ?? 0) * 6,
    context.volumeSpikePercent ?? 0,
    context.pumpIntensity ?? 0,
    100 - (context.fakeSpikeScore ?? 0),
  ];
  const base = signals.reduce((sum, value) => sum + value, 0) / signals.length;
  const unknownPenalty = regime === "UNKNOWN" ? 15 : 0;
  return clampScore(base - unknownPenalty);
}
