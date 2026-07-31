import type { SpotMarketRegimeLabel } from "@prisma/client";
import { env } from "@/lib/config";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import {
  MOMENTUM_ALLOWED_REGIMES,
  MOMENTUM_BLOCKED_REGIMES,
  type MomentumBreakoutEvaluation,
} from "@/src/server/trading-core-s2/trading-core-s2.types";
import { getCachedMarketRegime } from "@/src/server/trading-core-s2/trading-core-s2.cache";

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isMomentumStrategyAllowed(regime: SpotMarketRegimeLabel) {
  if (MOMENTUM_BLOCKED_REGIMES.includes(regime)) return false;
  return MOMENTUM_ALLOWED_REGIMES.includes(regime);
}

export async function evaluateMomentumBreakoutSymbol(input: {
  symbol: string;
  btcChange24h?: number;
  ethChange24h?: number;
  marketRegime?: SpotMarketRegimeLabel;
}): Promise<MomentumBreakoutEvaluation> {
  const regimeState = getCachedMarketRegime();
  const marketRegime = input.marketRegime ?? regimeState?.regime ?? "SIDEWAYS";
  const context = await buildMarketContext(input.symbol, { lite: true });
  const meta = context.metadata ?? {};

  const momentum5m = num(meta.shortMomentumPercent, context.momentumPercent);
  const momentum15m = num(meta.hourMomentumPercent, momentum5m * 3) / 3;
  const relativeVolume = num(meta.volumeRatio20, context.volumeSpikePercent / 100);
  const atrPercent = num(meta.atrPercent, context.volatilityPercent);
  const ema50 = num(meta.ema50);
  const ema200 = num(meta.ema200);
  const high60m = num(meta.high60m, context.lastPrice);
  const low60m = num(meta.low60m, context.lastPrice);
  const vwapProxy = ema50 > 0 ? ema50 : context.lastPrice;
  const higherHigh = context.lastPrice >= high60m * 0.998;
  const higherLow = low60m > 0 && context.lastPrice > low60m * 1.002;
  const btcChange = input.btcChange24h ?? regimeState?.btcTrend ?? 0;
  const ethChange = input.ethChange24h ?? regimeState?.ethTrend ?? 0;
  const relativeBtcStrength = context.change24h - btcChange;
  const relativeEthStrength = context.change24h - ethChange;

  const features = {
    momentum5m,
    momentum15m,
    relativeVolume,
    atrPercent,
    spreadPercent: context.spreadPercent,
    higherHigh,
    higherLow,
    vwapProxy,
    ema50,
    ema200,
    relativeBtcStrength,
    relativeEthStrength,
    volume24h: context.volume24h,
    change24h: context.change24h,
    marketRegime,
  };

  if (!isMomentumStrategyAllowed(marketRegime)) {
    return {
      symbol: input.symbol,
      verdict: "IGNORE",
      entryProbability: 0,
      expectedRr: 0,
      expectedHoldingMinutes: 0,
      expectedVolatility: atrPercent,
      confidence: 0,
      relativeVolume,
      momentum5m,
      momentum15m,
      relativeBtcStrength,
      relativeEthStrength,
      spreadPercent: context.spreadPercent,
      features: { ...features, blockedByRegime: true },
    };
  }

  let score = 0;
  if (relativeVolume >= 1.4) score += 18;
  else if (relativeVolume >= 1.1) score += 10;
  if (momentum5m >= 0.35) score += 16;
  if (momentum15m >= 0.25) score += 10;
  if (higherHigh && higherLow) score += 14;
  if (context.lastPrice >= vwapProxy) score += 8;
  if (relativeBtcStrength >= 0.8) score += 10;
  if (relativeEthStrength >= 0.5) score += 6;
  if (context.spreadPercent <= 0.12) score += 8;
  if (atrPercent >= 0.8 && atrPercent <= 4.5) score += 6;
  if (context.fakeSpikeScore >= 60) score -= 20;
  if (context.pumpRisk >= 70) score -= 12;

  const entryProbability = clamp(score);
  const stopDistance = Math.max(atrPercent * 1.2, 0.6);
  const targetDistance = Math.max(momentum5m * 2.5, stopDistance * 1.8);
  const expectedRr = stopDistance > 0 ? Number((targetDistance / stopDistance).toFixed(2)) : 0;
  const expectedHoldingMinutes = momentum5m >= 0.8 ? 45 : momentum5m >= 0.35 ? 90 : 180;
  const expectedVolatility = atrPercent;
  const confidence = clamp(entryProbability * 0.7 + (expectedRr >= 1.8 ? 20 : expectedRr >= 1.3 ? 10 : 0));

  let verdict: MomentumBreakoutEvaluation["verdict"] = "IGNORE";
  if (entryProbability >= 62 && expectedRr >= 1.5 && context.spreadPercent <= env.DISCOVERY_V2_MAX_SPREAD_PERCENT) {
    verdict = "BUY_CANDIDATE";
  } else if (entryProbability >= 48 && expectedRr >= 1.2) {
    verdict = "WAIT";
  }

  return {
    symbol: input.symbol,
    verdict,
    entryProbability: Number(entryProbability.toFixed(2)),
    expectedRr,
    expectedHoldingMinutes,
    expectedVolatility: Number(expectedVolatility.toFixed(4)),
    confidence: Number(confidence.toFixed(2)),
    relativeVolume: Number(relativeVolume.toFixed(4)),
    momentum5m: Number(momentum5m.toFixed(4)),
    momentum15m: Number(momentum15m.toFixed(4)),
    relativeBtcStrength: Number(relativeBtcStrength.toFixed(4)),
    relativeEthStrength: Number(relativeEthStrength.toFixed(4)),
    spreadPercent: Number(context.spreadPercent.toFixed(4)),
    features,
  };
}

export async function evaluateMomentumBreakoutBatch(symbols: string[], marketRegime?: SpotMarketRegimeLabel) {
  const results: MomentumBreakoutEvaluation[] = [];
  for (const symbol of symbols) {
    try {
      results.push(await evaluateMomentumBreakoutSymbol({ symbol, marketRegime }));
    } catch {
      // skip symbol failures
    }
  }
  return results;
}
