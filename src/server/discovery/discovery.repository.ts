import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { DiscoveryProfileOutput, UniverseSymbol } from "@/src/server/discovery/discovery.types";

export async function upsertScannerUniverseBatch(rows: UniverseSymbol[]) {
  if (rows.length === 0) return 0;
  let count = 0;
  for (const row of rows) {
    await prisma.scannerUniverse.upsert({
      where: {
        exchange_marketType_symbol: {
          exchange: row.exchange,
          marketType: row.marketType,
          symbol: row.symbol,
        },
      },
      create: {
        symbol: row.symbol,
        exchange: row.exchange,
        marketType: row.marketType,
        quoteAsset: row.quoteAsset,
        baseAsset: row.baseAsset,
        source: row.source,
        status: row.status,
        zone: row.zone,
        isNewListing: Boolean(row.isNewListing),
        isDelistingCandidate: Boolean(row.isDelistingCandidate),
        listedAt: row.listedAt,
        metadata: row.metadata as Prisma.InputJsonValue,
      },
      update: {
        quoteAsset: row.quoteAsset,
        baseAsset: row.baseAsset,
        source: row.source,
        status: row.status,
        zone: row.zone,
        isNewListing: Boolean(row.isNewListing),
        isDelistingCandidate: Boolean(row.isDelistingCandidate),
        listedAt: row.listedAt,
        metadata: row.metadata as Prisma.InputJsonValue,
        syncedAt: new Date(),
      },
    });
    count += 1;
  }
  return count;
}

export async function listScannerUniverse(options?: { limit?: number; source?: string }) {
  const rows = await prisma.scannerUniverse.findMany({
    where: {
      status: "TRADING",
      ...(options?.source ? { source: options.source as never } : {}),
    },
    orderBy: { syncedAt: "desc" },
    take: options?.limit ?? 5000,
  });
  return rows.map(
    (row): UniverseSymbol => ({
      symbol: row.symbol,
      exchange: row.exchange,
      marketType: row.marketType as UniverseSymbol["marketType"],
      quoteAsset: row.quoteAsset,
      baseAsset: row.baseAsset ?? undefined,
      source: row.source,
      status: row.status,
      zone: row.zone ?? undefined,
      isNewListing: row.isNewListing,
      isDelistingCandidate: row.isDelistingCandidate,
      listedAt: row.listedAt ?? undefined,
      metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    }),
  );
}

export async function persistDiscoveryBatch(input: {
  scannedAt: string;
  profiles: DiscoveryProfileOutput[];
  rankings: Array<{ symbol: string; rank: number; tier: string; opportunityScore: number; laneLeader?: string }>;
}) {
  const periodEnd = new Date(input.scannedAt);
  const periodStart = new Date(periodEnd.getTime() - 15 * 60 * 1000);

  for (const profile of input.profiles) {
    const created = await prisma.scannerProfile.create({
      data: {
        symbol: profile.symbol,
        assetClass: profile.assetClass,
        regime: profile.regime,
        opportunityScore: profile.opportunityScore,
        confidence: profile.confidence,
        tier: profile.tier,
        summary: profile.summary,
        positiveFactors: profile.positiveFactors,
        negativeFactors: profile.negativeFactors,
        tradeTypes: profile.tradeTypes,
        profile: profile.profile as Prisma.InputJsonValue,
        momentumScore: profile.dimensions.momentum,
        trendScore: profile.dimensions.trend,
        volumeScore: profile.dimensions.volume,
        whaleScore: profile.dimensions.whale,
        newsScore: profile.dimensions.news,
        liquidityScore: profile.dimensions.liquidity,
        fundingScore: profile.dimensions.funding,
        riskScore: profile.dimensions.risk,
        relativeStrengthScore: profile.dimensions.relativeStrength,
        volatilityScore: profile.dimensions.volatility,
        breakoutScore: profile.dimensions.breakout,
        continuationScore: profile.dimensions.continuation,
        exhaustionScore: profile.dimensions.exhaustion,
        scannedAt: periodEnd,
        lanes: {
          create: profile.laneScores.map((lane) => ({
            lane: lane.lane,
            score: lane.score,
            reasons: lane.reasons,
            metadata: lane.metadata as Prisma.InputJsonValue,
          })),
        },
        scores: {
          create: Object.entries(profile.dimensions).map(([dimension, score]) => ({
            dimension,
            score,
          })),
        },
      },
    });

    await prisma.scannerHealth.create({
      data: {
        symbol: profile.symbol,
        healthy: profile.health.healthy,
        rejectReason: profile.health.rejectReason,
        exchangeOnline: profile.health.exchangeOnline,
        candlesOk: profile.health.candlesOk,
        dataQualityScore: profile.health.dataQualityScore,
        metadata: profile.health.metadata as Prisma.InputJsonValue,
        checkedAt: periodEnd,
      },
    });

    const ranking = input.rankings.find((row) => row.symbol === profile.symbol);
    if (ranking) {
      await prisma.scannerRanking.create({
        data: {
          symbol: profile.symbol,
          profileId: created.id,
          rank: ranking.rank,
          tier: ranking.tier as never,
          opportunityScore: ranking.opportunityScore,
          laneLeader: ranking.laneLeader,
          periodStart,
          periodEnd,
        },
      });
    }

    await prisma.scannerDiscovery.create({
      data: {
        symbol: profile.symbol,
        profileId: created.id,
        tier: profile.tier,
        opportunityScore: profile.opportunityScore,
        laneHits: profile.laneScores.filter((row) => row.score >= 60).map((row) => row.lane),
        metadata: { summary: profile.summary },
        discoveredAt: periodEnd,
      },
    });

    await prisma.opportunityQueue.create({
      data: {
        symbol: profile.symbol,
        profileId: created.id,
        tier: profile.tier,
        opportunityScore: profile.opportunityScore,
        confidence: profile.confidence,
        status: "PENDING",
        priority: Math.round(profile.opportunityScore),
        payload: {
          summary: profile.summary,
          tradeTypes: profile.tradeTypes,
          positiveFactors: profile.positiveFactors,
          negativeFactors: profile.negativeFactors,
          regime: profile.regime,
          assetClass: profile.assetClass,
        } as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
  }
}

export async function listLatestDiscoveries(limit = 50) {
  return prisma.scannerDiscovery.findMany({
    orderBy: { discoveredAt: "desc" },
    take: limit,
    include: {
      profile: {
        include: {
          lanes: { orderBy: { score: "desc" }, take: 5 },
        },
      },
    },
  });
}

export async function listScannerRankings(limit = 100) {
  return prisma.scannerRanking.findMany({
    orderBy: [{ periodEnd: "desc" }, { rank: "asc" }],
    take: limit,
    include: { profile: true },
  });
}

export async function listOpportunityQueue(limit = 100, status: "PENDING" | "CONSUMED" | "EXPIRED" | "SKIPPED" = "PENDING") {
  return prisma.opportunityQueue.findMany({
    where: { status },
    orderBy: [{ priority: "desc" }, { opportunityScore: "desc" }],
    take: limit,
    include: { profile: true },
  });
}

export async function getDiscoveryHealthSummary() {
  const [universeCount, pendingQueue, latestDiscovery, unhealthyRecent] = await Promise.all([
    prisma.scannerUniverse.count(),
    prisma.opportunityQueue.count({ where: { status: "PENDING" } }),
    prisma.scannerDiscovery.findFirst({ orderBy: { discoveredAt: "desc" } }),
    prisma.scannerHealth.count({
      where: {
        healthy: false,
        checkedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    }),
  ]);
  return {
    universeCount,
    pendingQueue,
    latestDiscoveryAt: latestDiscovery?.discoveredAt ?? null,
    unhealthyRecent,
  };
}

export async function expireStaleOpportunities() {
  const result = await prisma.opportunityQueue.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });
  return result.count;
}

export async function markOpportunityConsumed(symbol: string) {
  await prisma.opportunityQueue.updateMany({
    where: { symbol, status: "PENDING" },
    data: { status: "CONSUMED", consumedAt: new Date() },
  });
}

export async function listDiscoveryTimeline(limit = 100) {
  return prisma.scannerDiscovery.findMany({
    orderBy: { discoveredAt: "desc" },
    take: limit,
    select: {
      id: true,
      symbol: true,
      tier: true,
      opportunityScore: true,
      discoveredAt: true,
      laneHits: true,
    },
  });
}

export async function listLaneLeaderboard(lane: string, limit = 50) {
  return prisma.scannerLane.findMany({
    where: { lane: lane as never },
    orderBy: { score: "desc" },
    take: limit,
    include: { profile: true },
  });
}
