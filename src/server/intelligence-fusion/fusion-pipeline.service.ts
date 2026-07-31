import { prisma } from "@/src/server/db/prisma";
import type { FusionAssetClass, SourceSnapshots } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import {
  completeFusionRun,
  createFusionRun,
  persistFusedMarketContext,
} from "@/src/server/intelligence-fusion/intelligence-fusion.repository";
import { emitFusionEvent, FUSION_EVENT } from "@/src/server/intelligence-fusion/intelligence-fusion.events";

async function safeRead<T>(fn: () => Promise<T>): Promise<Record<string, unknown>> {
  try {
    return (await fn()) as Record<string, unknown>;
  } catch {
    return { unavailable: true };
  }
}

export async function collectSourceSnapshots(): Promise<SourceSnapshots> {
  const [
    marketSnapshot,
    scanner,
    news,
    whale,
    onChain,
    portfolio,
    learning,
    research,
    risk,
    metaAi,
    governance,
  ] = await Promise.all([
    safeRead(() =>
      prisma.marketSnapshot.findFirst({
        orderBy: { snapshotAt: "desc" },
        select: {
          symbol: true, lastPrice: true, volumeQuote: true, liquidityScore: true,
          orderBookImbalance: true, volatility: true, regime: true, healthScore: true,
          relativeVolume: true, snapshotAt: true,
          trend: { select: { trendStrength: true, primaryTrend: true } },
          momentum: { select: { momentumScore: true, breakoutProbability: true } },
        },
      }).then((snap) => snap ? {
        ...snap,
        trendStrength: snap.trend?.trendStrength,
        momentumScore: snap.momentum?.momentumScore,
      } : { unavailable: true }),
    ),
    safeRead(() => prisma.scannerHealth.findFirst({ orderBy: { checkedAt: "desc" } }).catch(() => ({ unavailable: true }))),
    safeRead(() =>
      Promise.all([
        prisma.newsImpact.findMany({ orderBy: { impactScore: "desc" }, take: 10 }),
        prisma.narrative.findMany({ orderBy: { heatScore: "desc" }, take: 5 }).catch(() => []),
      ]).then(([impacts, narratives]) => ({ impacts, narratives })),
    ),
    safeRead(() =>
      Promise.all([
        prisma.whaleScore.findMany({ orderBy: { whaleActivityScore: "desc" }, take: 10 }),
        prisma.whaleAlert.findMany({ where: { isActive: true }, take: 5 }),
      ]).then(([scores, alerts]) => ({ scores, alerts })),
    ),
    safeRead(() =>
      Promise.all([
        prisma.protocolHealth.findMany({ orderBy: { overallHealth: "desc" }, take: 10 }),
        prisma.onChainScore.findMany({ orderBy: { protocolScore: "desc" }, take: 5 }).catch(() => []),
      ]).then(([protocols, scores]) => ({ protocols, scores })),
    ),
    safeRead(() =>
      prisma.position.count({ where: { status: "OPEN" } }).then((count) => ({
        openPositions: count,
        timestamp: new Date().toISOString(),
      })),
    ),
    safeRead(() => prisma.learningEngineJobState.findMany({ take: 5 })),
    safeRead(() => prisma.quantResearchJobState.findMany({ take: 5 })),
    safeRead(() =>
      prisma.position.findMany({
        where: { status: "OPEN" },
        take: 20,
        select: { unrealizedPnl: true, quantity: true, tradingPair: { select: { symbol: true } } },
      }).then((positions) => ({
        openPositions: positions.length,
        totalExposure: positions.reduce((s, p) => s + Math.abs(p.quantity ?? 0), 0),
        positions,
      })),
    ),
    safeRead(() =>
      prisma.metaContext.findFirst({ orderBy: { builtAt: "desc" } }).then((ctx) => ctx ?? { unavailable: true }),
    ),
    safeRead(() => prisma.aiGovernanceJobState.findMany({ take: 5 })),
  ]);

  return {
    marketSnapshot,
    scanner,
    news,
    whale,
    onChain,
    portfolio,
    learning,
    research,
    risk,
    metaAi,
    governance,
  };
}

function countAvailableSources(sources: SourceSnapshots): number {
  return Object.values(sources).filter((s) => s && !("unavailable" in s)).length;
}

export async function runFusionPipeline(input?: { assetClass?: FusionAssetClass; symbol?: string }) {
  const fusion = await createFusionRun({ assetClass: input?.assetClass, symbol: input?.symbol });
  emitFusionEvent(FUSION_EVENT.FUSION_STARTED, { fusionId: fusion.id });

  const sources = await collectSourceSnapshots();
  const sourceCount = countAvailableSources(sources);
  const context = await persistFusedMarketContext(fusion.id, sources, input?.assetClass, input?.symbol);
  await completeFusionRun(fusion.id, sourceCount);

  emitFusionEvent(FUSION_EVENT.FUSION_COMPLETED, { fusionId: fusion.id, sourceCount, contextId: context.id });
  return { fusionId: fusion.id, contextId: context.id, sources, sourceCount };
}
