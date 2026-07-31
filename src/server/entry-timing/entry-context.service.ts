import { prisma } from "@/src/server/db/prisma";
import type { EntryContext } from "@/src/server/entry-timing/entry-timing.types";

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function collectEntryContext(symbol: string, fallbackPrice?: number): Promise<EntryContext | null> {
  const sym = symbol.toUpperCase();
  const snapshot = await prisma.marketSnapshot.findFirst({
    where: { symbol: sym },
    orderBy: { snapshotAt: "desc" },
    include: { trend: true, momentum: true, liquidity: true, volumeIntel: true },
  }).catch(() => null);

  const price = fallbackPrice ?? snapshot?.lastPrice ?? 0;
  if (price <= 0) return null;

  const [newsImpact, whaleScore, onChainScore, exchangeHealth] = await Promise.all([
    prisma.newsImpact.findFirst({
      where: { affectedCoins: { has: sym } },
      orderBy: { impactScore: "desc" },
    }).catch(() => null),
    prisma.whaleScore.findFirst({ where: { asset: sym }, orderBy: { whaleActivityScore: "desc" } }).catch(() => null),
    prisma.onChainScore.findFirst({ orderBy: { protocolScore: "desc" } }).catch(() => null),
    prisma.exchangeHealthHistory.findFirst({ orderBy: { recordedAt: "desc" } }).catch(() => null),
  ]);

  const spread = num(snapshot?.spread ?? (snapshot ? (snapshot.askPrice - snapshot.bidPrice) / price * 100 : 0));
  const imbalance = num(snapshot?.orderBookImbalance);
  const relativeVolume = num(snapshot?.relativeVolume, 1);
  const volatility = num(snapshot?.volatility ?? snapshot?.realizedVolatility);
  const regime = String(snapshot?.regime ?? "UNKNOWN");
  const trendStrength = num(snapshot?.trend?.trendStrength, 50);
  const trendDir = String(snapshot?.trend?.primaryTrend ?? "NEUTRAL");
  const momentumScore = num(snapshot?.momentum?.momentumScore, 50);
  const breakoutProb = num(snapshot?.momentum?.breakoutProbability, 30);

  const high = num(snapshot?.high, price);
  const low = num(snapshot?.low, price);
  const distToHigh = high > 0 ? ((high - price) / price) * 100 : 0;
  const distToLow = price > 0 ? ((price - low) / price) * 100 : 0;

  return {
    symbol: sym,
    price,
    trend: { score: clamp(trendStrength), direction: trendDir, strength: trendStrength },
    momentum: { score: clamp(momentumScore), breakoutProb, shortMomentum: num(snapshot?.metadata && typeof snapshot.metadata === "object" ? (snapshot.metadata as Record<string, unknown>).shortMomentumPercent : 0) },
    volume: { score: clamp(relativeVolume * 50), relativeVolume, delta: num(snapshot?.volumeDelta) },
    liquidity: { score: clamp(num(snapshot?.liquidityScore, 60)), spread, imbalance },
    orderBook: { score: clamp(50 + imbalance * 30), bidAskRatio: num(snapshot?.bidAskRatio, 1) },
    volatility: { score: clamp(100 - volatility * 10), atr: num(snapshot?.atr), realized: volatility },
    support: { score: clamp(100 - distToLow * 5), distancePct: distToLow },
    resistance: { score: clamp(100 - distToHigh * 5), distancePct: distToHigh },
    structure: { score: clamp(trendStrength * 0.6 + momentumScore * 0.4), regime },
    regime: { score: regime.includes("TREND") ? 75 : regime.includes("RANGE") ? 55 : 45, label: regime },
    news: { score: clamp(100 - num(newsImpact?.impactScore, 0) * 0.5), uncertainty: num(newsImpact?.marketSensitivity, 20) },
    whale: { score: clamp(num(whaleScore?.whaleActivityScore, 50)), activity: num(whaleScore?.whaleActivityScore) },
    onChain: { score: clamp(num(onChainScore?.protocolScore, 50)) },
    exchange: { stable: exchangeHealth?.restHealthy !== false && exchangeHealth?.wsHealthy !== false, latencyMs: num(exchangeHealth?.latencyMs) },
  };
}

export async function discoverAnalysisSymbols(limit = 10): Promise<string[]> {
  const [decisions, snapshots] = await Promise.all([
    prisma.decisionLog.findMany({
      where: { decision: { in: ["BUY", "EXECUTE", "LONG"] } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { symbol: true },
    }).catch(() => []),
    prisma.marketSnapshot.findMany({
      orderBy: { snapshotAt: "desc" },
      take: limit * 2,
      select: { symbol: true, momentum: { select: { momentumScore: true } } },
    }).catch(() => []),
  ]);

  const symbols = new Set<string>();
  for (const d of decisions) if (d.symbol) symbols.add(d.symbol.toUpperCase());
  for (const s of snapshots.sort((a, b) => num(b.momentum?.momentumScore) - num(a.momentum?.momentumScore))) {
    if (s.symbol) symbols.add(s.symbol.toUpperCase());
  }
  return [...symbols].slice(0, limit);
}
