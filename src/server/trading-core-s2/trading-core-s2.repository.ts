import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type {
  DiscoveryV2Report,
  DiscoveryV2ScoreBreakdown,
  MarketRegimeClassification,
  MomentumBreakoutEvaluation,
} from "@/src/server/trading-core-s2/trading-core-s2.types";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export async function persistMarketRegime(classification: MarketRegimeClassification) {
  const regimeKey = "CURRENT";
  const data = {
    regimeKey,
    regime: classification.regime,
    confidence: classification.confidence,
    regimeStrength: classification.regimeStrength,
    expectedDurationMinutes: classification.expectedDurationMinutes,
    supportingFeatures: classification.supportingFeatures as Prisma.InputJsonValue,
    historicalSimilarity: classification.historicalSimilarity,
    btcTrend: classification.btcTrend,
    ethTrend: classification.ethTrend,
    btcDominance: classification.btcDominance,
    volumeExpansion: classification.volumeExpansion,
    atrPercent: classification.atrPercent,
    realizedVolatility: classification.realizedVolatility,
    marketBreadth: classification.marketBreadth,
    usdtPairStrength: classification.usdtPairStrength,
    relativeStrength: classification.relativeStrength,
    marketMomentum: classification.marketMomentum,
    classifiedAt: new Date(classification.classifiedAt),
  };

  await prisma.marketRegimeHistory.create({
    data: {
      regime: data.regime,
      confidence: data.confidence,
      regimeStrength: data.regimeStrength,
      supportingFeatures: data.supportingFeatures,
      historicalSimilarity: data.historicalSimilarity,
      classifiedAt: data.classifiedAt,
    },
  });

  return prisma.marketRegimeSnapshot.upsert({
    where: { regimeKey },
    create: data,
    update: data,
  });
}

export async function getCurrentMarketRegime() {
  return prisma.marketRegimeSnapshot.findUnique({ where: { regimeKey: "CURRENT" } });
}

export async function listMarketRegimeHistory(limit = 100) {
  return prisma.marketRegimeHistory.findMany({ orderBy: { classifiedAt: "desc" }, take: limit });
}

export async function persistDiscoveryV2Batch(input: {
  totalSymbols: number;
  rankedSymbols: number;
  marketRegime: MarketRegimeClassification["regime"] | null;
  report: DiscoveryV2Report;
  scores: DiscoveryV2ScoreBreakdown[];
  topCandidates: DiscoveryV2ScoreBreakdown[];
}) {
  const snapshot = await prisma.discoverySnapshot.create({
    data: {
      snapshotKey: key("ds"),
      totalSymbols: input.totalSymbols,
      rankedSymbols: input.rankedSymbols,
      marketRegime: input.marketRegime ?? undefined,
      report: input.report as Prisma.InputJsonValue,
      metadata: { topN: input.topCandidates.length },
    },
  });

  if (input.scores.length > 0) {
    await prisma.discoveryScore.createMany({
      data: input.scores.map((row) => ({
        scoreKey: key("dsc"),
        snapshotId: snapshot.id,
        symbol: row.symbol,
        discoveryScore: row.discoveryScore,
        momentumScore: row.momentumScore,
        volumeScore: row.volumeScore,
        relativeVolume: row.relativeVolume,
        trendScore: row.trendScore,
        breakoutScore: row.breakoutScore,
        liquidityScore: row.liquidityScore,
        spreadScore: row.spreadScore,
        volatilityScore: row.volatilityScore,
        relativeBtcStrength: row.relativeBtcStrength,
        relativeEthStrength: row.relativeEthStrength,
        regimeCompatibility: row.regimeCompatibility,
        rejected: row.rejected,
        rejectReason: row.rejectReason,
        metadata: row.metadata as Prisma.InputJsonValue,
      })),
    });
  }

  if (input.topCandidates.length > 0) {
    await prisma.discoveryRanking.createMany({
      data: input.topCandidates.map((row, index) => ({
        rankingKey: key("drk"),
        snapshotId: snapshot.id,
        symbol: row.symbol,
        rank: index + 1,
        discoveryScore: row.discoveryScore,
        category: String(row.metadata?.reportCategory ?? "TOP_OPPORTUNITY"),
        metadata: row.metadata as Prisma.InputJsonValue,
      })),
    });
    await prisma.discoveryCandidate.createMany({
      data: input.topCandidates.map((row, index) => ({
        candidateKey: key("dcn"),
        snapshotId: snapshot.id,
        symbol: row.symbol,
        rank: index + 1,
        discoveryScore: row.discoveryScore,
        reportCategory: String(row.metadata?.reportCategory ?? "TOP_OPPORTUNITY"),
        metadata: row.metadata as Prisma.InputJsonValue,
      })),
    });
  }

  return snapshot;
}

export async function getLatestDiscoverySnapshot() {
  return prisma.discoverySnapshot.findFirst({
    orderBy: { scannedAt: "desc" },
    include: {
      rankings: { orderBy: { rank: "asc" } },
      candidates: { orderBy: { rank: "asc" } },
    },
  });
}

export async function listDiscoverySnapshots(limit = 30) {
  return prisma.discoverySnapshot.findMany({
    orderBy: { scannedAt: "desc" },
    take: limit,
    select: {
      id: true,
      snapshotKey: true,
      scannedAt: true,
      totalSymbols: true,
      rankedSymbols: true,
      marketRegime: true,
      report: true,
    },
  });
}

export async function persistMomentumBreakoutCandidates(rows: MomentumBreakoutEvaluation[], snapshotId?: string, marketRegime?: MarketRegimeClassification["regime"]) {
  if (rows.length === 0) return [];
  const records = [];
  for (const row of rows) {
    records.push(
      await prisma.momentumBreakoutCandidate.create({
        data: {
          candidateKey: key("mbc"),
          symbol: row.symbol,
          snapshotId,
          marketRegime,
          verdict: row.verdict,
          entryProbability: row.entryProbability,
          expectedRr: row.expectedRr,
          expectedHoldingMinutes: row.expectedHoldingMinutes,
          expectedVolatility: row.expectedVolatility,
          confidence: row.confidence,
          relativeVolume: row.relativeVolume,
          momentum5m: row.momentum5m,
          momentum15m: row.momentum15m,
          relativeBtcStrength: row.relativeBtcStrength,
          relativeEthStrength: row.relativeEthStrength,
          spreadPercent: row.spreadPercent,
          features: row.features as Prisma.InputJsonValue,
        },
      }),
    );
  }
  return records;
}

export async function persistMomentumBreakoutStatistics(stats: {
  periodStart: Date;
  periodEnd: Date;
  hitRate: number;
  averageProfit: number;
  averageLoss: number;
  profitFactor: number;
  expectancy: number;
  sharpe: number;
  maxDrawdown: number;
  sampleSize: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.momentumBreakoutStatistics.create({
    data: {
      statsKey: key("mbs"),
      ...stats,
      metadata: stats.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function getLatestMomentumStatistics() {
  return prisma.momentumBreakoutStatistics.findFirst({ orderBy: { calculatedAt: "desc" } });
}

export async function listMomentumCandidates(limit = 50) {
  return prisma.momentumBreakoutCandidate.findMany({
    orderBy: { evaluatedAt: "desc" },
    take: limit,
  });
}

export async function listRejectedDiscoveryScores(snapshotId: string, limit = 50) {
  return prisma.discoveryScore.findMany({
    where: { snapshotId, rejected: true },
    orderBy: { discoveryScore: "desc" },
    take: limit,
  });
}
