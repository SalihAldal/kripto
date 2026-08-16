import type { AIAnalysisInput } from "@/src/types/ai";
import { clampScore } from "@/src/server/decision-engine/experts/expert.utils";

export function hasMomentumExpertTelemetry(input: AIAnalysisInput) {
  const raw = input.marketSignals?.shortMomentumPercent;
  return raw !== undefined && raw !== null && Number.isFinite(Number(raw)) && (input.klines?.length ?? 0) > 6;
}

/**
 * shortMomentumPercent is stored as percent points (0.42 = 0.42%).
 * Legacy formula multiplied by 8, collapsing typical moves into ~0-15 and
 * preventing matrix.momentum from ever reaching master BUY thresholds.
 */
export function scoreMomentumImpulse(input: AIAnalysisInput) {
  const signals = input.marketSignals;
  const shortMomPct = Math.abs(Number(signals?.shortMomentumPercent ?? 0));
  const change5m = Math.abs(Number(signals?.change5m ?? 0));
  const change15m = Math.abs(Number(signals?.change15m ?? 0));
  return clampScore(shortMomPct * 28 + change5m * 10 + change15m * 4);
}

export function scoreMomentumContinuation(input: AIAnalysisInput) {
  const signals = input.marketSignals;
  return clampScore((signals?.change15m ?? 0) > 0 && (signals?.change5m ?? 0) > 0 ? 75 : 45);
}

export function scoreMomentumVelocity(input: AIAnalysisInput) {
  const signals = input.marketSignals;
  return clampScore((signals?.tradeVelocity ?? 0) * 10 + (signals?.volumeSpikeRatio ?? 1) * 20);
}

export function scoreMomentumRelativeStrength(input: AIAnalysisInput) {
  const change24h = input.marketSignals?.change24h ?? 0;
  return clampScore(50 + change24h * 3);
}
