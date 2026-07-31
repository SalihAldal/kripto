import { prisma } from "@/src/server/db/prisma";
import { persistPatternPerformance, upsertPatternLibrary } from "@/src/server/learning-engine/learning-engine.repository";
import type { PatternDiscoveryResult } from "@/src/server/learning-engine/learning-engine.types";

export async function discoverPatterns(limit = 200) {
  const stats = await prisma.learningPatternStats.findMany({ orderBy: { updatedAt: "desc" }, take: limit });
  const trades = await prisma.learningTrade.findMany({
    orderBy: { closedAt: "desc" },
    take: 500,
    select: { patternKey: true, returnPercent: true, outcome: true, closedAt: true, symbol: true, metadata: true },
  });

  const byPattern = new Map<string, { wins: number; total: number; roeSum: number; hours: number[]; weekdays: number[]; regimes: string[] }>();
  for (const trade of trades) {
    const key = trade.patternKey ?? "unknown";
    const bucket = byPattern.get(key) ?? { wins: 0, total: 0, roeSum: 0, hours: [], weekdays: [], regimes: [] };
    bucket.total += 1;
    if (trade.outcome === "WIN") bucket.wins += 1;
    bucket.roeSum += Number(trade.returnPercent ?? 0);
    if (trade.closedAt) {
      bucket.hours.push(trade.closedAt.getUTCHours());
      bucket.weekdays.push(trade.closedAt.getUTCDay());
    }
    const regime = String((trade.metadata as Record<string, unknown> | null)?.marketRegime ?? "UNKNOWN");
    bucket.regimes.push(regime);
    byPattern.set(key, bucket);
  }

  const discovered: PatternDiscoveryResult[] = [];
  for (const [patternKey, bucket] of byPattern.entries()) {
    if (bucket.total < 3) continue;
    const winRate = (bucket.wins / bucket.total) * 100;
    const expectancy = bucket.roeSum / bucket.total;
    const hourBucket = modeNumber(bucket.hours);
    const weekday = modeNumber(bucket.weekdays);
    const regime = modeString(bucket.regimes);
    const status = winRate >= 55 && expectancy > 0 ? "WINNING" : winRate <= 40 || expectancy < -1 ? "LOSING" : "NEUTRAL";
    const row: PatternDiscoveryResult = {
      patternKey,
      winRate,
      sampleSize: bucket.total,
      expectancy,
      regime,
      hourBucket,
      weekday,
      status,
    };
    discovered.push(row);
    await upsertPatternLibrary({ ...row, metadata: { source: "pattern-discovery" } }).catch(() => null);
    await persistPatternPerformance({
      patternKey,
      winRate,
      profitFactor: Math.max(0, 1 + expectancy / 10),
      sampleSize: bucket.total,
    }).catch(() => null);
  }

  for (const stat of stats) {
    await upsertPatternLibrary({
      patternKey: stat.patternKey,
      winRate: Number(stat.winrate ?? 0),
      sampleSize: stat.sampleCount,
      expectancy: Number(stat.expectancyPercent ?? 0),
      status: stat.status === "LIVE_ACTIVE" ? "WINNING" : "NEUTRAL",
    }).catch(() => null);
  }

  return { discovered: discovered.length, patterns: discovered.slice(0, 50) };
}

function modeNumber(values: number[]) {
  if (values.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best = values[0]!;
  let bestCount = 0;
  for (const [value, count] of counts.entries()) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function modeString(values: string[]) {
  if (values.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}
