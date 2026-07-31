import { prisma } from "@/src/server/db/prisma";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { MARKET_REGIMES, SESSION_TYPES, type SessionType } from "@/src/server/paper-validation/paper-validation.types";

export async function analyzeSessionPerformance(userId?: string) {
  const trades = await prisma.paperTrade.findMany({
    where: { userId, status: "CLOSED" },
    orderBy: { closedAt: "asc" },
    take: 5000,
  });

  const sessionBuckets = new Map<string, typeof trades>();
  const regimeBuckets = new Map<string, typeof trades>();

  for (const trade of trades) {
    const session = detectSession(trade.openedAt);
    const sessionKey = `${trade.userId}:${session}:${trade.marketRegime ?? "ALL"}`;
    const sBucket = sessionBuckets.get(sessionKey) ?? [];
    sBucket.push(trade);
    sessionBuckets.set(sessionKey, sBucket);

    const regime = normalizeRegime(trade.marketRegime);
    const regimeKey = `${trade.userId}:${regime}`;
    const rBucket = regimeBuckets.get(regimeKey) ?? [];
    rBucket.push(trade);
    regimeBuckets.set(regimeKey, rBucket);
  }

  const updated = [];

  for (const [key, bucket] of sessionBuckets) {
    const [uid, sessionType, regimePart] = key.split(":");
    const marketRegime = regimePart === "ALL" ? null : regimePart;
    const returns = bucket.map((t) => t.returnPct);
    const metrics = computePerformanceMetrics(returns);

    const row = await prisma.sessionPerformance.upsert({
      where: {
        userId_sessionType_marketRegime: {
          userId: uid!,
          sessionType: sessionType!,
          marketRegime: marketRegime ?? "",
        },
      },
      create: {
        userId: uid!,
        sessionType: sessionType!,
        marketRegime: marketRegime ?? "",
        tradeCount: bucket.length,
        winRate: metrics.winRate,
        avgReturn: metrics.avgReturnPct,
        profitFactor: metrics.profitFactor,
        metadata: { metrics },
      },
      update: {
        tradeCount: bucket.length,
        winRate: metrics.winRate,
        avgReturn: metrics.avgReturnPct,
        profitFactor: metrics.profitFactor,
        metadata: { metrics },
      },
    });
    updated.push(row);
  }

  for (const regime of MARKET_REGIMES) {
    for (const trade of trades.filter((t) => normalizeRegime(t.marketRegime) === regime)) {
      const uid = userId ?? trade.userId;
      const bucket = regimeBuckets.get(`${uid}:${regime}`) ?? [];
      if (bucket.length === 0) continue;
      const returns = bucket.map((t) => t.returnPct);
      const metrics = computePerformanceMetrics(returns);
      await prisma.sessionPerformance.upsert({
        where: {
          userId_sessionType_marketRegime: { userId: uid, sessionType: "REGIME", marketRegime: regime },
        },
        create: {
          userId: uid,
          sessionType: "REGIME",
          marketRegime: regime,
          tradeCount: bucket.length,
          winRate: metrics.winRate,
          avgReturn: metrics.avgReturnPct,
          profitFactor: metrics.profitFactor,
          metadata: { metrics, regimeType: regime },
        },
        update: {
          tradeCount: bucket.length,
          winRate: metrics.winRate,
          avgReturn: metrics.avgReturnPct,
          profitFactor: metrics.profitFactor,
        },
      });
    }
  }

  return {
    sessions: updated.length,
    sessionLeaderboard: updated.sort((a, b) => (b.profitFactor ?? 0) - (a.profitFactor ?? 0)).slice(0, 20),
    sessionTypes: SESSION_TYPES,
  };
}

function detectSession(date: Date): SessionType {
  const utcHour = date.getUTCHours();
  const day = date.getUTCDay();
  if (day === 0 || day === 6) return "WEEKEND";
  if (utcHour >= 0 && utcHour < 8) return "ASIAN";
  if (utcHour >= 8 && utcHour < 16) return "EUROPEAN";
  if (utcHour >= 16 && utcHour < 24) return "US";
  return "WEEKDAY";
}

function normalizeRegime(regime: string | null | undefined): string {
  if (!regime) return "SIDEWAYS";
  const upper = regime.toUpperCase();
  if (upper.includes("BULL")) return "BULL";
  if (upper.includes("BEAR")) return "BEAR";
  if (upper.includes("PUMP")) return "PUMP";
  if (upper.includes("DUMP")) return "DUMP";
  if (upper.includes("HIGH") && upper.includes("VOL")) return "HIGH_VOLATILITY";
  if (upper.includes("LOW") && upper.includes("VOL")) return "LOW_VOLATILITY";
  if (upper.includes("RANGE") || upper.includes("SIDE")) return "SIDEWAYS";
  return upper;
}

export async function getSessionLeaderboard(userId?: string) {
  return prisma.sessionPerformance.findMany({
    where: userId ? { userId } : {},
    orderBy: { profitFactor: "desc" },
    take: 30,
  });
}
