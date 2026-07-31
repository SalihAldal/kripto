import type { KlineItem } from "@/src/types/exchange";
import type { MarketContext } from "@/src/types/scanner";

function avg(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]) {
  if (values.length < 2) return 0;
  const mean = avg(values);
  return Math.sqrt(avg(values.map((value) => (value - mean) ** 2)));
}

function returnPercent(closes: number[], lookback: number) {
  const latest = closes.at(-1) ?? 0;
  const past = closes.at(-1 - lookback) ?? closes[0] ?? latest;
  if (past <= 0) return 0;
  return ((latest - past) / past) * 100;
}

function resolveRegime(input: { volatilityPercent: number; change24h: number; shortMomentum: number; chopScore: number }) {
  if (input.volatilityPercent >= 3.2 || Math.abs(input.change24h) >= 8) return "HIGH_VOLATILITY_CHAOS";
  if (input.volatilityPercent <= 0.45 && Math.abs(input.shortMomentum) <= 0.04) return "LOW_VOLATILITY_CALM";
  if (input.chopScore >= 0.62) return "RANGE_SIDEWAYS";
  if (input.shortMomentum >= 0.08 && input.change24h >= 1.5) return "TREND_UP";
  if (input.shortMomentum <= -0.08 && input.change24h <= -1.5) return "TREND_DOWN";
  return "RANGE_SIDEWAYS";
}

function ema(values: number[], period: number) {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let prev = values[0];
  for (let i = 1; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

function rsi(values: number[], period = 14) {
  if (values.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += Math.abs(diff);
  }
  const avgGain = gain / period;
  const avgLoss = loss / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function buildMarketContextFromKlines(input: {
  symbol: string;
  klines: KlineItem[];
  idx: number;
}): MarketContext | null {
  const { symbol, klines, idx } = input;
  if (idx < 30 || idx >= klines.length) return null;

  const window = klines.slice(Math.max(0, idx - 120), idx + 1);
  const closes = window.map((row) => row.close);
  const volumes = window.map((row) => row.volume);
  const price = closes.at(-1) ?? 0;
  if (price <= 0) return null;

  const shortMomentum = returnPercent(closes, 6);
  const hourMomentum = returnPercent(closes, Math.min(60, closes.length - 1));
  const midMomentum = returnPercent(closes, 24);
  const change24h = returnPercent(closes, Math.min(240, closes.length - 1));
  const volatilityPercent = price > 0 ? (std(closes.slice(-30)) / price) * 100 : 0;
  const recentVol = avg(volumes.slice(-6));
  const baseVol = avg(volumes.slice(-30)) || 1;
  const volumeSpikePercent = baseVol > 0 ? ((recentVol - baseVol) / baseVol) * 100 : 0;
  const spreadPercent = Math.max(0.04, Math.min(0.22, 0.05 + volatilityPercent * 0.018));
  const shortFlowImbalance = Math.max(-1, Math.min(1, shortMomentum / 0.35 + midMomentum / 1.2));
  const tradeVelocity = Math.max(0.05, Math.min(3.5, recentVol / baseVol));
  const directionChanges = closes.slice(-20).reduce((count, close, index, arr) => {
    if (index === 0) return count;
    const prev = arr[index - 1] ?? close;
    const prevPrev = arr[index - 2] ?? prev;
    const prevDir = prev - prevPrev;
    const curDir = close - prev;
    return prevDir * curDir < 0 ? count + 1 : count;
  }, 0);
  const chopScore = directionChanges / 19;
  const marketRegime = resolveRegime({ volatilityPercent, change24h, shortMomentum, chopScore });
  const pumpIntensity = Math.max(0, Math.min(100, change24h * 4 + volumeSpikePercent * 0.35 + Math.max(0, shortMomentum) * 18));
  const pumpRisk = Math.max(0, Math.min(100, volatilityPercent * 14 + Math.max(0, change24h - 12) * 2.5));
  const fakeSpikeScore = volumeSpikePercent > 120 && Math.abs(shortMomentum) < 0.05 ? 2.8 : volumeSpikePercent > 80 && Math.abs(shortMomentum) < 0.03 ? 1.8 : 0.4;
  const topGainerPump =
    change24h >= 4 &&
    shortMomentum >= 0.12 &&
    volumeSpikePercent >= 15 &&
    pumpIntensity >= 35;
  const ema50 = closes.length >= 50 ? ema(closes, 50) : 0;
  const ema200 = closes.length >= 50 ? ema(closes, Math.min(200, closes.length)) : 0;
  const dump15mPercent = returnPercent(closes, Math.min(15, closes.length - 1));
  const redCandleCount5 = window.slice(-5).filter((row) => row.close < row.open).length;
  const avgVol20 =
    volumes.length >= 21
      ? avg(volumes.slice(-21, -1))
      : volumes.length > 1
        ? avg(volumes.slice(0, -1))
        : 0;
  const volumeRatio20 = avgVol20 > 0 ? (volumes.at(-1) ?? 0) / avgVol20 : 0;
  const atrPercent = price > 0 ? (std(closes.slice(-14)) / price) * 100 : volatilityPercent;

  const high60m = window.length > 0 ? Math.max(...window.map((row) => row.high)) : price;
  const low60m = window.length > 0 ? Math.min(...window.map((row) => row.low)) : price;
  const distanceFrom60mHighPercent =
    high60m > 0 ? Number((((high60m - price) / high60m) * 100).toFixed(4)) : 0;
  const extensionFrom60mLowPercent =
    low60m > 0 ? Number((((price - low60m) / low60m) * 100).toFixed(4)) : 0;

  return {
    symbol: symbol.toUpperCase(),
    lastPrice: price,
    change24h: Number(change24h.toFixed(4)),
    volume24h: Number((avg(volumes.slice(-60)) * price * 60).toFixed(2)),
    volumeSpikePercent: Number(volumeSpikePercent.toFixed(4)),
    spreadPercent: Number(spreadPercent.toFixed(4)),
    volatilityPercent: Number(volatilityPercent.toFixed(4)),
    momentumPercent: Number(midMomentum.toFixed(4)),
    orderBookImbalance: Number((shortFlowImbalance * 0.35).toFixed(4)),
    buyPressure: Number((0.5 + shortFlowImbalance * 0.25).toFixed(4)),
    shortCandleSignal: shortMomentum >= 0 ? 2 : -2,
    fakeSpikeScore: Number(fakeSpikeScore.toFixed(4)),
    pumpIntensity: Number(pumpIntensity.toFixed(4)),
    pumpRisk: Number(pumpRisk.toFixed(4)),
    tradable: true,
    rejectReasons: [],
    metadata: {
      shortMomentumPercent: Number(shortMomentum.toFixed(4)),
      hourMomentumPercent: Number(hourMomentum.toFixed(4)),
      shortFlowImbalance: Number(shortFlowImbalance.toFixed(4)),
      tradeVelocity: Number(tradeVelocity.toFixed(4)),
      marketRegime,
      marketRegimeStrategy: marketRegime === "RANGE_SIDEWAYS" ? "RANGE_MEAN_REVERSION" : "MOMENTUM_CONTINUATION",
      mtfAlignmentScore: Math.max(0, Math.min(100, 50 + midMomentum * 8 - chopScore * 25)),
      regimeTransitionProbability: Math.max(0, Math.min(100, chopScore * 70 + volatilityPercent * 8)),
      regimeChaosProbability: Math.max(0, Math.min(100, volatilityPercent * 16 + Math.abs(change24h) * 2)),
      regimeLifecyclePhase: chopScore >= 0.6 ? "CHOP" : marketRegime.includes("TREND") ? "EXPANSION" : "ACCUMULATION",
      regimeChopWarning: chopScore >= 0.58,
      regimeUnstableBreakoutCondition: volatilityPercent >= 2.4 && chopScore >= 0.45,
      topGainerDiscovery: topGainerPump,
      topGainerChange24h: change24h,
      topGainerPriorityScore: topGainerPump ? Math.min(100, 55 + change24h * 2 + shortMomentum * 20) : 0,
      pumpEarlyConfirmed: topGainerPump && shortMomentum >= 0.2,
      pumpContinuationMode: topGainerPump && shortMomentum >= 0.15,
      pumpIntradaySpike: topGainerPump && volumeSpikePercent >= 40,
      ema50: Number(ema50.toFixed(8)),
      ema200: Number(ema200.toFixed(8)),
      rsi14: Number(rsi(closes, 14).toFixed(2)),
      dump15mPercent: Number(dump15mPercent.toFixed(4)),
      redCandleCount5,
      volumeRatio20: Number(volumeRatio20.toFixed(4)),
      atrPercent: Number(atrPercent.toFixed(4)),
      atrLimitPercent: 3.5,
      high60m: Number(high60m.toFixed(8)),
      low60m: Number(low60m.toFixed(8)),
      distanceFrom60mHighPercent,
      extensionFrom60mLowPercent,
    },
  };
}
