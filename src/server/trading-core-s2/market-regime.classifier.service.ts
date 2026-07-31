import { env } from "@/lib/config";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import type { MarketContext } from "@/src/types/scanner";
import type { SpotMarketRegimeLabel } from "@prisma/client";
import type { MarketRegimeClassification } from "@/src/server/trading-core-s2/trading-core-s2.types";

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function fetchAnchorMarketContexts() {
  const [btc, eth] = await Promise.all([
    buildMarketContext("BTCUSDT", { lite: true }).catch(() => null),
    buildMarketContext("ETHUSDT", { lite: true }).catch(() => null),
  ]);
  return { btc, eth };
}

export function computeMarketBreadth(samples: MarketContext[]) {
  if (samples.length === 0) return 50;
  const advancing = samples.filter((row) => row.change24h > 0).length;
  return clamp((advancing / samples.length) * 100);
}

export function computeUsdtPairStrength(samples: MarketContext[]) {
  if (samples.length === 0) return 50;
  const avgChange = samples.reduce((sum, row) => sum + row.change24h, 0) / samples.length;
  return clamp(50 + avgChange * 4);
}

export function computeHistoricalSimilarity(regime: SpotMarketRegimeLabel, features: Record<string, number>) {
  const anchors: Partial<Record<SpotMarketRegimeLabel, Record<string, number>>> = {
    STRONG_BULL: { btcTrend: 4, marketMomentum: 3, marketBreadth: 65, volumeExpansion: 40 },
    WEAK_BULL: { btcTrend: 1.5, marketMomentum: 1, marketBreadth: 55, volumeExpansion: 20 },
    STRONG_BEAR: { btcTrend: -4, marketMomentum: -3, marketBreadth: 35, volumeExpansion: 25 },
    WEAK_BEAR: { btcTrend: -1.5, marketMomentum: -1, marketBreadth: 45, volumeExpansion: 15 },
    SIDEWAYS: { btcTrend: 0, marketMomentum: 0, marketBreadth: 50, volumeExpansion: 10 },
    PUMP: { btcTrend: 2, marketMomentum: 5, volumeExpansion: 80, realizedVolatility: 6 },
    DUMP: { btcTrend: -2, marketMomentum: -5, volumeExpansion: 70, realizedVolatility: 7 },
    BREAKOUT: { btcTrend: 2, marketMomentum: 3, volumeExpansion: 60, marketBreadth: 58 },
    FAKE_BREAKOUT: { btcTrend: 1, marketMomentum: 2, volumeExpansion: 55, realizedVolatility: 8 },
    ACCUMULATION: { btcTrend: 0.5, marketMomentum: 0.5, volumeExpansion: 45, marketBreadth: 52 },
    DISTRIBUTION: { btcTrend: -0.5, marketMomentum: -0.5, volumeExpansion: 45, marketBreadth: 48 },
    HIGH_VOLATILITY: { realizedVolatility: 8, atrPercent: 4 },
    LOW_VOLATILITY: { realizedVolatility: 1.2, atrPercent: 0.8 },
  };
  const anchor = anchors[regime];
  if (!anchor) return 50;
  const keys = Object.keys(anchor);
  let distance = 0;
  for (const k of keys) {
    const expected = anchor[k] ?? 0;
    const actual = features[k] ?? 0;
    distance += Math.abs(expected - actual);
  }
  return clamp(100 - distance * 3);
}

export function classifyMarketRegime(input: {
  btc?: MarketContext | null;
  eth?: MarketContext | null;
  breadthSamples?: MarketContext[];
}): MarketRegimeClassification {
  const btc = input.btc;
  const eth = input.eth;
  const samples = input.breadthSamples ?? [];

  const btcTrend = btc?.change24h ?? 0;
  const ethTrend = eth?.change24h ?? 0;
  const btcMomentum = btc?.momentumPercent ?? 0;
  const ethMomentum = eth?.momentumPercent ?? 0;
  const btcVol = btc?.volatilityPercent ?? 0;
  const ethVol = eth?.volatilityPercent ?? 0;
  const btcMeta = btc?.metadata ?? {};
  const ethMeta = eth?.metadata ?? {};

  const btcAtr = num(btcMeta.atrPercent);
  const ethAtr = num(ethMeta.atrPercent);
  const atrPercent = (btcAtr + ethAtr) / 2;
  const realizedVolatility = (btcVol + ethVol + num(btcMeta.priceDispersionPercent) + num(ethMeta.priceDispersionPercent)) / 4;
  const volumeExpansion = ((btc?.volumeSpikePercent ?? 0) + (eth?.volumeSpikePercent ?? 0)) / 2;
  const marketBreadth = computeMarketBreadth(samples);
  const usdtPairStrength = computeUsdtPairStrength(samples);
  const relativeStrength = ethTrend - btcTrend;
  const marketMomentum = (btcMomentum + ethMomentum) / 2;
  const btcDominance = clamp(50 + (btcTrend - ethTrend) * 2);

  const fakeSpike = Math.max(btc?.fakeSpikeScore ?? 0, ...samples.slice(0, 20).map((s) => s.fakeSpikeScore ?? 0));
  const pumpIntensity = Math.max(btc?.pumpIntensity ?? 0, ...samples.slice(0, 20).map((s) => s.pumpIntensity ?? 0));

  let regime: SpotMarketRegimeLabel = "SIDEWAYS";
  if (fakeSpike >= 68 && volumeExpansion >= 50) regime = "FAKE_BREAKOUT";
  else if (pumpIntensity >= 70 || (volumeExpansion >= 80 && marketMomentum >= 4)) regime = "PUMP";
  else if (marketMomentum <= -4 && btcTrend <= -6) regime = "DUMP";
  else if (realizedVolatility >= 7 && Math.abs(btcTrend) <= 2) regime = "HIGH_VOLATILITY";
  else if (realizedVolatility <= 1.5 && Math.abs(btcTrend) <= 1.5) regime = "LOW_VOLATILITY";
  else if (volumeExpansion >= 55 && marketMomentum >= 2.5 && marketBreadth >= 55) regime = "BREAKOUT";
  else if (volumeExpansion >= 45 && marketMomentum > 0 && marketBreadth >= 52) regime = "ACCUMULATION";
  else if (volumeExpansion >= 45 && marketMomentum < 0 && marketBreadth <= 48) regime = "DISTRIBUTION";
  else if (btcTrend >= 4 && marketMomentum >= 2) regime = "STRONG_BULL";
  else if (btcTrend >= 1.5 && marketMomentum >= 0.5) regime = "WEAK_BULL";
  else if (btcTrend <= -4 && marketMomentum <= -2) regime = "STRONG_BEAR";
  else if (btcTrend <= -1.5 && marketMomentum <= -0.5) regime = "WEAK_BEAR";
  else regime = "SIDEWAYS";

  const supportingFeatures: Record<string, number | string | boolean> = {
    btcTrend,
    ethTrend,
    btcMomentum,
    ethMomentum,
    btcDominance,
    volumeExpansion,
    atrPercent,
    realizedVolatility,
    marketBreadth,
    usdtPairStrength,
    relativeStrength,
    marketMomentum,
    fakeSpike,
    pumpIntensity,
  };

  const historicalSimilarity = computeHistoricalSimilarity(regime, supportingFeatures as Record<string, number>);
  const regimeStrength = clamp(
    Math.abs(btcTrend) * 8 +
      Math.abs(marketMomentum) * 10 +
      volumeExpansion * 0.25 +
      Math.abs(marketBreadth - 50) * 0.6,
  );
  const confidence = clamp(
    regimeStrength * 0.45 +
      historicalSimilarity * 0.35 +
      (samples.length > 20 ? 20 : samples.length) +
      (btc && eth ? 10 : 0),
  );

  const expectedDurationMinutes =
    regime === "PUMP" || regime === "DUMP"
      ? 45
      : regime === "BREAKOUT" || regime === "FAKE_BREAKOUT"
        ? 90
        : regime === "STRONG_BULL" || regime === "STRONG_BEAR"
          ? 240
          : 120;

  return {
    regime,
    confidence: Number(confidence.toFixed(2)),
    regimeStrength: Number(regimeStrength.toFixed(2)),
    expectedDurationMinutes,
    supportingFeatures,
    historicalSimilarity: Number(historicalSimilarity.toFixed(2)),
    btcTrend: Number(btcTrend.toFixed(4)),
    ethTrend: Number(ethTrend.toFixed(4)),
    btcDominance: Number(btcDominance.toFixed(2)),
    volumeExpansion: Number(volumeExpansion.toFixed(2)),
    atrPercent: Number(atrPercent.toFixed(4)),
    realizedVolatility: Number(realizedVolatility.toFixed(4)),
    marketBreadth: Number(marketBreadth.toFixed(2)),
    usdtPairStrength: Number(usdtPairStrength.toFixed(2)),
    relativeStrength: Number(relativeStrength.toFixed(4)),
    marketMomentum: Number(marketMomentum.toFixed(4)),
    classifiedAt: new Date().toISOString(),
  };
}

export async function refreshMarketRegimeClassification(sampleSymbols?: string[]) {
  const anchors = await fetchAnchorMarketContexts();
  const samples: MarketContext[] = [];
  const symbols = sampleSymbols?.slice(0, 40) ?? [];
  for (const symbol of symbols) {
    try {
      const context = await buildMarketContext(symbol, { lite: true });
      samples.push(context);
    } catch {
      // skip failed symbol
    }
  }
  return classifyMarketRegime({ btc: anchors.btc, eth: anchors.eth, breadthSamples: samples });
}
