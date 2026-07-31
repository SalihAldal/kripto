import { prisma } from "@/src/server/db/prisma";

export async function learnFromOnChainMetrics(limit = 200) {
  const replays = await prisma.onChainReplay.findMany({
    orderBy: { replayedAt: "desc" },
    take: limit,
  });

  const metricRankings = new Map<string, { moves: number[]; count: number; predictive: boolean }>();

  for (const replay of replays) {
    const move = Math.abs(replay.maxMovePct ?? 0);
    const key = replay.eventType;
    const bucket = metricRankings.get(key) ?? { moves: [], count: 0, predictive: false };
    bucket.moves.push(move);
    bucket.count += 1;
    bucket.predictive = move >= 1;
    metricRankings.set(key, bucket);
  }

  const pumpPredictors = [...metricRankings.entries()]
    .filter(([, b]) => b.moves.some((m) => m > 2))
    .map(([metric, b]) => ({ metric, avgMove: b.moves.reduce((s, m) => s + m, 0) / b.count, count: b.count, direction: "PUMP" as const }))
    .sort((a, b) => b.avgMove - a.avgMove);

  const dumpPredictors = [...metricRankings.entries()]
    .filter(([, b]) => b.moves.some((m) => m < -1))
    .map(([metric, b]) => ({ metric, avgMove: b.moves.reduce((s, m) => s + m, 0) / b.count, count: b.count, direction: "DUMP" as const }))
    .sort((a, b) => a.avgMove - b.avgMove);

  const zeroImpact = [...metricRankings.entries()]
    .filter(([, b]) => b.moves.every((m) => m < 0.5))
    .map(([metric, b]) => ({ metric, count: b.count }));

  const rankedMetrics = [...metricRankings.entries()]
    .map(([metric, b]) => ({
      metric,
      avgMove: b.moves.reduce((s, m) => s + m, 0) / Math.max(1, b.moves.length),
      count: b.count,
      predictiveValue: b.predictive ? "HIGH" : "LOW",
    }))
    .sort((a, b) => b.avgMove - a.avgMove);

  return { pumpPredictors, dumpPredictors, zeroImpact, rankedMetrics, sampleSize: replays.length };
}
