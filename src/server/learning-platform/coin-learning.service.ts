import { prisma } from "@/src/server/db/prisma";
import { upsertCoinProfile, persistLearningInsight } from "@/src/server/learning-platform/learning-platform.repository";
import { emitLearningPlatformEvent, LEARNING_PLATFORM_EVENT } from "@/src/server/learning-platform/learning-platform.events";

function num(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function learnCoinIntelligence(input?: { symbol?: string; limit?: number }) {
  const symbols = input?.symbol
    ? [input.symbol.toUpperCase()]
    : (
        await prisma.learningTrade.findMany({
          distinct: ["symbol"],
          select: { symbol: true },
          take: input?.limit ?? 100,
          orderBy: { closedAt: "desc" },
        })
      ).map((r) => r.symbol);

  const profiles = [];
  for (const symbol of symbols) {
    const trades = await prisma.learningTrade.findMany({
      where: { symbol },
      orderBy: { closedAt: "desc" },
      take: 200,
    });
    if (trades.length === 0) continue;

    const wins = trades.filter((t) => t.outcome === "WIN");
    const losses = trades.filter((t) => t.outcome === "LOSS");
    const returns = trades.map((t) => num(t.returnPercent));
    const winReturns = wins.map((t) => num(t.returnPercent));
    const lossReturns = losses.map((t) => num(t.returnPercent));

    const holdingMinutes = trades
      .map((t) => {
        if (t.openedAt && t.closedAt) return (t.closedAt.getTime() - t.openedAt.getTime()) / 60_000;
        if (t.holdSec) return t.holdSec / 60;
        return 0;
      })
      .filter((v) => v > 0);

    const hourBuckets = new Map<number, { wins: number; total: number; pnl: number }>();
    const regimeBuckets = new Map<string, { wins: number; total: number; pnl: number }>();

    for (const trade of trades) {
      const hour = (trade.openedAt ?? trade.createdAt).getUTCHours();
      const bucket = hourBuckets.get(hour) ?? { wins: 0, total: 0, pnl: 0 };
      bucket.total += 1;
      bucket.pnl += num(trade.returnPercent);
      if (trade.outcome === "WIN") bucket.wins += 1;
      hourBuckets.set(hour, bucket);

      const regime = String(trade.marketRegime ?? (trade.metadata as Record<string, unknown> | null)?.marketRegime ?? "UNKNOWN");
      const rb = regimeBuckets.get(regime) ?? { wins: 0, total: 0, pnl: 0 };
      rb.total += 1;
      rb.pnl += num(trade.returnPercent);
      if (trade.outcome === "WIN") rb.wins += 1;
      regimeBuckets.set(regime, rb);
    }

    const bestHourEntry = [...hourBuckets.entries()].sort((a, b) => b[1].pnl - a[1].pnl)[0];
    const worstHourEntry = [...hourBuckets.entries()].sort((a, b) => a[1].pnl - b[1].pnl)[0];
    const bestRegimeEntry = [...regimeBuckets.entries()].sort((a, b) => b[1].pnl - a[1].pnl)[0];
    const worstRegimeEntry = [...regimeBuckets.entries()].sort((a, b) => a[1].pnl - b[1].pnl)[0];

    const profile = await upsertCoinProfile({
      symbol,
      avgWinRate: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
      avgProfitPct: winReturns.length > 0 ? winReturns.reduce((s, v) => s + v, 0) / winReturns.length : 0,
      avgLossPct: lossReturns.length > 0 ? lossReturns.reduce((s, v) => s + v, 0) / lossReturns.length : 0,
      bestHoldingMinutes: holdingMinutes.length > 0 ? Math.max(...holdingMinutes) : undefined,
      worstHoldingMinutes: holdingMinutes.length > 0 ? Math.min(...holdingMinutes) : undefined,
      bestEntryHour: bestHourEntry?.[0],
      worstEntryHour: worstHourEntry?.[0],
      bestMarketRegime: bestRegimeEntry?.[0],
      worstMarketRegime: worstRegimeEntry?.[0],
      avgVolatility: num((trades[0]?.metadata as Record<string, unknown> | null)?.volatilityPercent),
      historicalConfidence: Math.min(100, 40 + trades.length * 0.5 + (wins.length / trades.length) * 40),
      tradeCount: trades.length,
      metadata: { lastUpdated: new Date().toISOString() },
    });

    profiles.push(profile);
    emitLearningPlatformEvent(LEARNING_PLATFORM_EVENT.COIN_PROFILE_UPDATED, { symbol, tradeCount: trades.length });
  }

  if (profiles.length > 0) {
    await persistLearningInsight({
      category: "COIN",
      title: `Coin intelligence updated for ${profiles.length} symbols`,
      content: `Refreshed profiles: ${profiles.map((p) => p.symbol).join(", ")}`,
    });
  }

  return { updated: profiles.length, profiles };
}
