import type { StrategyArchetype } from "@prisma/client";
import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import {
  createResearchExperiment,
  persistExperimentMetrics,
  persistStrategyGenome,
  persistStrategyResearch,
} from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { buildGenomeSpec, generateStrategies } from "@/src/server/quant-research/strategy-generator.service";
import { RESEARCH_STRATEGY_TYPES } from "@/src/server/quant-research/counterfactual-analysis.service";

export type CreateExperimentInput = {
  name: string;
  strategyType: StrategyArchetype;
  author?: string;
  hypothesis?: string;
  strategyVersion?: string;
  featureVersion?: string;
  datasetVersion?: string;
  config?: Record<string, unknown>;
};

export async function createIsolatedExperiment(input: CreateExperimentInput) {
  return researchDbOnly(async () => {
    const experimentId = `exp_${input.strategyType.toLowerCase()}_${Date.now()}`;
    const genome = buildGenomeSpec(input.strategyType, 0, 1);
    await persistStrategyGenome(genome);

    const experiment = await createResearchExperiment({
      experimentId,
      name: input.name,
      strategyType: input.strategyType,
      strategyVersion: input.strategyVersion ?? "1.0.0",
      featureVersion: input.featureVersion ?? env.QUANT_RESEARCH_FEATURE_VERSION,
      datasetVersion: input.datasetVersion ?? env.QUANT_RESEARCH_DATASET_VERSION,
      author: input.author ?? "system",
      genomeId: genome.genomeKey,
      hypothesis: input.hypothesis,
      config: {
        ...input.config,
        isolated: true,
        affectsProduction: false,
        genomeKey: genome.genomeKey,
      },
    });

    await persistStrategyResearch({
      experimentId: experiment.id,
      genomeId: genome.genomeKey,
      strategyType: input.strategyType,
      strategyVersion: input.strategyVersion ?? "1.0.0",
    });

    return { experiment, genomeKey: genome.genomeKey };
  });
}

export async function seedStrategyResearchLab(batchSize?: number) {
  return researchDbOnly(async () => {
    const count = batchSize ?? env.QUANT_RESEARCH_EXPERIMENT_BATCH_SIZE;
    const created = [];

    for (let i = 0; i < count; i++) {
      const strategyType = RESEARCH_STRATEGY_TYPES[i % RESEARCH_STRATEGY_TYPES.length]!;
      const result = await createIsolatedExperiment({
        name: `${strategyType.replace(/_/g, " ")} Research Lab ${Date.now()}_${i}`,
        strategyType,
        hypothesis: `Isolated ${strategyType} experiment — no production impact`,
        author: "research-lab",
      });
      created.push(result);
    }

    await generateStrategies(count, RESEARCH_STRATEGY_TYPES);
    return { created: created.length, experiments: created.map((c) => c.experiment.experimentId) };
  });
}

export async function listResearchExperiments(limit = 50) {
  return researchDbOnly(async () => {
    return prisma.researchExperiment.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        metrics: { orderBy: { createdAt: "desc" }, take: 1 },
        results: { orderBy: { createdAt: "desc" }, take: 5 },
        recommendations: { where: { status: "PENDING" }, take: 3 },
      },
    });
  });
}

export async function getExperimentById(experimentId: string) {
  return researchDbOnly(async () => {
    return prisma.researchExperiment.findUnique({
      where: { experimentId },
      include: {
        metrics: true,
        results: true,
        counterfactuals: { take: 20, orderBy: { createdAt: "desc" } },
        walkForwardResults: { orderBy: [{ mode: "asc" }, { foldIndex: "asc" }] },
        featureResearch: { orderBy: { rank: "asc" }, take: 30 },
        strategyResearch: { orderBy: { rank: "asc" } },
        recommendations: { orderBy: { createdAt: "desc" } },
      },
    });
  });
}

export async function recordExperimentMetrics(experimentId: string, returns: number[], holdSecs: number[]) {
  return researchDbOnly(async () => {
    const { computePerformanceMetrics } = await import("@/src/server/quant-research/performance-metrics.service");
    const metrics = computePerformanceMetrics(returns);
    const wins = returns.filter((r) => r > 0);
    const losses = returns.filter((r) => r < 0);
    const avgHoldSec = holdSecs.length > 0 ? holdSecs.reduce((s, h) => s + h, 0) / holdSecs.length : 0;

    const row = await persistExperimentMetrics({
      experimentId,
      profitFactor: metrics.profitFactor,
      expectancy: metrics.expectancy,
      sharpe: metrics.sharpe,
      sortino: metrics.sortino,
      winRate: metrics.winRate,
      avgProfit: wins.length > 0 ? wins.reduce((s, r) => s + r, 0) / wins.length : 0,
      avgLoss: losses.length > 0 ? losses.reduce((s, r) => s + r, 0) / losses.length : 0,
      maxDrawdownPct: metrics.maxDrawdownPct,
      avgHoldSec,
      tradeCount: metrics.tradeCount,
      metrics: metrics as unknown as Record<string, unknown>,
    });

    await prisma.researchExperiment.update({
      where: { id: experimentId },
      data: { status: "COMPLETED" },
    });
    return row;
  });
}
