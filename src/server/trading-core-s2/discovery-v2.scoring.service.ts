import { env } from "@/lib/config";
import type { SpotMarketRegimeLabel } from "@prisma/client";
import type { DiscoveryScoreInput, DiscoveryV2ScoreBreakdown } from "@/src/server/trading-core-s2/trading-core-s2.types";

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function regimeCompatibilityScore(regime: SpotMarketRegimeLabel, marketRegime: SpotMarketRegimeLabel) {
  const bullish: SpotMarketRegimeLabel[] = ["STRONG_BULL", "WEAK_BULL", "BREAKOUT", "PUMP", "ACCUMULATION"];
  const bearish: SpotMarketRegimeLabel[] = ["STRONG_BEAR", "WEAK_BEAR", "DUMP", "DISTRIBUTION"];
  if (bullish.includes(regime) && bullish.includes(marketRegime)) return 85;
  if (bearish.includes(regime) && bearish.includes(marketRegime)) return 80;
  if (regime === marketRegime) return 95;
  if (marketRegime === "SIDEWAYS") return 45;
  if (marketRegime === "HIGH_VOLATILITY") return 55;
  if (marketRegime === "LOW_VOLATILITY") return 40;
  if (bullish.includes(regime) && bearish.includes(marketRegime)) return 15;
  return 50;
}

export function isHardRejectedSymbol(input: DiscoveryScoreInput) {
  const { context } = input;
  if (!context.tradable && context.rejectReasons.length > 0) {
    const hard = context.rejectReasons.some((reason) =>
      /spread|liquidity|dead|suspended|degraded|unavailable/i.test(reason),
    );
    if (hard) return { rejected: true, reason: context.rejectReasons.join("; ") };
  }
  if (context.volume24h < env.DISCOVERY_V2_MIN_VOLUME_24H) {
    return { rejected: true, reason: "Very low liquidity" };
  }
  if (context.spreadPercent > env.DISCOVERY_V2_MAX_SPREAD_PERCENT) {
    return { rejected: true, reason: "Extreme spread" };
  }
  if (context.lastPrice <= 0) {
    return { rejected: true, reason: "Dead market" };
  }
  const status = String(context.metadata?.symbolStatus ?? "TRADING").toUpperCase();
  if (status !== "TRADING") {
    return { rejected: true, reason: "Suspended or non-trading pair" };
  }
  return { rejected: false as const };
}

function inferSymbolRegime(context: DiscoveryScoreInput["context"]): SpotMarketRegimeLabel {
  const change = context.change24h;
  const momentum = context.momentumPercent;
  if (context.pumpIntensity >= 70) return "PUMP";
  if (context.fakeSpikeScore >= 65) return "FAKE_BREAKOUT";
  if (change <= -8) return "DUMP";
  if (change >= 4 && momentum >= 2) return "BREAKOUT";
  if (change >= 2) return "WEAK_BULL";
  if (change <= -2) return "WEAK_BEAR";
  if (context.volatilityPercent >= 7) return "HIGH_VOLATILITY";
  if (context.volatilityPercent <= 1.5) return "LOW_VOLATILITY";
  return "SIDEWAYS";
}

export function scoreDiscoverySymbol(input: DiscoveryScoreInput): DiscoveryV2ScoreBreakdown {
  const hard = isHardRejectedSymbol(input);
  const meta = input.context.metadata ?? {};
  const symbolRegime = inferSymbolRegime(input.context);
  const momentum5m = num(meta.shortMomentumPercent, input.context.momentumPercent);
  const momentum15m = num(meta.hourMomentumPercent, momentum5m) / 4;
  const relativeVolume = num(meta.volumeRatio20, input.context.volumeSpikePercent / 100);
  const atrPercent = num(meta.atrPercent);
  const trendStrength = num(meta.trendStrength, Math.abs(input.context.momentumPercent) * 8);
  const distanceFromHigh = num(meta.distanceFrom60mHighPercent, 100);
  const ema50 = num(meta.ema50);
  const ema200 = num(meta.ema200);
  const vwapProxy = ema50 > 0 ? ((input.context.lastPrice - ema50) / ema50) * 100 : 0;

  const momentumScore = clamp(Math.abs(momentum5m) * 18 + Math.abs(momentum15m) * 12 + input.context.buyPressure * 0.25);
  const volumeScore = clamp(relativeVolume * 35 + input.context.volumeSpikePercent * 0.35);
  const trendScore = clamp(trendStrength + (ema50 > ema200 ? 12 : ema50 < ema200 ? -8 : 0));
  const breakoutScore = clamp(
    (100 - Math.min(distanceFromHigh, 100)) * 0.55 +
      Math.max(0, momentum5m) * 8 +
      (input.context.volumeSpikePercent > 80 ? 15 : 0),
  );
  const liquidityScore = clamp(Math.log10(Math.max(input.context.volume24h, 1)) * 12);
  const spreadScore = clamp(100 - input.context.spreadPercent * 250);
  const volatilityScore = clamp(100 - Math.abs(input.context.volatilityPercent - 3) * 8);
  const relativeBtcStrength = clamp(50 + (input.context.change24h - input.btcChange24h) * 4);
  const relativeEthStrength = clamp(50 + (input.context.change24h - input.ethChange24h) * 4);
  const regimeCompatibility = regimeCompatibilityScore(symbolRegime, input.globalMarketRegime);

  const discoveryScore = hard.rejected
    ? 0
    : clamp(
        momentumScore * 0.22 +
          volumeScore * 0.18 +
          trendScore * 0.14 +
          breakoutScore * 0.14 +
          liquidityScore * 0.1 +
          spreadScore * 0.08 +
          volatilityScore * 0.04 +
          relativeBtcStrength * 0.05 +
          relativeEthStrength * 0.03 +
          regimeCompatibility * 0.02,
      );

  return {
    symbol: input.symbol,
    discoveryScore: Number(discoveryScore.toFixed(2)),
    momentumScore: Number(momentumScore.toFixed(2)),
    volumeScore: Number(volumeScore.toFixed(2)),
    relativeVolume: Number(relativeVolume.toFixed(4)),
    trendScore: Number(trendScore.toFixed(2)),
    breakoutScore: Number(breakoutScore.toFixed(2)),
    liquidityScore: Number(liquidityScore.toFixed(2)),
    spreadScore: Number(spreadScore.toFixed(2)),
    volatilityScore: Number(volatilityScore.toFixed(2)),
    relativeBtcStrength: Number(relativeBtcStrength.toFixed(2)),
    relativeEthStrength: Number(relativeEthStrength.toFixed(2)),
    regimeCompatibility: Number(regimeCompatibility.toFixed(2)),
    rejected: hard.rejected,
    rejectReason: hard.rejected ? hard.reason : undefined,
    metadata: {
      momentum5m,
      momentum15m,
      atrPercent,
      vwapProxy,
      change24h: input.context.change24h,
      spreadPercent: input.context.spreadPercent,
      volume24h: input.context.volume24h,
    },
  };
}

export function buildDiscoveryReport(rows: DiscoveryV2ScoreBreakdown[]): import("@/src/server/trading-core-s2/trading-core-s2.types").DiscoveryV2Report {
  const eligible = rows.filter((row) => !row.rejected);
  const byChange = [...eligible].sort(
    (a, b) => num(b.metadata?.change24h) - num(a.metadata?.change24h),
  );
  const byBreakout = [...eligible].sort((a, b) => b.breakoutScore - a.breakoutScore);
  const byMomentum = [...eligible].sort((a, b) => b.momentumScore - a.momentumScore);
  const byVolume = [...eligible].sort((a, b) => b.volumeScore - a.volumeScore);
  const byRelStrength = [...eligible].sort((a, b) => b.relativeBtcStrength - a.relativeBtcStrength);
  const take = (list: DiscoveryV2ScoreBreakdown[], n = 10) => list.slice(0, n).map((row) => row.symbol);
  return {
    topGainers: take(byChange),
    topBreakoutCandidates: take(byBreakout),
    topMomentum: take(byMomentum),
    topVolumeExpansion: take(byVolume),
    topRelativeStrength: take(byRelStrength),
  };
}

export function assignReportCategories(topRows: DiscoveryV2ScoreBreakdown[], report: import("@/src/server/trading-core-s2/trading-core-s2.types").DiscoveryV2Report) {
  return topRows.map((row) => {
    let reportCategory = "TOP_OPPORTUNITY";
    if (report.topBreakoutCandidates.includes(row.symbol)) reportCategory = "TOP_BREAKOUT";
    else if (report.topMomentum.includes(row.symbol)) reportCategory = "TOP_MOMENTUM";
    else if (report.topVolumeExpansion.includes(row.symbol)) reportCategory = "TOP_VOLUME";
    else if (report.topRelativeStrength.includes(row.symbol)) reportCategory = "TOP_RELATIVE_STRENGTH";
    else if (report.topGainers.includes(row.symbol)) reportCategory = "TOP_GAINER";
    return { ...row, metadata: { ...(row.metadata ?? {}), reportCategory } };
  });
}
