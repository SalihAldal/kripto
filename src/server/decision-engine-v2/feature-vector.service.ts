import { prisma } from "@/src/server/db/prisma";
import { getCachedDiscoveryScore, getCachedMarketRegime } from "@/src/server/trading-core-s2/trading-core-s2.cache";
import type {
  DecisionEngineV2FeatureVector,
  ExtractFeatureInput,
  DECISION_ENGINE_V2_FEATURE_NAMES,
} from "@/src/server/decision-engine-v2/decision-engine-v2.types";

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function regimeToScore(regime?: string | null) {
  if (!regime) return 50;
  const bullish = ["STRONG_BULL", "WEAK_BULL", "BREAKOUT", "PUMP", "ACCUMULATION"];
  const bearish = ["STRONG_BEAR", "WEAK_BEAR", "DUMP", "DISTRIBUTION"];
  const upper = regime.toUpperCase();
  if (bullish.some((r) => upper.includes(r))) return 75;
  if (bearish.some((r) => upper.includes(r))) return 25;
  if (upper.includes("SIDEWAYS")) return 50;
  if (upper.includes("HIGH_VOLATILITY")) return 40;
  if (upper.includes("LOW_VOLATILITY")) return 55;
  return 50;
}

export async function fetchHistoricalCoinBehaviour(symbol: string) {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const replays = await prisma.decisionReplay.findMany({
    where: { symbol: symbol.toUpperCase(), status: "COMPLETED", createdAt: { gte: since } },
    include: { evaluation: { select: { peakProfitPct: true, mfePct: true, verdict: true } } },
    orderBy: { createdAt: "desc" },
    take: 40,
  });
  if (replays.length === 0) return 50;
  const returns = replays
    .map((r) => num(r.evaluation?.peakProfitPct ?? r.evaluation?.mfePct))
    .filter((v) => v !== 0);
  if (returns.length === 0) return 50;
  const wins = returns.filter((r) => r > 0).length;
  const avg = returns.reduce((s, v) => s + v, 0) / returns.length;
  return Math.max(0, Math.min(100, 50 + (wins / returns.length) * 25 + avg * 2));
}

export function buildFeatureVectorFromSnapshot(input: ExtractFeatureInput): DecisionEngineV2FeatureVector {
  const snap = input.featureSnapshot ?? {};
  const momentum = snap.momentum as Record<string, unknown> | null | undefined;
  const volume = snap.volume as Record<string, unknown> | null | undefined;
  const spread = snap.spread as Record<string, unknown> | null | undefined;
  const volatility = snap.volatility as Record<string, unknown> | null | undefined;
  const atr = snap.atr as Record<string, unknown> | null | undefined;
  const vwap = snap.vwap as Record<string, unknown> | null | undefined;
  const rsi = snap.rsi as Record<string, unknown> | null | undefined;
  const ema = snap.ema as Record<string, unknown> | null | undefined;
  const orderBook = snap.orderBook as Record<string, unknown> | null | undefined;
  const liquidity = snap.liquidity as Record<string, unknown> | null | undefined;
  const regime = snap.regime as Record<string, unknown> | null | undefined;
  const raw = snap.raw as Record<string, unknown> | null | undefined;
  const meta = input.metadata ?? {};

  const lastPrice = num(raw?.lastPrice, 1);
  const vwapValue = num(vwap?.value ?? vwap?.vwap, lastPrice);
  const ema50 = num(ema?.ema50 ?? ema?.fast, lastPrice);
  const regimeLabel =
    String(input.marketRegime ?? regime?.marketRegime ?? getCachedMarketRegime()?.regime ?? "SIDEWAYS");
  const discoveryScore =
    input.discoveryScore ??
    num(meta.discoveryV2Score ?? meta.discoveryOpportunityScore ?? getCachedDiscoveryScore(input.symbol));

  return {
    momentum: num(momentum?.shortMomentumPercent ?? input.momentumScore, 0),
    relativeVolume: num(momentum?.volumeSpikeRatio ?? volume?.buySellRatio, 1),
    atr: num(atr?.percent ?? volatility?.atr, 0),
    vwapDistance: lastPrice > 0 ? ((lastPrice - vwapValue) / lastPrice) * 100 : 0,
    rsi: num(rsi?.value ?? rsi?.rsi, 50),
    emaDistance: lastPrice > 0 ? ((lastPrice - ema50) / lastPrice) * 100 : 0,
    btcStrength: num(meta.relativeBtcStrength ?? meta.btcStrength, 0),
    ethStrength: num(meta.relativeEthStrength ?? meta.ethStrength, 0),
    spread: num(spread?.spreadPercent, 0),
    liquidity: num(liquidity?.score ?? liquidity?.liquidityScore, num(volume?.volume24h, 0) / 1_000_000),
    orderbookImbalance: num(orderBook?.imbalance, 0),
    volatility: num(volatility?.volatilityPercent, 0),
    discoveryScore,
    marketRegimeScore: regimeToScore(regimeLabel),
    historicalCoinBehaviour: num(meta.historicalCoinBehaviour, 50),
    confidencePrior: num(input.scannerScore, 50),
  };
}

export async function buildFeatureVector(input: ExtractFeatureInput): Promise<DecisionEngineV2FeatureVector> {
  const base = buildFeatureVectorFromSnapshot(input);
  if (base.historicalCoinBehaviour === 50) {
    base.historicalCoinBehaviour = await fetchHistoricalCoinBehaviour(input.symbol);
  }
  return base;
}

export function featureVectorToArray(
  vector: DecisionEngineV2FeatureVector,
  featureNames: readonly (typeof DECISION_ENGINE_V2_FEATURE_NAMES)[number][],
) {
  return featureNames.map((name) => vector[name]);
}

export function labelFromDecision(decision: string): "BUY" | "WAIT" | "NO_TRADE" {
  const upper = decision.toUpperCase();
  if (upper.includes("BUY") || upper === "STRONG_BUY") return "BUY";
  if (upper.includes("WAIT") || upper.includes("WATCH")) return "WAIT";
  return "NO_TRADE";
}

export function labelFromReturn(returnPct: number): "BUY" | "WAIT" | "NO_TRADE" {
  if (returnPct >= 1.2) return "BUY";
  if (returnPct >= -0.3) return "WAIT";
  return "NO_TRADE";
}
