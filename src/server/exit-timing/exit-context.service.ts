import { prisma } from "@/src/server/db/prisma";
import type { ExitContext } from "@/src/server/exit-timing/exit-timing.types";

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export type OpenPositionInput = {
  id: string;
  symbol: string;
  entryPrice: number;
  currentPrice: number;
  openedAt: Date;
  unrealizedPnl: number;
};

export async function discoverOpenPositions(limit = 20): Promise<OpenPositionInput[]> {
  const positions = await prisma.position.findMany({
    where: { status: "OPEN", side: "LONG" },
    orderBy: { openedAt: "desc" },
    take: limit,
    include: { tradingPair: { select: { symbol: true } } },
  }).catch(() => []);

  return positions.map((p) => ({
    id: p.id,
    symbol: p.tradingPair?.symbol ?? "",
    entryPrice: p.entryPrice,
    currentPrice: p.markPrice ?? p.entryPrice,
    openedAt: p.openedAt,
    unrealizedPnl: p.unrealizedPnl,
  })).filter((p) => p.symbol && p.entryPrice > 0);
}

export async function collectExitContext(position: OpenPositionInput): Promise<ExitContext | null> {
  const sym = position.symbol.toUpperCase();
  const currentPrice = position.currentPrice > 0 ? position.currentPrice : position.entryPrice;
  const profitPct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
  const lossPct = profitPct < 0 ? Math.abs(profitPct) : 0;
  const holdingMinutes = (Date.now() - position.openedAt.getTime()) / 60_000;

  const snapshot = await prisma.marketSnapshot.findFirst({
    where: { symbol: sym },
    orderBy: { snapshotAt: "desc" },
    include: { trend: true, momentum: true, volumeIntel: true },
  }).catch(() => null);

  const [newsImpact, whaleScore, onChainScore] = await Promise.all([
    prisma.newsImpact.findFirst({ where: { affectedCoins: { has: sym } }, orderBy: { impactScore: "desc" } }).catch(() => null),
    prisma.whaleScore.findFirst({ where: { asset: sym }, orderBy: { distributionScore: "desc" } }).catch(() => null),
    prisma.onChainScore.findFirst({ orderBy: { protocolScore: "desc" } }).catch(() => null),
  ]);

  const trendStrength = num(snapshot?.trend?.trendStrength, 50);
  const trendDir = String(snapshot?.trend?.primaryTrend ?? "NEUTRAL");
  const momentumScore = num(snapshot?.momentum?.momentumScore, 50);
  const momentumDecay = num(snapshot?.momentum?.acceleration, 0) < 0 ? 30 : 0;
  const relativeVolume = num(snapshot?.relativeVolume, 1);
  const whaleDist = num(whaleScore?.distributionScore, 0);
  const high = num(snapshot?.high, currentPrice);
  const low = num(snapshot?.low, currentPrice);
  const vwap = num(snapshot?.vwap, currentPrice);
  const distToSupport = currentPrice > 0 ? ((currentPrice - low) / currentPrice) * 100 : 0;
  const distToResistance = high > 0 ? ((high - currentPrice) / currentPrice) * 100 : 0;
  const supportBroken = currentPrice < low * 0.998;

  return {
    symbol: sym,
    positionId: position.id,
    entryPrice: position.entryPrice,
    currentPrice,
    currentProfitPct: Number(profitPct.toFixed(4)),
    currentLossPct: Number(lossPct.toFixed(4)),
    holdingMinutes: Number(holdingMinutes.toFixed(1)),
    momentum: { score: clamp(momentumScore), decay: momentumDecay },
    trend: {
      score: clamp(trendStrength),
      direction: trendDir,
      exhaustion: trendDir.includes("BULL") && momentumDecay > 20 ? 60 : 20,
    },
    volume: {
      score: clamp(relativeVolume * 50),
      relativeVolume,
      distribution: whaleDist > 60 && num(snapshot?.volumeDelta) < 0,
    },
    regime: { score: clamp(50), label: String(snapshot?.regime ?? "UNKNOWN") },
    orderBook: { score: clamp(50 + num(snapshot?.orderBookImbalance) * 30), imbalance: num(snapshot?.orderBookImbalance) },
    liquidity: { score: clamp(num(snapshot?.liquidityScore, 60)), spread: num(snapshot?.spread) },
    news: { score: clamp(100 - num(newsImpact?.impactScore, 0) * 0.4), reversalRisk: num(newsImpact?.marketSensitivity, 15) },
    whale: { score: clamp(100 - whaleDist), distribution: whaleDist },
    onChain: { score: clamp(num(onChainScore?.protocolScore, 50)) },
    volatility: { score: clamp(100 - num(snapshot?.volatility, 5) * 8), atr: num(snapshot?.atr), realized: num(snapshot?.realizedVolatility) },
    vwap: { distancePct: vwap > 0 ? ((currentPrice - vwap) / vwap) * 100 : 0 },
    support: { score: clamp(100 - distToSupport * 4), distancePct: distToSupport, broken: supportBroken },
    resistance: { score: clamp(100 - distToResistance * 4), distancePct: distToResistance },
  };
}
