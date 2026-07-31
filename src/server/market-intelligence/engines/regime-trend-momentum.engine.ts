import type { MarketIntelRegime } from "@prisma/client";
import type { KlineItem } from "@/src/types/exchange";

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function ema(values: number[], period: number) {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let prev = values[0]!;
  for (let i = 1; i < values.length; i += 1) prev = values[i]! * k + prev * (1 - k);
  return prev;
}

function slopePct(values: number[]) {
  if (values.length < 2) return 0;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  if (first <= 0) return 0;
  return ((last - first) / first) * 100;
}

function correlation(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const xs = a.slice(-n);
  const ys = b.slice(-n);
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const vx = xs[i]! - mx;
    const vy = ys[i]! - my;
    num += vx * vy;
    dx += vx * vx;
    dy += vy * vy;
  }
  if (dx === 0 || dy === 0) return null;
  return Number((num / Math.sqrt(dx * dy)).toFixed(4));
}

export function classifyMarketRegime(input: {
  trendStrength: number;
  momentumPct: number;
  volatilityPct: number;
  spreadPct: number;
  volumeSpike: number;
  pumpIntensity: number;
  fakeSpikeScore: number;
  newsImpact: number;
  fundingRate?: number | null;
  longShortRatio?: number | null;
  orderBookImbalance: number;
}): MarketIntelRegime {
  if (input.newsImpact >= 70) return "NEWS_RALLY";
  if (input.pumpIntensity >= 75 && input.momentumPct > 0.8) return "ROCKET_PUMP";
  if (input.momentumPct <= -1.2 && input.volatilityPct >= 2) return "PANIC_DUMP";
  if (input.fakeSpikeScore >= 2 && input.momentumPct > 0.5) return "FAKE_BREAKOUT";
  if (input.momentumPct > 0.45 && input.volumeSpike >= 40) return "BREAKOUT";
  if (input.spreadPct > 0.15 && input.orderBookImbalance < -0.2) return "LIQUIDITY_TRAP";
  if ((input.longShortRatio ?? 1) > 1.8 && input.momentumPct > 0.3) return "SHORT_SQUEEZE";
  if ((input.longShortRatio ?? 1) < 0.6 && input.momentumPct < -0.3) return "LONG_SQUEEZE";
  if (input.fakeSpikeScore >= 1.5 && Math.abs(input.orderBookImbalance) > 0.35) return "MANIPULATION";
  if (input.volatilityPct >= 2.5) return "HIGH_VOLATILITY";
  if (input.volatilityPct <= 0.35) return "LOW_VOLATILITY";
  if (input.trendStrength > 0.25 && input.momentumPct > 0) return "BULL_TREND";
  if (input.trendStrength < -0.25 && input.momentumPct < 0) return "BEAR_TREND";
  if (input.volumeSpike >= 25 && Math.abs(input.momentumPct) < 0.2) return "ACCUMULATION";
  if (input.volumeSpike >= 25 && input.momentumPct < -0.1) return "DISTRIBUTION";
  return "RANGE";
}

export function computeTrendIntel(klines: KlineItem[]): {
  primaryTrend: string;
  secondaryTrend: string;
  microTrend: string;
  trendStrength: number;
  trendAge: number;
  trendConfidence: number;
  trendExhaustion: number;
  trendAcceleration: number;
} {
  const closes = klines.map((k) => k.close);
  const micro = slopePct(closes.slice(-5));
  const secondary = slopePct(closes.slice(-15));
  const primary = slopePct(closes.slice(-40));
  const dir = (v: number) => (v > 0.08 ? "UP" : v < -0.08 ? "DOWN" : "FLAT");
  const emaFast = ema(closes, 8);
  const emaSlow = ema(closes, 21);
  const strength = closes.at(-1)! > 0 ? ((emaFast - emaSlow) / closes.at(-1)!) * 100 : 0;
  let age = 0;
  const sign = Math.sign(primary);
  for (let i = closes.length - 2; i >= 0; i -= 1) {
    if (Math.sign(closes[i + 1]! - closes[i]!) !== sign) break;
    age += 1;
  }
  const recent = slopePct(closes.slice(-8));
  const prior = slopePct(closes.slice(-16, -8));
  const acceleration = recent - prior;
  const exhaustion = clamp(Math.abs(primary) * 8 + Math.max(0, Math.abs(micro) - Math.abs(secondary)) * 5, 0, 100);
  return {
    primaryTrend: dir(primary),
    secondaryTrend: dir(secondary),
    microTrend: dir(micro),
    trendStrength: Number(strength.toFixed(4)),
    trendAge: age,
    trendConfidence: clamp(50 + Math.abs(strength) * 4, 0, 100),
    trendExhaustion: Number(exhaustion.toFixed(2)),
    trendAcceleration: Number(acceleration.toFixed(4)),
  };
}

export function computeMomentumIntel(klines: KlineItem[], contextMomentum: number): {
  momentumScore: number;
  acceleration: number;
  velocity: number;
  volumeAcceleration: number;
  priceAcceleration: number;
  breakoutProbability: number;
  continuationProbability: number;
  exhaustionProbability: number;
} {
  const closes = klines.map((k) => k.close);
  const volumes = klines.map((k) => k.volume);
  const velocity = slopePct(closes.slice(-5));
  const priorVelocity = slopePct(closes.slice(-10, -5));
  const acceleration = velocity - priorVelocity;
  const volRecent = volumes.slice(-5).reduce((s, v) => s + v, 0) / Math.max(volumes.slice(-5).length, 1);
  const volPrior = volumes.slice(-10, -5).reduce((s, v) => s + v, 0) / Math.max(volumes.slice(-5).length, 1);
  const volumeAcceleration = volPrior > 0 ? ((volRecent - volPrior) / volPrior) * 100 : 0;
  const priceAcceleration = acceleration;
  const momentumScore = clamp(50 + contextMomentum * 2 + velocity * 5, 0, 100);
  const breakoutProbability = clamp(Math.max(0, velocity) * 8 + Math.max(0, volumeAcceleration) * 0.2, 0, 100);
  const continuationProbability = clamp(momentumScore * 0.7 + Math.max(0, acceleration) * 10, 0, 100);
  const exhaustionProbability = clamp(Math.abs(velocity) * 6 + Math.max(0, -acceleration) * 12, 0, 100);
  return {
    momentumScore: Number(momentumScore.toFixed(2)),
    acceleration: Number(acceleration.toFixed(4)),
    velocity: Number(velocity.toFixed(4)),
    volumeAcceleration: Number(volumeAcceleration.toFixed(4)),
    priceAcceleration: Number(priceAcceleration.toFixed(4)),
    breakoutProbability: Number(breakoutProbability.toFixed(2)),
    continuationProbability: Number(continuationProbability.toFixed(2)),
    exhaustionProbability: Number(exhaustionProbability.toFixed(2)),
  };
}

export function computeCorrelations(input: {
  assetCloses: number[];
  btcCloses?: number[];
  ethCloses?: number[];
}) {
  const assetReturns = input.assetCloses.slice(1).map((v, i) =>
    input.assetCloses[i]! > 0 ? (v - input.assetCloses[i]!) / input.assetCloses[i]! : 0,
  );
  const btcReturns = input.btcCloses?.slice(1).map((v, i) =>
    input.btcCloses![i]! > 0 ? (v - input.btcCloses![i]!) / input.btcCloses![i]! : 0,
  );
  const ethReturns = input.ethCloses?.slice(1).map((v, i) =>
    input.ethCloses![i]! > 0 ? (v - input.ethCloses![i]!) / input.ethCloses![i]! : 0,
  );
  return {
    correlationBtc: btcReturns ? correlation(assetReturns, btcReturns) : null,
    correlationEth: ethReturns ? correlation(assetReturns, ethReturns) : null,
    relativeStrength:
      btcReturns && assetReturns.length > 0
        ? Number(((assetReturns.slice(-20).reduce((s, v) => s + v, 0) / Math.max(assetReturns.slice(-20).length, 1) -
            btcReturns.slice(-20).reduce((s, v) => s + v, 0) / Math.max(btcReturns.slice(-20).length, 1)) *
            100).toFixed(4))
        : null,
  };
}

export { clamp, slopePct, correlation, ema };
