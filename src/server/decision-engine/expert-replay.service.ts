import type { ExpertType } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import { runAllExperts } from "@/src/server/decision-engine/experts/expert-runner.service";
import { buildAIInput } from "@/src/server/ai/analysis-orchestrator";
import {
  buildDecisionMatrix,
  computeConsensusMetrics,
  detectConflicts,
  mapMasterToLegacy,
  resolveMasterDecision,
} from "@/src/server/decision-engine/conflict-detection.service";

export async function replayExpertsForDecision(decisionId: string) {
  const storedOpinions = await prisma.expertOpinion.findMany({ where: { decisionId } });
  const consensus = await prisma.consensusDecision.findUnique({ where: { decisionId } });
  if (!consensus) return { decisionId, status: "MISSING" as const };

  try {
    const input = await buildAIInput(consensus.symbol);
    const replayed = await runAllExperts(input);
    const matrix = buildDecisionMatrix(replayed);
    const conflicts = detectConflicts(replayed);
    const metrics = computeConsensusMetrics(replayed, conflicts);
    const decision = resolveMasterDecision({ matrix, metrics, opinions: replayed, conflicts });
    const legacyDecision = mapMasterToLegacy(decision);

    await prisma.decisionEngineJobState.upsert({
      where: { jobType: "EXPERT_REPLAY" },
      create: {
        jobType: "EXPERT_REPLAY",
        status: "COMPLETED",
        lastProcessedAt: new Date(),
        metadata: { decisionId, replayed: replayed.length, decision, legacyDecision } as Prisma.InputJsonValue,
      },
      update: {
        status: "COMPLETED",
        lastProcessedAt: new Date(),
        metadata: { decisionId, replayed: replayed.length, decision, legacyDecision } as Prisma.InputJsonValue,
      },
    });

    return {
      decisionId,
      status: "COMPLETED" as const,
      originalDecision: consensus.decision,
      replayDecision: decision,
      legacyDecision,
      matrix,
      metrics,
      storedOpinions,
      opinions: replayed,
    };
  } catch (error) {
    return { decisionId, status: "FAILED" as const, error: (error as Error).message, storedOpinions };
  }
}

export async function computeExpertPerformance(periodDays = 7) {
  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);
  const expertTypes: ExpertType[] = ["MARKET", "MOMENTUM", "VOLUME", "LIQUIDITY", "RISK", "NEWS", "EXECUTION", "LEARNING"];

  for (const expertType of expertTypes) {
    const rows = await prisma.expertOpinion.findMany({
      where: { expertType, createdAt: { gte: periodStart, lte: periodEnd } },
      take: 500,
    });
    if (rows.length === 0) continue;

    const bullish = rows.filter((row) => row.opinion === "BUY" || row.opinion === "WEAK_BUY").length;
    const bearish = rows.filter((row) => row.opinion === "SELL" || row.opinion === "WEAK_SELL").length;
    const avgConfidence = rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length;
    const winRate = (bullish / Math.max(rows.length, 1)) * 100;
    const precision = bullish / Math.max(bullish + bearish, 1);
    const recall = bullish / Math.max(rows.length, 1);
    const falsePositive = bearish / Math.max(rows.length, 1);
    const falseNegative = rows.filter((row) => row.opinion === "HOLD").length / Math.max(rows.length, 1);

    await prisma.expertPerformance.create({
      data: {
        expertType,
        periodStart,
        periodEnd,
        accuracy: avgConfidence,
        winRate,
        profitFactor: Number((winRate / Math.max(falsePositive * 100, 1)).toFixed(4)),
        precision,
        recall,
        falsePositive,
        falseNegative,
        sampleSize: rows.length,
        metadata: { bullish, bearish },
      },
    });
  }

  return prisma.expertPerformance.findMany({
    where: { periodEnd: { gte: periodStart } },
    orderBy: { computedAt: "desc" },
  });
}

export async function computeExpertWeightRecommendations() {
  const performances = await prisma.expertPerformance.findMany({
    orderBy: { computedAt: "desc" },
    take: 40,
  });
  const byExpert = new Map<string, typeof performances>();
  for (const row of performances) {
    const bucket = byExpert.get(row.expertType) ?? [];
    bucket.push(row);
    byExpert.set(row.expertType, bucket);
  }

  const recommendations = [];
  for (const [expertType, rows] of byExpert.entries()) {
    const latest = rows[0];
    if (!latest) continue;
    const currentWeight = 1;
    const recommendedWeight = Number(Math.max(0.5, Math.min(1.5, (latest.accuracy ?? 50) / 100)).toFixed(4));
    const rec = await prisma.expertRecommendation.create({
      data: {
        expertType: expertType as ExpertType,
        currentWeight,
        recommendedWeight,
        rationale: `Recommend weight ${recommendedWeight} based on accuracy=${latest.accuracy?.toFixed(1)} winRate=${latest.winRate?.toFixed(1)} samples=${latest.sampleSize}`,
        sampleSize: latest.sampleSize,
        confidence: latest.accuracy,
      },
    });
    recommendations.push(rec);
  }
  return recommendations;
}
