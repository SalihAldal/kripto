import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import { createModelCandidate } from "@/src/server/learning-platform/learning-platform.repository";
import {
  compareRuleVsMlShadow,
  getMlShadowTradeCount,
} from "@/src/server/decision-engine-v2/shadow-integration.service";
import { getModelRegistry, getLatestModelMetrics } from "@/src/server/decision-engine-v2/decision-engine-v2.repository";
import { emitLearningPlatformEvent, LEARNING_PLATFORM_EVENT } from "@/src/server/learning-platform/learning-platform.events";

export async function evaluatePromotionCandidate(modelId: string) {
  const registry = await getModelRegistry();
  const shadowTradeCount = await getMlShadowTradeCount();
  const comparison = await compareRuleVsMlShadow(30);
  const championMetrics = registry.championModelId
    ? await getLatestModelMetrics(registry.championModelId)
    : [];

  const championPf = championMetrics[0]
    ? Number((championMetrics[0].metrics as Record<string, unknown> | null)?.profitFactor ?? 1)
    : comparison.rule.profitFactor;
  const championMdd = championMetrics[0]
    ? Number((championMetrics[0].metrics as Record<string, unknown> | null)?.maxDrawdown ?? comparison.rule.maxDrawdown)
    : comparison.rule.maxDrawdown;

  const blockers: string[] = [];
  const minShadow = env.LEARNING_PLATFORM_PROMOTION_MIN_SHADOW_TRADES;

  if (shadowTradeCount < minShadow) {
    blockers.push(`shadowTrades<${minShadow}`);
  }
  if (comparison.ml.profitFactor <= championPf) {
    blockers.push("profitFactor<=champion");
  }
  if (comparison.ml.expectancy <= 0) {
    blockers.push("expectancy<=0");
  }
  if (comparison.ml.maxDrawdown > championMdd) {
    blockers.push("maxDrawdown>champion");
  }
  if (comparison.ml.profitFactor < 0.5) {
    blockers.push("catastrophic_profit_factor");
  }

  const meetsCriteria = blockers.length === 0;
  const status = meetsCriteria ? "ELIGIBLE" as const : "INELIGIBLE" as const;
  const role = meetsCriteria ? "CHALLENGER" as const : "EXPERIMENTAL" as const;

  const existing = await prisma.modelCandidate.findFirst({
    where: { modelId, status: { in: ["PENDING", "ELIGIBLE", "INELIGIBLE"] } },
    orderBy: { createdAt: "desc" },
  });

  const candidate = existing
    ? await prisma.modelCandidate.update({
        where: { id: existing.id },
        data: {
          status,
          role,
          shadowTradeCount,
          profitFactor: comparison.ml.profitFactor,
          expectancy: comparison.ml.expectancy,
          maxDrawdown: comparison.ml.maxDrawdown,
          winRate: comparison.ml.winRate,
          promotionBlockers: blockers,
          meetsCriteria,
          evaluatedAt: new Date(),
          metadata: { comparison, championPf, championMdd, note: "candidate_only_no_auto_promote" },
        },
      })
    : await createModelCandidate({
        modelId,
        role,
        status,
        shadowTradeCount,
        profitFactor: comparison.ml.profitFactor,
        expectancy: comparison.ml.expectancy,
        maxDrawdown: comparison.ml.maxDrawdown,
        winRate: comparison.ml.winRate,
        promotionBlockers: blockers,
        meetsCriteria,
        metadata: { comparison, championPf, championMdd, note: "candidate_only_no_auto_promote" },
      });

  emitLearningPlatformEvent(LEARNING_PLATFORM_EVENT.CANDIDATE_EVALUATED, {
    modelId,
    candidateId: candidate.id,
    meetsCriteria,
    blockers,
  });

  return { candidate, meetsCriteria, blockers, shadowTradeCount, comparison };
}

export async function rollbackCandidateToArchive(modelId: string, reason: string) {
  const updated = await prisma.modelCandidate.updateMany({
    where: { modelId, status: { in: ["ELIGIBLE", "PENDING"] } },
    data: { status: "ROLLED_BACK", metadata: { rollbackReason: reason, rolledBackAt: new Date().toISOString() } },
  });
  return { rolledBack: updated.count, modelId, reason };
}

export async function listPromotionCandidates(limit = 20) {
  return prisma.modelCandidate.findMany({
    where: { status: { in: ["ELIGIBLE", "PENDING", "INELIGIBLE"] } },
    include: { model: true, trainingDataset: true },
    orderBy: { evaluatedAt: "desc" },
    take: limit,
  });
}
