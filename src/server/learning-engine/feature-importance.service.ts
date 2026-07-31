import { prisma } from "@/src/server/db/prisma";
import { persistFeatureImportance } from "@/src/server/learning-engine/learning-engine.repository";
import type { FeatureImportanceRow } from "@/src/server/learning-engine/learning-engine.types";

const FEATURES = [
  "RSI",
  "MACD",
  "EMA",
  "VOLUME",
  "VWAP",
  "ATR",
  "FUNDING",
  "OI",
  "LIQUIDITY",
  "NEWS",
  "ORDERBOOK",
  "MOMENTUM",
  "TREND",
  "WHALE",
  "RELATIVE_STRENGTH",
] as const;

export async function computeFeatureImportance(periodHours = 24 * 30) {
  const since = new Date(Date.now() - periodHours * 60 * 60_000);
  const [features, attributions, trades] = await Promise.all([
    prisma.learningFeature.findMany({
      where: { createdAt: { gte: since } },
      take: 5000,
      include: { learningTrade: true },
    }),
    prisma.decisionAttribution.findMany({ where: { createdAt: { gte: since } }, take: 2000 }),
    prisma.learningTrade.findMany({ where: { closedAt: { gte: since } }, take: 500, select: { returnPercent: true, outcome: true } }),
  ]);

  const aggregates = new Map<string, { sum: number; count: number; wins: number }>();
  for (const name of FEATURES) aggregates.set(name, { sum: 0, count: 0, wins: 0 });

  for (const row of features) {
    const key = normalizeFeature(row.featureKey);
    if (!aggregates.has(key)) aggregates.set(key, { sum: 0, count: 0, wins: 0 });
    const bucket = aggregates.get(key)!;
    bucket.sum += Number(row.numericValue ?? 0);
    bucket.count += 1;
    if (row.learningTrade.outcome === "WIN") bucket.wins += 1;
  }

  for (const row of attributions) {
    const key = normalizeFeature(row.factorName ?? "UNKNOWN");
    if (!aggregates.has(key)) aggregates.set(key, { sum: 0, count: 0, wins: 0 });
    const bucket = aggregates.get(key)!;
    bucket.sum += Number(row.contributionWeight ?? 0);
    bucket.count += 1;
  }

  const avgRoe = trades.length > 0 ? trades.reduce((sum, row) => sum + Number(row.returnPercent ?? 0), 0) / trades.length : 0;
  const rows: FeatureImportanceRow[] = [];
  for (const [feature, bucket] of aggregates.entries()) {
    if (bucket.count < 5) continue;
    const importance = Math.min(100, Math.abs(bucket.sum / bucket.count) * (bucket.count / 10));
    const winRate = bucket.count > 0 ? bucket.wins / bucket.count : 0;
    rows.push({
      feature,
      importance: Number(importance.toFixed(3)),
      direction: winRate > 0.52 ? "POSITIVE" : winRate < 0.48 ? "NEGATIVE" : "NEUTRAL",
      sampleSize: bucket.count,
    });
  }

  rows.sort((a, b) => b.importance - a.importance);
  await persistFeatureImportance(rows);
  return { count: rows.length, avgRoe, rows: rows.slice(0, 30) };
}

function normalizeFeature(raw: string) {
  const upper = raw.toUpperCase();
  if (upper.includes("RSI")) return "RSI";
  if (upper.includes("MACD")) return "MACD";
  if (upper.includes("EMA")) return "EMA";
  if (upper.includes("VOLUME") || upper.includes("VOL")) return "VOLUME";
  if (upper.includes("VWAP")) return "VWAP";
  if (upper.includes("ATR")) return "ATR";
  if (upper.includes("FUND")) return "FUNDING";
  if (upper.includes("OI") || upper.includes("OPEN_INTEREST")) return "OI";
  if (upper.includes("LIQ")) return "LIQUIDITY";
  if (upper.includes("NEWS")) return "NEWS";
  if (upper.includes("BOOK") || upper.includes("ORDERBOOK")) return "ORDERBOOK";
  if (upper.includes("MOMENT")) return "MOMENTUM";
  if (upper.includes("TREND")) return "TREND";
  if (upper.includes("WHALE")) return "WHALE";
  if (upper.includes("RS") || upper.includes("RELATIVE")) return "RELATIVE_STRENGTH";
  return upper.slice(0, 32);
}
