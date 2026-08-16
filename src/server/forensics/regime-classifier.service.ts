import type { ForensicRegimeClass } from "@/src/server/forensics/forensic.types";
import { env } from "@/lib/config";

export function classifyForensicRegime(input: {
  marketRegime?: string;
  volatilityPercent?: number;
  volume24h?: number;
  spreadPercent?: number;
  trendStrength?: number;
  chaosProbability?: number;
}): ForensicRegimeClass {
  const marketRegime = String(input.marketRegime ?? "").toUpperCase();
  const volatility = Number(input.volatilityPercent ?? 0);
  const volume = Number(input.volume24h ?? 0);
  const spread = Number(input.spreadPercent ?? 0);
  const chaos = Number(input.chaosProbability ?? 0);

  if (volume > 0 && volume < env.SCANNER_MIN_VOLUME_24H) return "LOW_LIQUIDITY";
  if (
    marketRegime.includes("CHAOS") ||
    marketRegime.includes("UNSTABLE") ||
    chaos >= 0.55 ||
    (volatility >= 2.5 && spread > env.SCANNER_MAX_SPREAD_PERCENT)
  ) {
    return "CHAOS";
  }
  if (marketRegime.includes("HIGH_VOLATILITY") || volatility >= 1.8) return "HIGH_VOLATILITY";
  if (
    marketRegime.includes("BULL") ||
    marketRegime.includes("BEAR") ||
    marketRegime.includes("TREND") ||
    marketRegime.includes("PUMP")
  ) {
    return "TREND";
  }
  if (marketRegime.includes("RANGE") || marketRegime.includes("SIDEWAYS") || marketRegime.includes("LOW_VOL")) {
    return "RANGE";
  }
  if (Number(input.trendStrength ?? 0) >= 0.65) return "TREND";
  if (Number(input.trendStrength ?? 0) <= 0.2 && volatility < 1.2) return "RANGE";
  return "UNKNOWN";
}

export function estimateTrendStrength(input: {
  momentumPercent?: number;
  shortMomentumPercent?: number;
  marketRegime?: string;
}) {
  const longMom = Math.abs(Number(input.momentumPercent ?? 0));
  const shortMom = Math.abs(Number(input.shortMomentumPercent ?? 0));
  const regime = String(input.marketRegime ?? "");
  const regimeBoost =
    regime.includes("STRONG") || regime.includes("PUMP") ? 0.25 : regime.includes("WEAK") ? 0.1 : 0;
  return Number(Math.min(1, (longMom / 2.5 + shortMom / 0.8) / 2 + regimeBoost).toFixed(4));
}
