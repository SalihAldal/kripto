import type { IntelligenceSourceType } from "@prisma/client";
import { FUSION_SOURCES } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import { upsertSourceConfidence } from "@/src/server/intelligence-fusion/intelligence-fusion.repository";
import { emitFusionEvent, FUSION_EVENT } from "@/src/server/intelligence-fusion/intelligence-fusion.events";
import { prisma } from "@/src/server/db/prisma";

const BASE_TRUST: Record<IntelligenceSourceType, number> = {
  MARKET_SNAPSHOT: 75,
  SCANNER: 70,
  NEWS: 60,
  WHALE: 65,
  ONCHAIN: 70,
  PORTFOLIO: 80,
  LEARNING: 55,
  RESEARCH: 60,
  RISK: 85,
  META_AI: 65,
  GOVERNANCE: 70,
};

async function measureSourceFreshness(sourceType: IntelligenceSourceType): Promise<number> {
  switch (sourceType) {
    case "MARKET_SNAPSHOT": {
      const snap = await prisma.marketSnapshot.findFirst({ orderBy: { snapshotAt: "desc" }, select: { snapshotAt: true } });
      if (!snap) return 30;
      const ageMs = Date.now() - snap.snapshotAt.getTime();
      return Math.max(10, 100 - ageMs / 60_000);
    }
    case "NEWS": {
      const count = await prisma.newsImpact.count({ where: { scoredAt: { gte: new Date(Date.now() - 3600_000) } } }).catch(() => 0);
      return Math.min(100, 40 + count * 10);
    }
    case "WHALE": {
      const count = await prisma.whaleAlert.count({ where: { isActive: true } }).catch(() => 0);
      return Math.min(100, 50 + count * 8);
    }
    case "META_AI": {
      const ctx = await prisma.metaContext.findFirst({ orderBy: { builtAt: "desc" }, select: { builtAt: true } });
      if (!ctx) return 40;
      const ageMs = Date.now() - ctx.builtAt.getTime();
      return Math.max(20, 100 - ageMs / 120_000);
    }
    default:
      return BASE_TRUST[sourceType] ?? 50;
  }
}

export async function updateSourceReliability() {
  const results = [];
  for (const sourceType of FUSION_SOURCES) {
    const freshness = await measureSourceFreshness(sourceType);
    const existing = await prisma.sourceConfidence.findUnique({ where: { sourceType } });
    const baseTrust = BASE_TRUST[sourceType];
    const historicalAccuracy = existing?.historicalAccuracy ?? baseTrust;
    const trustScore = Number(((baseTrust * 0.4 + freshness * 0.3 + historicalAccuracy * 0.3)).toFixed(1));
    const row = await upsertSourceConfidence(sourceType, trustScore, historicalAccuracy, (existing?.sampleCount ?? 0) + 1);
    results.push(row);
  }
  emitFusionEvent(FUSION_EVENT.SOURCE_RELIABILITY_UPDATED, { count: results.length });
  return results;
}

export async function getSourceReliabilityScores() {
  return prisma.sourceConfidence.findMany({ orderBy: { trustScore: "desc" } });
}
