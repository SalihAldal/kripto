import { env } from "@/lib/config";
import { getKlines } from "@/services/binance.service";
import type { MarketContext } from "@/src/types/scanner";

export type PaperEntryQualityResult = {
  ok: boolean;
  qualityScore: number;
  tier: "REJECT" | "ACCEPT" | "STRONG" | "PREMIUM";
  rejectBuckets: string[];
  reasons: string[];
  breakdown: {
    trendAligned: number;
    emaStructure: number;
    btcPositive: number;
    highVolume: number;
    rsiHealthy: number;
    momentumConfirmed: number;
  };
};

type BtcFilterSnapshot = {
  at: number;
  symbol: string;
  price: number;
  ema20: number;
  rsi14: number;
  bullish: boolean;
};

const BTC_CACHE_TTL_MS = 60_000;
let btcCache: BtcFilterSnapshot | null = null;

function clamp(min: number, value: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isStrongHourPumpContext(input: {
  change24h?: number;
  hourMomentum?: number;
  tapeMomentum?: number;
  shortFlow?: number;
}) {
  const change24h = num(input.change24h);
  const hourMomentum = num(input.hourMomentum);
  const tapeMomentum = num(input.tapeMomentum);
  const shortFlow = num(input.shortFlow);
  const tapeRequirement = change24h >= 15 ? 0.1 : 0.2;
  const flowRequirement = change24h >= 15 ? 0.1 : 0.22;
  return (
    (hourMomentum >= 2 && shortFlow >= flowRequirement && tapeMomentum >= tapeRequirement) ||
    (hourMomentum >= 1.6 &&
      tapeMomentum >= Math.max(0.28, tapeRequirement) &&
      shortFlow >= Math.max(0.2, flowRequirement)) ||
    (change24h >= 10 && hourMomentum >= 1.2 && shortFlow >= 0.14 && tapeMomentum >= 0.12)
  );
}

export function isFakeHourOnlyPump(input: {
  hourMomentum?: number;
  tapeMomentum?: number;
  shortFlow?: number;
  marketRegime?: string;
  pumpStage?: string;
}) {
  const hourMomentum = num(input.hourMomentum);
  const tapeMomentum = num(input.tapeMomentum);
  const shortFlow = num(input.shortFlow);
  const marketRegime = String(input.marketRegime ?? "");
  if (isStrongHourPumpContext({ hourMomentum, tapeMomentum, shortFlow })) return false;
  if (marketRegime === "LOW_VOLATILITY_CALM" && tapeMomentum < 0.08) return true;
  return (
    tapeMomentum < 0.08 &&
    hourMomentum >= 1 &&
    hourMomentum < 1.8 &&
    shortFlow >= 0.28 &&
    (marketRegime === "LOW_VOLATILITY_CALM" || input.pumpStage === "LATE")
  );
}

export async function getBtcMarketFilterSnapshot(): Promise<BtcFilterSnapshot | null> {
  if (btcCache && Date.now() - btcCache.at < BTC_CACHE_TTL_MS) {
    return btcCache;
  }
  const symbol = env.BINANCE_PLATFORM === "tr" ? "BTCTRY" : "BTCUSDT";
  try {
    const klines = await getKlines(symbol, "1m", 80);
    if (!klines.length) return btcCache;
    const closes = klines.map((row) => row.close);
    const price = closes[closes.length - 1] ?? 0;
    const ema20 = ema(closes, 20);
    const rsi14 = rsi(closes, 14);
    const bullish = price >= ema20 && rsi14 >= 45;
    btcCache = {
      at: Date.now(),
      symbol,
      price,
      ema20,
      rsi14,
      bullish,
    };
    return btcCache;
  } catch {
    return btcCache;
  }
}

export function evaluatePaperEntryQuality(input: {
  context: MarketContext;
  side?: "BUY" | "SELL";
  tapeMomentum?: number;
  hourMomentum?: number;
  shortFlow?: number;
  pumpStage?: string;
  compositeAvg?: number;
  btcSnapshot?: BtcFilterSnapshot | null;
  minScore?: number;
  pumpLane?: boolean;
  dataDegraded?: boolean;
  adaptiveMinScoreDelta?: number;
}): PaperEntryQualityResult {
  const side = input.side ?? "BUY";
  const context = input.context;
  const meta = context.metadata;
  const price = context.lastPrice;
  const ema50 = num(meta.ema50);
  const ema200 = num(meta.ema200);
  const dump15mPercent = num(meta.dump15mPercent);
  const redCandleCount5 = num(meta.redCandleCount5);
  const volumeRatio20 = num(meta.volumeRatio20, 1);
  const atrPercent = num(meta.atrPercent, context.volatilityPercent);
  const tapeMomentum = input.tapeMomentum ?? num(meta.shortMomentumPercent);
  const hourMomentum = input.hourMomentum ?? num(meta.hourMomentumPercent);
  const shortFlow = input.shortFlow ?? num(meta.shortFlowImbalance);
  const pumpStage = input.pumpStage ?? String(meta.pumpBreakoutStage ?? "");
  const rsi14 = num(meta.rsi14, 50);
  const change24h = num(meta.topGainerChange24h ?? context.change24h);
  const btc = input.btcSnapshot;
  const pumpLane = Boolean(input.pumpLane);
  const strongHourPump = isStrongHourPumpContext({ change24h, hourMomentum, tapeMomentum, shortFlow });
  const dataDegraded =
    Boolean(input.dataDegraded) ||
    (Math.abs(tapeMomentum) < 0.001 && Math.abs(shortFlow) < 0.01 && hourMomentum >= 0.5);
  const minScore = Math.max(
    35,
    (input.minScore ?? (pumpLane ? (strongHourPump ? 50 : 54) : strongHourPump ? 56 : 60)) +
      Number(input.adaptiveMinScoreDelta ?? 0),
  );

  const rejectBuckets: string[] = [];
  const reasons: string[] = [];

  const emaBullStructure = ema50 > 0 && ema200 > 0 && ema50 > ema200;
  const priceAboveEma50 = ema50 > 0 && price >= ema50;
  const trendDown = ema50 > 0 && ema200 > 0 && (ema50 < ema200 || price < ema50);

  if (side === "BUY") {
    if (dump15mPercent <= -3) {
      rejectBuckets.push("DUMP_TESPITI");
      reasons.push(`Dump tespiti: son 15dk ${dump15mPercent.toFixed(2)}%`);
    }
    if (redCandleCount5 >= 4 && !strongHourPump) {
      rejectBuckets.push("DUMP_TESPITI");
      reasons.push(`Sert satis: son 5 mumdan ${redCandleCount5} kirmizi`);
    }
    if (
      !dataDegraded &&
      isFakeHourOnlyPump({
        hourMomentum,
        tapeMomentum,
        shortFlow,
        marketRegime: String(meta.marketRegime ?? ""),
        pumpStage,
      })
    ) {
      rejectBuckets.push("MOMENTUM_TEYITSIZ");
      reasons.push(`Sahte hour-only pump (tape=${tapeMomentum.toFixed(3)}%, hour=${hourMomentum.toFixed(3)}%)`);
    }
    if (!pumpLane && !strongHourPump && !dataDegraded) {
      const momentumOverride = hourMomentum >= 1.2 || tapeMomentum >= 0.18;
      if (trendDown && ema50 > 0 && ema200 > 0) {
        if (!momentumOverride) {
          rejectBuckets.push("EMA_UYUMSUZ");
          reasons.push(`EMA trend uyumsuz (EMA50=${ema50.toFixed(4)}, EMA200=${ema200.toFixed(4)})`);
        }
      }
      if (volumeRatio20 > 0 && volumeRatio20 < 1.05 && !momentumOverride) {
        rejectBuckets.push("HACIM_YETERSIZ");
        reasons.push(`Hacim yetersiz (${volumeRatio20.toFixed(2)}x < 1.05x)`);
      }
      if (btc && !btc.bullish && !momentumOverride) {
        if (btc.price < btc.ema20) {
          rejectBuckets.push("BTC_TREND_NEGATIF");
          reasons.push(`BTC EMA20 altinda (${btc.symbol})`);
        } else if (btc.rsi14 < 42) {
          rejectBuckets.push("BTC_TREND_NEGATIF");
          reasons.push(`BTC RSI dusuk (${btc.rsi14.toFixed(1)} < 42)`);
        }
      }
    }
    const atrLimit = num(meta.atrLimitPercent, pumpLane ? 4.8 : 3.8);
    if (atrPercent > atrLimit && !strongHourPump) {
      rejectBuckets.push("VOLATILITE_YUKSEK");
      reasons.push(`ATR/volatilite limiti asildi (${atrPercent.toFixed(2)}% > ${atrLimit}%)`);
    }
  }

  const trendAligned =
    side === "BUY" && emaBullStructure && priceAboveEma50
      ? 25
      : side === "BUY" && (priceAboveEma50 || strongHourPump)
        ? 14
        : 0;
  const emaStructure = emaBullStructure ? 20 : ema50 > ema200 ? 10 : strongHourPump ? 8 : 0;
  const btcPositive = btc?.bullish ? 15 : btc && btc.price >= btc.ema20 ? 8 : pumpLane ? 6 : 0;
  const highVolume =
    volumeRatio20 >= 2 ? 15 : volumeRatio20 >= 1.5 ? 12 : volumeRatio20 >= 1.1 ? 8 : strongHourPump ? 6 : 0;
  const rsiHealthy = rsi14 >= 45 && rsi14 <= 72 ? 10 : rsi14 >= 38 && rsi14 <= 80 ? 6 : 0;
  const momentumConfirmedScore = (() => {
    if (strongHourPump) return 15;
    if (pumpStage === "EARLY" || pumpStage === "ACTIVE" || pumpStage === "BREAKOUT") return 14;
    if (tapeMomentum >= 0.35) return 15;
    if (tapeMomentum >= 0.2 && shortFlow >= 0.15) return 12;
    if (tapeMomentum >= 0.1 && hourMomentum >= 1.2) return 10;
    if (tapeMomentum >= 0.08 && shortFlow >= 0.12) return 8;
    return 0;
  })();

  const breakdown = {
    trendAligned,
    emaStructure,
    btcPositive,
    highVolume,
    rsiHealthy,
    momentumConfirmed: momentumConfirmedScore,
  };
  const qualityScore = clamp(
    0,
    trendAligned + emaStructure + btcPositive + highVolume + rsiHealthy + momentumConfirmedScore,
    100,
  );

  if (qualityScore < minScore && !strongHourPump && !dataDegraded) {
    rejectBuckets.push("KALITE_SKORU_DUSUK");
    reasons.push(`Kalite skoru dusuk (${qualityScore}/100 < ${minScore})`);
  } else if (qualityScore < minScore && dataDegraded && qualityScore < Math.max(28, minScore - 12)) {
    rejectBuckets.push("KALITE_SKORU_DUSUK");
    reasons.push(`Kalite skoru cok dusuk (${qualityScore}/100 < ${Math.max(28, minScore - 12)})`);
  }

  const uniqueBuckets = [...new Set(rejectBuckets)];
  const tier: PaperEntryQualityResult["tier"] =
    qualityScore >= 90 ? "PREMIUM" : qualityScore >= 80 ? "STRONG" : qualityScore >= minScore ? "ACCEPT" : "REJECT";

  return {
    ok: uniqueBuckets.length === 0,
    qualityScore,
    tier,
    rejectBuckets: uniqueBuckets,
    reasons,
    breakdown,
  };
}

export function formatPaperEntryQualityReason(result: PaperEntryQualityResult) {
  if (result.ok) {
    return `entry-quality-ok score=${result.qualityScore} tier=${result.tier}`;
  }
  return result.reasons.join(" | ");
}
