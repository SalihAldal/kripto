import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type {
  PerformanceMetrics,
  StrategyGenomeSpec,
} from "@/src/server/quant-research/quant-research.types";

export async function ensureDefaultResearchProject() {
  const existing = await prisma.researchProject.findFirst({ where: { name: "Default Sandbox" } });
  if (existing) return existing;
  return prisma.researchProject.create({
    data: {
      name: "Default Sandbox",
      description: "Isolated quant research sandbox — no production side effects",
      status: "COMPLETED",
      metadata: { isolated: true, affectsProduction: false },
    },
  });
}

export async function createResearchRun(input: {
  projectId: string;
  runType: string;
  windowDays?: number;
  metadata?: Record<string, unknown>;
}) {
  return prisma.researchRun.create({
    data: {
      projectId: input.projectId,
      runType: input.runType,
      windowDays: input.windowDays,
      status: "RUNNING",
      startedAt: new Date(),
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function completeResearchRun(runId: string, summary?: string, metadata?: Record<string, unknown>) {
  return prisma.researchRun.update({
    where: { id: runId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      summary,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistStrategyGenome(spec: StrategyGenomeSpec) {
  return prisma.strategyGenome.upsert({
    where: { genomeKey: spec.genomeKey },
    create: {
      genomeKey: spec.genomeKey,
      name: spec.name,
      archetype: spec.archetype,
      generation: spec.generation,
      indicators: spec.indicators as Prisma.InputJsonValue,
      parameters: spec.parameters as Prisma.InputJsonValue,
      rules: spec.rules as Prisma.InputJsonValue,
      parentGenome: spec.parentGenome,
    },
    update: {
      name: spec.name,
      indicators: spec.indicators as Prisma.InputJsonValue,
      parameters: spec.parameters as Prisma.InputJsonValue,
      rules: spec.rules as Prisma.InputJsonValue,
      generation: spec.generation,
    },
  });
}

export async function persistStrategyCandidate(input: {
  genomeId: string;
  candidateKey: string;
  rank?: number;
  score?: number;
  metrics?: PerformanceMetrics;
  promotionStatus?: "NOT_ELIGIBLE" | "UNDER_REVIEW" | "ELIGIBLE" | "REJECTED" | "PROMOTED";
  blockers?: string[];
}) {
  return prisma.strategyCandidate.upsert({
    where: { candidateKey: input.candidateKey },
    create: {
      genomeId: input.genomeId,
      candidateKey: input.candidateKey,
      rank: input.rank,
      score: input.score,
      metrics: input.metrics as unknown as Prisma.InputJsonValue,
      promotionStatus: input.promotionStatus ?? "NOT_ELIGIBLE",
      blockers: input.blockers as Prisma.InputJsonValue,
    },
    update: {
      rank: input.rank,
      score: input.score,
      metrics: input.metrics as unknown as Prisma.InputJsonValue,
      promotionStatus: input.promotionStatus,
      blockers: input.blockers as Prisma.InputJsonValue,
    },
  });
}

export async function createExperiment(input: {
  projectId: string;
  name: string;
  hypothesis?: string;
  config?: Record<string, unknown>;
}) {
  return prisma.experiment.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      hypothesis: input.hypothesis,
      status: "RUNNING",
      config: input.config as Prisma.InputJsonValue,
    },
  });
}

export async function persistExperimentResult(input: {
  experimentId: string;
  runId?: string;
  genomeId?: string;
  metrics?: Record<string, unknown>;
  verdict?: string;
}) {
  return prisma.experimentResult.create({
    data: {
      experimentId: input.experimentId,
      runId: input.runId,
      genomeId: input.genomeId,
      metrics: input.metrics as Prisma.InputJsonValue,
      verdict: input.verdict,
    },
  });
}

export async function persistBenchmark(input: {
  benchmarkType: "BUY_AND_HOLD" | "BTC" | "ETH" | "SIMPLE_EMA" | "SIMPLE_RSI" | "RANDOM_ENTRY" | "PRODUCTION" | "CUSTOM";
  symbol?: string;
  genomeId?: string;
  windowDays?: number;
  metrics?: Record<string, unknown>;
  comparison?: Record<string, unknown>;
}) {
  return prisma.benchmark.create({
    data: {
      benchmarkType: input.benchmarkType,
      symbol: input.symbol,
      genomeId: input.genomeId,
      windowDays: input.windowDays,
      metrics: input.metrics as Prisma.InputJsonValue,
      comparison: input.comparison as Prisma.InputJsonValue,
    },
  });
}

export async function persistResearchReport(input: {
  cadence: "DAILY" | "WEEKLY" | "MONTHLY";
  reportDate: Date;
  title: string;
  summary?: string;
  content: Record<string, unknown>;
}) {
  return prisma.researchReport.upsert({
    where: { cadence_reportDate: { cadence: input.cadence, reportDate: input.reportDate } },
    create: {
      cadence: input.cadence,
      reportDate: input.reportDate,
      title: input.title,
      summary: input.summary,
      content: input.content as Prisma.InputJsonValue,
    },
    update: {
      title: input.title,
      summary: input.summary,
      content: input.content as Prisma.InputJsonValue,
    },
  });
}

export async function persistSimulationRun(input: {
  runId: string;
  genomeId?: string;
  windowDays: number;
  tradeCount: number;
  metrics?: Record<string, unknown>;
}) {
  return prisma.simulationRun.create({
    data: {
      runId: input.runId,
      genomeId: input.genomeId,
      windowDays: input.windowDays,
      tradeCount: input.tradeCount,
      metrics: input.metrics as Prisma.InputJsonValue,
      status: "COMPLETED",
      startedAt: new Date(),
      completedAt: new Date(),
    },
  });
}

export async function persistWalkForwardRun(input: {
  runId: string;
  genomeId?: string;
  folds: number;
  passed: boolean;
  metrics?: Record<string, unknown>;
  foldResults?: unknown[];
}) {
  return prisma.walkForwardRun.create({
    data: {
      runId: input.runId,
      genomeId: input.genomeId,
      folds: input.folds,
      passed: input.passed,
      metrics: input.metrics as Prisma.InputJsonValue,
      foldResults: input.foldResults as Prisma.InputJsonValue,
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });
}

export async function persistMonteCarloRun(input: {
  runId: string;
  genomeId?: string;
  iterations: number;
  passed: boolean;
  metrics?: Record<string, unknown>;
  distribution?: Record<string, unknown>;
}) {
  return prisma.monteCarloRun.create({
    data: {
      runId: input.runId,
      genomeId: input.genomeId,
      iterations: input.iterations,
      passed: input.passed,
      metrics: input.metrics as Prisma.InputJsonValue,
      distribution: input.distribution as Prisma.InputJsonValue,
      status: "COMPLETED",
      completedAt: new Date(),
    },
  });
}

export async function persistStrategyEvolution(input: {
  genomeId: string;
  generation: number;
  parentGenomeId?: string;
  mutationType?: string;
  fitnessScore?: number;
  survived: boolean;
}) {
  return prisma.strategyEvolution.create({
    data: {
      genomeId: input.genomeId,
      generation: input.generation,
      parentGenomeId: input.parentGenomeId,
      mutationType: input.mutationType,
      fitnessScore: input.fitnessScore,
      survived: input.survived,
    },
  });
}

export async function persistResearchKnowledge(input: {
  category: string;
  title: string;
  content: string;
  tags?: string[];
  refType?: string;
  refId?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.quantResearchKnowledge.create({
    data: {
      category: input.category,
      title: input.title,
      content: input.content,
      tags: input.tags ?? [],
      refType: input.refType,
      refId: input.refId,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function getResearchDashboard() {
  const [projects, genomes, candidates, experiments, benchmarks, reports, simulations, evolutions] = await Promise.all([
    prisma.researchProject.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { runs: { take: 5, orderBy: { createdAt: "desc" } } } }),
    prisma.strategyGenome.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.strategyCandidate.findMany({ orderBy: { score: "desc" }, take: 30 }),
    prisma.experiment.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { results: { take: 3, orderBy: { createdAt: "desc" } } } }),
    prisma.benchmark.findMany({ orderBy: { recordedAt: "desc" }, take: 30 }),
    prisma.researchReport.findMany({ orderBy: { reportDate: "desc" }, take: 10 }),
    prisma.simulationRun.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.strategyEvolution.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return { projects, genomes, candidates, experiments, benchmarks, reports, simulations, evolutions };
}

export async function searchResearchKnowledge(query: string, limit = 30) {
  const q = query.trim().toLowerCase();
  const rows = await prisma.quantResearchKnowledge.findMany({ orderBy: { createdAt: "desc" }, take: 300 });
  return rows
    .filter(
      (row) =>
        row.title.toLowerCase().includes(q) ||
        row.content.toLowerCase().includes(q) ||
        row.tags.some((tag) => tag.toLowerCase().includes(q)),
    )
    .slice(0, limit);
}

export async function listStrategyExplorer(limit = 100) {
  return prisma.strategyGenome.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { candidates: { orderBy: { score: "desc" }, take: 1 } },
  });
}

export async function createResearchExperiment(input: {
  experimentId: string;
  name: string;
  strategyType: import("@prisma/client").StrategyArchetype;
  strategyVersion: string;
  featureVersion: string;
  datasetVersion: string;
  author?: string;
  genomeId?: string;
  hypothesis?: string;
  config?: Record<string, unknown>;
  projectId?: string;
}) {
  return prisma.researchExperiment.create({
    data: {
      experimentId: input.experimentId,
      projectId: input.projectId,
      name: input.name,
      strategyType: input.strategyType,
      strategyVersion: input.strategyVersion,
      featureVersion: input.featureVersion,
      datasetVersion: input.datasetVersion,
      author: input.author ?? "system",
      genomeId: input.genomeId,
      hypothesis: input.hypothesis,
      status: "DRAFT",
      config: input.config as Prisma.InputJsonValue,
      metadata: { isolated: true, affectsProduction: false } as Prisma.InputJsonValue,
    },
  });
}

export async function updateResearchExperimentStatus(
  experimentId: string,
  status: import("@prisma/client").ResearchExperimentStatus,
) {
  return prisma.researchExperiment.update({
    where: { experimentId },
    data: { status },
  });
}

export async function persistResearchResult(input: {
  experimentId: string;
  runId?: string;
  phase: string;
  passed?: boolean;
  metrics?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
  verdict?: string;
}) {
  return prisma.researchResult.create({
    data: {
      experimentId: input.experimentId,
      runId: input.runId,
      phase: input.phase,
      passed: input.passed ?? false,
      metrics: input.metrics as Prisma.InputJsonValue,
      evidence: input.evidence as Prisma.InputJsonValue,
      verdict: input.verdict,
    },
  });
}

export async function persistCounterfactualResults(
  experimentId: string | undefined,
  rows: Array<{
    tradeId: string;
    learningTradeId: string;
    decisionId: string | null;
    scenario: import("@prisma/client").CounterfactualScenario;
    baselineReturnPct: number;
    alternativeReturnPct: number;
    alternativeDrawdownPct: number;
    alternativeWinRate: number;
    alternativeRR: number;
    alternativeHoldSec: number;
    metrics?: Record<string, unknown>;
    evidence?: Record<string, unknown>;
  }>,
) {
  if (rows.length === 0) return [];
  const created = await prisma.counterfactualResult.createMany({
    data: rows.map((row) => ({
      experimentId,
      tradeId: row.tradeId,
      learningTradeId: row.learningTradeId,
      decisionId: row.decisionId,
      scenario: row.scenario,
      baselineReturnPct: row.baselineReturnPct,
      alternativeReturnPct: row.alternativeReturnPct,
      alternativeDrawdownPct: row.alternativeDrawdownPct,
      alternativeWinRate: row.alternativeWinRate,
      alternativeRR: row.alternativeRR,
      alternativeHoldSec: row.alternativeHoldSec,
      metrics: row.metrics as Prisma.InputJsonValue,
      evidence: row.evidence as Prisma.InputJsonValue,
    })),
  });
  return rows.slice(0, created.count);
}

export async function persistWalkForwardResults(
  experimentId: string | undefined,
  runId: string,
  folds: Array<{
    mode: import("@prisma/client").WalkForwardMode;
    foldIndex: number;
    trainStart: Date;
    trainEnd: Date;
    testStart: Date;
    testEnd: Date;
    trainMetrics: Record<string, unknown>;
    testMetrics: Record<string, unknown>;
    passed: boolean;
    purgeGapDays?: number;
  }>,
) {
  if (folds.length === 0) return [];
  await prisma.walkForwardResult.createMany({
    data: folds.map((fold) => ({
      experimentId,
      runId,
      mode: fold.mode,
      foldIndex: fold.foldIndex,
      trainStart: fold.trainStart,
      trainEnd: fold.trainEnd,
      testStart: fold.testStart,
      testEnd: fold.testEnd,
      trainMetrics: fold.trainMetrics as Prisma.InputJsonValue,
      testMetrics: fold.testMetrics as Prisma.InputJsonValue,
      passed: fold.passed,
      purgeGapDays: fold.purgeGapDays,
    })),
  });
  return folds;
}

export async function persistFeatureResearchRows(
  experimentId: string | undefined,
  rows: Array<{
    featureKey: string;
    category?: string | null;
    sampleSize: number;
    importance?: number | null;
    winRate?: number | null;
    avgReturn?: number | null;
    correlation?: number | null;
    rank?: number | null;
    status?: import("@prisma/client").FeatureResearchStatus | string;
  }>,
) {
  const created = [];
  for (const row of rows) {
    const record = await prisma.featureResearch.create({
      data: {
        experimentId,
        featureKey: row.featureKey,
        category: row.category,
        sampleSize: row.sampleSize,
        importance: row.importance,
        winRate: row.winRate,
        avgReturn: row.avgReturn,
        correlation: row.correlation,
        rank: row.rank,
        status: (row.status as import("@prisma/client").FeatureResearchStatus) ?? "ACTIVE",
      },
    });
    created.push(record);
  }
  return created;
}

export async function persistStrategyResearch(input: {
  experimentId?: string;
  genomeId?: string;
  strategyType: import("@prisma/client").StrategyArchetype;
  strategyVersion: string;
  benchmarkScore?: number;
  metrics?: Record<string, unknown>;
  rank?: number;
  passedValidation?: boolean;
}) {
  return prisma.strategyResearch.create({
    data: {
      experimentId: input.experimentId,
      genomeId: input.genomeId,
      strategyType: input.strategyType,
      strategyVersion: input.strategyVersion,
      benchmarkScore: input.benchmarkScore,
      metrics: input.metrics as Prisma.InputJsonValue,
      rank: input.rank,
      passedValidation: input.passedValidation ?? false,
    },
  });
}

export async function persistExperimentMetrics(input: {
  experimentId: string;
  profitFactor?: number;
  expectancy?: number;
  sharpe?: number;
  sortino?: number;
  winRate?: number;
  avgProfit?: number;
  avgLoss?: number;
  maxDrawdownPct?: number;
  avgHoldSec?: number;
  tradeCount?: number;
  metrics?: Record<string, unknown>;
}) {
  return prisma.experimentMetrics.create({
    data: {
      experimentId: input.experimentId,
      profitFactor: input.profitFactor,
      expectancy: input.expectancy,
      sharpe: input.sharpe,
      sortino: input.sortino,
      winRate: input.winRate,
      avgProfit: input.avgProfit,
      avgLoss: input.avgLoss,
      maxDrawdownPct: input.maxDrawdownPct,
      avgHoldSec: input.avgHoldSec,
      tradeCount: input.tradeCount ?? 0,
      metrics: input.metrics as Prisma.InputJsonValue,
    },
  });
}

export async function persistResearchRecommendation(input: {
  experimentId?: string;
  recommendationType: import("@prisma/client").ResearchRecommendationType;
  title: string;
  summary?: string;
  expectedImprovement?: number;
  confidence?: number;
  evidence?: Record<string, unknown>;
}) {
  return prisma.researchRecommendation.create({
    data: {
      experimentId: input.experimentId,
      recommendationType: input.recommendationType,
      title: input.title,
      summary: input.summary,
      expectedImprovement: input.expectedImprovement,
      confidence: input.confidence,
      evidence: input.evidence as Prisma.InputJsonValue,
      status: "PENDING",
    },
  });
}

export async function getResearchPlatformDashboard() {
  const [
    experiments,
    recommendations,
    counterfactuals,
    walkForwardResults,
    featureResearch,
    strategyResearch,
    jobStates,
  ] = await Promise.all([
    prisma.researchExperiment.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { metrics: { orderBy: { createdAt: "desc" }, take: 1 }, results: { take: 5 } },
    }),
    prisma.researchRecommendation.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.counterfactualResult.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.walkForwardResult.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.featureResearch.findMany({ orderBy: { rank: "asc" }, take: 25 }),
    prisma.strategyResearch.findMany({ orderBy: { rank: "asc" }, take: 25 }),
    prisma.quantResearchJobState.findMany({ orderBy: { updatedAt: "desc" } }),
  ]);

  const base = await getResearchDashboard();
  return {
    ...base,
    experiments,
    recommendations,
    counterfactuals,
    walkForwardResults,
    featureResearch,
    strategyResearch,
    jobStates,
    sandbox: { isolated: true, affectsProduction: false },
  };
}
