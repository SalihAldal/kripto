import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import {
  completeResearchRun,
  createResearchRun,
  ensureDefaultResearchProject,
  persistResearchResult,
  updateResearchExperimentStatus,
} from "@/src/server/quant-research/quant-research.repository";
import { runBacktest } from "@/src/server/quant-research/backtesting-engine.service";
import { runCounterfactualAnalysis } from "@/src/server/quant-research/counterfactual-analysis.service";
import { runFeatureElimination } from "@/src/server/quant-research/feature-elimination.service";
import { runFeatureResearch } from "@/src/server/quant-research/feature-research.service";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { generateRecommendations } from "@/src/server/quant-research/recommendation-engine.service";
import { fetchReplayAccuracyMetrics } from "@/src/server/quant-research/replay-bridge.service";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { runStatisticalValidation } from "@/src/server/quant-research/statistical-validation.service";
import {
  createIsolatedExperiment,
  recordExperimentMetrics,
} from "@/src/server/quant-research/strategy-research-lab.service";
import { runStrategyBenchmark } from "@/src/server/quant-research/strategy-benchmark.service";
import { runWalkForwardValidation } from "@/src/server/quant-research/walk-forward-validation.service";
import type { StrategyArchetype } from "@prisma/client";

export async function runFullExperiment(input?: {
  strategyType?: StrategyArchetype;
  name?: string;
  author?: string;
  windowDays?: number;
}) {
  return researchDbOnly(async () => {
    if (!env.QUANT_RESEARCH_PLATFORM_ENABLED) {
      return { skipped: true, reason: "platform_disabled" };
    }

    const project = await ensureDefaultResearchProject();
    const windowDays = input?.windowDays ?? 90;
    const strategyType = input?.strategyType ?? "MOMENTUM";

    const run = await createResearchRun({
      projectId: project.id,
      runType: "EXPERIMENT_RUN",
      windowDays,
      metadata: { strategyType, author: input?.author },
    });

    const { experiment, genomeKey } = await createIsolatedExperiment({
      name: input?.name ?? `${strategyType} Full Pipeline ${Date.now()}`,
      strategyType,
      author: input?.author ?? "experiment-runner",
      hypothesis: `Full validation pipeline for isolated ${strategyType} strategy`,
    });

    await updateResearchExperimentStatus(experiment.experimentId, "RUNNING");

    const phases: Record<string, unknown> = {};

    await updateResearchExperimentStatus(experiment.experimentId, "TRAINING");
    const backtest = await runBacktest({ genomeId: genomeKey, windowDays });
    const trainingPassed = (backtest?.metrics?.profitFactor ?? 0) >= 1;
    await persistResearchResult({
      experimentId: experiment.id,
      runId: run.id,
      phase: "TRAINING",
      passed: trainingPassed,
      metrics: backtest?.metrics as Record<string, unknown>,
      verdict: trainingPassed ? "TRAINING_PASSED" : "TRAINING_FAILED",
    });
    phases.training = { passed: trainingPassed, backtest };

    await updateResearchExperimentStatus(experiment.experimentId, "VALIDATING");
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const trades = await prisma.learningTrade.findMany({
      where: { closedAt: { gte: since } },
      select: { returnPercent: true, holdSec: true },
      take: 3000,
    });
    const returns = trades.map((t) => Number(t.returnPercent ?? 0));
    const holdSecs = trades.map((t) => t.holdSec ?? 3600);
    const valMetrics = computePerformanceMetrics(returns.slice(Math.floor(returns.length * 0.7)));
    const validationPassed = valMetrics.profitFactor >= 1 && valMetrics.expectancy > 0;
    await persistResearchResult({
      experimentId: experiment.id,
      runId: run.id,
      phase: "VALIDATION",
      passed: validationPassed,
      metrics: valMetrics as unknown as Record<string, unknown>,
      verdict: validationPassed ? "VALIDATION_PASSED" : "VALIDATION_FAILED",
    });
    phases.validation = { passed: validationPassed, metrics: valMetrics };

    await updateResearchExperimentStatus(experiment.experimentId, "WALK_FORWARD");
    const walkForward = await runWalkForwardValidation({
      experimentId: experiment.id,
      genomeId: genomeKey,
      windowDays: windowDays * 2,
    });
    phases.walkForward = walkForward;

    await updateResearchExperimentStatus(experiment.experimentId, "SHADOW_SIM");
    const shadowMetrics = await runShadowSimulationReadOnly(windowDays);
    const shadowPassed = shadowMetrics.passed;
    await persistResearchResult({
      experimentId: experiment.id,
      runId: run.id,
      phase: "SHADOW_SIM",
      passed: shadowPassed,
      metrics: shadowMetrics,
      verdict: shadowPassed ? "SHADOW_PASSED" : "SHADOW_FAILED",
    });
    phases.shadow = shadowMetrics;

    const stats = await runStatisticalValidation({ experimentId: experiment.id, windowDays });
    phases.statistical = stats;

    await runFeatureResearch({ experimentId: experiment.id, windowDays });
    await runFeatureElimination({ experimentId: experiment.id, windowDays });
    await runStrategyBenchmark({ experimentId: experiment.id, windowDays });
    await runCounterfactualAnalysis({ experimentId: experiment.id, limit: 50, windowDays });

    await recordExperimentMetrics(experiment.id, returns, holdSecs);

    const allPassed = trainingPassed && validationPassed && walkForward.passed && shadowPassed && stats.passed;
    await updateResearchExperimentStatus(
      experiment.experimentId,
      allPassed ? "COMPLETED" : "FAILED",
    );

    let recommendations = null;
    if (allPassed) {
      recommendations = await generateRecommendations(experiment.experimentId);
    }

    await completeResearchRun(
      run.id,
      `Experiment ${experiment.experimentId}: ${allPassed ? "ALL GATES PASSED" : "FAILED"} — recommendations ${allPassed ? "generated" : "skipped"}`,
    );

    return {
      runId: run.id,
      experimentId: experiment.experimentId,
      allPassed,
      phases,
      recommendations,
    };
  });
}

async function runShadowSimulationReadOnly(windowDays: number) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const shadowTrades = await prisma.shadowTrade.findMany({
    where: { closedAt: { gte: since } },
    select: { virtualPnlPct: true, status: true },
    take: 2000,
  });

  const replay = await fetchReplayAccuracyMetrics(windowDays);

  if (shadowTrades.length < 10) {
    return {
      passed: replay.replayAccuracy >= 60,
      shadowTradeCount: shadowTrades.length,
      replayAccuracy: replay.replayAccuracy,
      note: "Insufficient shadow trades — used replay accuracy proxy",
    };
  }

  const returns = shadowTrades.map((t) => Number(t.virtualPnlPct ?? 0));
  const metrics = computePerformanceMetrics(returns);
  const passed = metrics.profitFactor >= 0.9 && replay.replayAccuracy >= 55;

  return {
    passed,
    shadowTradeCount: shadowTrades.length,
    replayAccuracy: replay.replayAccuracy,
    metrics,
  };
}
