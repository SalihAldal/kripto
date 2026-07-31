import { prisma } from "@/src/server/db/prisma";
import {
  setCachedMarketRegime,
  setCachedDiscoveryResult,
} from "@/src/server/trading-core-s2/trading-core-s2.cache";
import type { MarketRegimeClassification } from "@/src/server/trading-core-s2/trading-core-s2.types";
import type { SpotMarketRegimeLabel } from "@prisma/client";

export async function hydrateTradingCoreS2CacheFromDb() {
  const [regimeRow, discoveryRow] = await Promise.all([
    prisma.marketRegimeSnapshot.findUnique({ where: { regimeKey: "CURRENT" } }),
    prisma.discoverySnapshot.findFirst({
      orderBy: { scannedAt: "desc" },
      include: {
        rankings: { orderBy: { rank: "asc" } },
        scores: { select: { symbol: true, discoveryScore: true } },
      },
    }),
  ]);

  if (regimeRow) {
    const regime: MarketRegimeClassification = {
      regime: regimeRow.regime as SpotMarketRegimeLabel,
      confidence: regimeRow.confidence,
      regimeStrength: regimeRow.regimeStrength,
      expectedDurationMinutes: regimeRow.expectedDurationMinutes ?? 0,
      supportingFeatures: (regimeRow.supportingFeatures as Record<string, number | string | boolean>) ?? {},
      historicalSimilarity: regimeRow.historicalSimilarity ?? 0,
      btcTrend: regimeRow.btcTrend ?? 0,
      ethTrend: regimeRow.ethTrend ?? 0,
      btcDominance: regimeRow.btcDominance ?? 0,
      volumeExpansion: regimeRow.volumeExpansion ?? 0,
      atrPercent: regimeRow.atrPercent ?? 0,
      realizedVolatility: regimeRow.realizedVolatility ?? 0,
      marketBreadth: regimeRow.marketBreadth ?? 0,
      usdtPairStrength: regimeRow.usdtPairStrength ?? 0,
      relativeStrength: regimeRow.relativeStrength ?? 0,
      marketMomentum: regimeRow.marketMomentum ?? 0,
      classifiedAt: regimeRow.classifiedAt.toISOString(),
    };
    setCachedMarketRegime(regime);
  }

  if (discoveryRow) {
    setCachedDiscoveryResult({
      snapshotId: discoveryRow.id,
      topSymbols: discoveryRow.rankings.map((row) => row.symbol),
      scoreMap: Object.fromEntries(
        discoveryRow.scores.map((row) => [row.symbol.toUpperCase(), row.discoveryScore]),
      ),
      report: (discoveryRow.report as import("@/src/server/trading-core-s2/trading-core-s2.types").DiscoveryV2Report) ?? {
        topGainers: [],
        topBreakoutCandidates: [],
        topMomentum: [],
        topVolumeExpansion: [],
        topRelativeStrength: [],
      },
      scannedAt: discoveryRow.scannedAt.toISOString(),
    });
  }
}
