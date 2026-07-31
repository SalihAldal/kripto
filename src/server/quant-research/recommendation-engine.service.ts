import type { ResearchRecommendationType } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import {
  completeResearchRun,
  createResearchRun,
  ensureDefaultResearchProject,
  persistResearchRecommendation,
} from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { RESEARCH_SANDBOX } from "@/src/server/quant-research/research-environment.service";

export async function generateRecommendations(experimentId?: string) {
  return researchDbOnly(async () => {
    const project = await ensureDefaultResearchProject();
    const run = await createResearchRun({
      projectId: project.id,
      runType: "RECOMMENDATION_GENERATE",
      metadata: { experimentId, sandbox: RESEARCH_SANDBOX },
    });

    const experiment = experimentId
      ? await prisma.researchExperiment.findUnique({
          where: { experimentId },
          include: {
            results: true,
            metrics: { orderBy: { createdAt: "desc" }, take: 1 },
            featureResearch: { where: { status: "HIGH_VALUE" }, take: 5 },
            strategyResearch: { where: { passedValidation: true }, orderBy: { rank: "asc" }, take: 3 },
          },
        })
      : null;

    const allResults = experiment?.results ?? [];
    const trainingPassed = allResults.some((r) => r.phase === "TRAINING" && r.passed);
    const validationPassed = allResults.some((r) => r.phase === "VALIDATION" && r.passed);
    const walkForwardPassed = allResults.some((r) => r.phase === "WALK_FORWARD" && r.passed);
    const shadowPassed = allResults.some((r) => r.phase === "SHADOW_SIM" && r.passed);
    const statsPassed = allResults.some((r) => r.phase === "STATISTICAL_VALIDATION" && r.passed);

    const pipelineComplete =
      !experimentId ||
      (trainingPassed && validationPassed && walkForwardPassed && shadowPassed && statsPassed);

    const recommendations: Array<{
      experimentId?: string;
      recommendationType: ResearchRecommendationType;
      title: string;
      summary: string;
      expectedImprovement: number;
      confidence: number;
      evidence: Record<string, unknown>;
    }> = [];

    if (experiment?.strategyResearch[0]) {
      const top = experiment.strategyResearch[0];
      const metrics = top.metrics as Record<string, number> | null;
      recommendations.push({
        experimentId: experiment.id,
        recommendationType: "NEW_STRATEGY",
        title: `Consider ${top.strategyType} strategy variant`,
        summary: `Research sandbox suggests ${top.strategyType} with benchmark score ${top.benchmarkScore?.toFixed(2)}. Does NOT modify production.`,
        expectedImprovement: Number(((metrics?.expectancy ?? 0) * 100).toFixed(2)),
        confidence: pipelineComplete ? 0.85 : 0.45,
        evidence: { genomeId: top.genomeId, metrics: top.metrics, pipelineComplete, sandbox: RESEARCH_SANDBOX },
      });
    }

    if (experiment?.featureResearch[0]) {
      const feat = experiment.featureResearch[0];
      recommendations.push({
        experimentId: experiment?.id,
        recommendationType: "NEW_FEATURE",
        title: `Add ${feat.featureKey} to feature set`,
        summary: `Feature ${feat.featureKey} ranked #${feat.rank} with importance ${feat.importance?.toFixed(3)}. Recommendation only.`,
        expectedImprovement: Number(((feat.avgReturn ?? 0) * 10).toFixed(2)),
        confidence: pipelineComplete ? 0.75 : 0.4,
        evidence: { featureKey: feat.featureKey, winRate: feat.winRate, importance: feat.importance },
      });
    }

    if (experiment?.metrics[0]) {
      const m = experiment.metrics[0];
      recommendations.push({
        experimentId: experiment.id,
        recommendationType: "NEW_THRESHOLD",
        title: "Adjust entry confidence threshold",
        summary: `Based on experiment metrics PF=${m.profitFactor?.toFixed(2)} Sharpe=${m.sharpe?.toFixed(2)}. Threshold change is advisory only.`,
        expectedImprovement: Number(((m.expectancy ?? 0) * 50).toFixed(2)),
        confidence: pipelineComplete ? 0.7 : 0.35,
        evidence: { profitFactor: m.profitFactor, sharpe: m.sharpe, winRate: m.winRate },
      });
    }

    if (pipelineComplete && experiment) {
      recommendations.push({
        experimentId: experiment.id,
        recommendationType: "NEW_MODEL",
        title: "Train challenger model from experiment evidence",
        summary: "Experiment passed all validation gates. Candidate model training recommended via Learning Platform — no auto-promotion.",
        expectedImprovement: Number(((experiment.metrics[0]?.expectancy ?? 0) * 100).toFixed(2)),
        confidence: 0.8,
        evidence: {
          gates: { trainingPassed, validationPassed, walkForwardPassed, shadowPassed, statsPassed },
          experimentId: experiment.experimentId,
        },
      });
    }

    const persisted = [];
    for (const rec of recommendations) {
      const row = await persistResearchRecommendation(rec);
      persisted.push(row);
    }

    await completeResearchRun(run.id, `Generated ${persisted.length} recommendations (advisory only)`);
    return { runId: run.id, pipelineComplete, recommendations: persisted };
  });
}

export async function listRecommendations(limit = 30, status = "PENDING") {
  return researchDbOnly(async () => {
    return prisma.researchRecommendation.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { experiment: { select: { experimentId: true, name: true, strategyType: true } } },
    });
  });
}
