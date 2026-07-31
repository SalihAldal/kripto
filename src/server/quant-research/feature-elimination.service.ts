import { prisma } from "@/src/server/db/prisma";
import type { FeatureResearchStatus } from "@prisma/client";
import {
  completeResearchRun,
  createResearchRun,
  ensureDefaultResearchProject,
  persistFeatureResearchRows,
} from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { benjaminiHochbergFdr } from "@/src/server/quant-research/statistical-validation.service";

export async function runFeatureElimination(input?: {
  experimentId?: string;
  windowDays?: number;
  correlationThreshold?: number;
}) {
  return researchDbOnly(async () => {
    const project = await ensureDefaultResearchProject();
    const windowDays = input?.windowDays ?? 90;
    const correlationThreshold = input?.correlationThreshold ?? 0.85;
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const run = await createResearchRun({
      projectId: project.id,
      runType: "FEATURE_ELIMINATE",
      windowDays,
      metadata: { experimentId: input?.experimentId, correlationThreshold },
    });

    const existing = await prisma.featureResearch.findMany({
      where: input?.experimentId ? { experimentId: input.experimentId } : { createdAt: { gte: since } },
      orderBy: { rank: "asc" },
      take: 100,
    });

    if (existing.length < 2) {
      await completeResearchRun(run.id, "Insufficient feature research rows for elimination");
      return { eliminated: [], redundant: [], correlated: [] };
    }

    const redundant: string[] = [];
    const correlated: Array<{ a: string; b: string; correlation: number }> = [];
    const lowValue = existing.filter((f) => f.status === "LOW_VALUE" || (f.importance ?? 0) < 0.05);

    for (let i = 0; i < existing.length; i++) {
      for (let j = i + 1; j < existing.length; j++) {
        const a = existing[i]!;
        const b = existing[j]!;
        const corr = estimateCorrelation(a, b);
        if (Math.abs(corr) >= correlationThreshold) {
          correlated.push({ a: a.featureKey, b: b.featureKey, correlation: corr });
          if ((a.importance ?? 0) >= (b.importance ?? 0)) redundant.push(b.featureKey);
          else redundant.push(a.featureKey);
        }
      }
    }

    const pValues = existing.map((f) => ({
      key: f.featureKey,
      pValue: Math.max(0.001, 1 - (f.importance ?? 0) / Math.max(1, existing[0]?.importance ?? 1)),
    }));
    const fdr = benjaminiHochbergFdr(pValues);

    const updates = existing.map((f) => {
      let status: FeatureResearchStatus = f.status;
      if (redundant.includes(f.featureKey)) status = "REDUNDANT";
      else if (correlated.some((c) => c.a === f.featureKey || c.b === f.featureKey)) status = "CORRELATED";
      else if ((f.importance ?? 0) < 0.05) status = "LOW_VALUE";
      else if ((f.importance ?? 0) > 1) status = "HIGH_VALUE";
      return {
        featureKey: f.featureKey,
        category: f.category,
        sampleSize: f.sampleSize,
        importance: f.importance,
        winRate: f.winRate,
        avgReturn: f.avgReturn,
        correlation: f.correlation,
        rank: f.rank,
        status,
      };
    });

    await persistFeatureResearchRows(input?.experimentId, updates);

    await completeResearchRun(
      run.id,
      `Feature elimination: ${redundant.length} redundant, ${correlated.length} correlated pairs`,
    );

    return {
      runId: run.id,
      lowValue: lowValue.map((f) => f.featureKey),
      redundant: [...new Set(redundant)],
      correlated,
      fdrRejected: fdr.features.filter((f) => !f.significant).map((f) => f.key),
      highValue: existing.filter((f) => (f.importance ?? 0) > 1).map((f) => f.featureKey),
    };
  });
}

function estimateCorrelation(
  a: { winRate: number | null; avgReturn: number | null; importance: number | null },
  b: { winRate: number | null; avgReturn: number | null; importance: number | null },
): number {
  const va = [a.winRate ?? 0, a.avgReturn ?? 0, a.importance ?? 0];
  const vb = [b.winRate ?? 0, b.avgReturn ?? 0, b.importance ?? 0];
  const meanA = va.reduce((s, v) => s + v, 0) / va.length;
  const meanB = vb.reduce((s, v) => s + v, 0) / vb.length;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < va.length; i++) {
    cov += (va[i]! - meanA) * (vb[i]! - meanB);
    varA += (va[i]! - meanA) ** 2;
    varB += (vb[i]! - meanB) ** 2;
  }
  const denom = Math.sqrt(varA * varB);
  return denom > 0 ? Number((cov / denom).toFixed(4)) : 0;
}
