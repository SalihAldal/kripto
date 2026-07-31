import type { WalkForwardMode } from "@prisma/client";
import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import {
  completeResearchRun,
  createResearchRun,
  ensureDefaultResearchProject,
  persistResearchResult,
  persistWalkForwardResults,
} from "@/src/server/quant-research/quant-research.repository";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";

type TradePoint = { closedAt: Date; returnPct: number };

const MODES: WalkForwardMode[] = ["ROLLING", "EXPANDING", "PURGED", "TIME_SERIES"];

export async function runWalkForwardValidation(input?: {
  experimentId?: string;
  genomeId?: string;
  folds?: number;
  windowDays?: number;
  modes?: WalkForwardMode[];
  purgeGapDays?: number;
}) {
  return researchDbOnly(async () => {
    const project = await ensureDefaultResearchProject();
    const folds = input?.folds ?? env.QUANT_RESEARCH_WALK_FORWARD_FOLDS;
    const windowDays = input?.windowDays ?? 180;
    const purgeGapDays = input?.purgeGapDays ?? 2;
    const modes = input?.modes ?? MODES;

    const run = await createResearchRun({
      projectId: project.id,
      runType: "WALK_FORWARD_VALIDATE",
      windowDays,
      metadata: { folds, modes, genomeId: input?.genomeId, experimentId: input?.experimentId },
    });

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const trades = await prisma.learningTrade.findMany({
      where: { closedAt: { gte: since } },
      orderBy: { closedAt: "asc" },
      take: 5000,
      select: { closedAt: true, returnPercent: true },
    });

    const points: TradePoint[] = trades
      .filter((t) => t.closedAt != null)
      .map((t) => ({ closedAt: t.closedAt!, returnPct: Number(t.returnPercent ?? 0) }));

    if (points.length < folds * 10) {
      await completeResearchRun(run.id, "Insufficient trades for walk-forward validation");
      return { runId: run.id, passed: false, folds: [] };
    }

    const allFoldResults: Array<{
      mode: WalkForwardMode;
      foldIndex: number;
      trainStart: Date;
      trainEnd: Date;
      testStart: Date;
      testEnd: Date;
      trainMetrics: ReturnType<typeof computePerformanceMetrics>;
      testMetrics: ReturnType<typeof computePerformanceMetrics>;
      passed: boolean;
      purgeGapDays?: number;
    }> = [];

    for (const mode of modes) {
      const modeFolds = buildFolds(points, folds, mode, purgeGapDays);
      for (const fold of modeFolds) {
        const trainMetrics = computePerformanceMetrics(fold.trainReturns);
        const testMetrics = computePerformanceMetrics(fold.testReturns);
        const passed =
          testMetrics.profitFactor >= 1 &&
          testMetrics.expectancy > 0 &&
          testMetrics.sharpe > 0.3;
        allFoldResults.push({
          mode,
          foldIndex: fold.foldIndex,
          trainStart: fold.trainStart,
          trainEnd: fold.trainEnd,
          testStart: fold.testStart,
          testEnd: fold.testEnd,
          trainMetrics,
          testMetrics,
          passed,
          purgeGapDays: mode === "PURGED" ? purgeGapDays : undefined,
        });
      }
    }

    const persisted = await persistWalkForwardResults(input?.experimentId, run.id, allFoldResults);
    const passRate = allFoldResults.filter((f) => f.passed).length / Math.max(1, allFoldResults.length);
    const passed = passRate >= 0.6;

    if (input?.experimentId) {
      await persistResearchResult({
        experimentId: input.experimentId,
        runId: run.id,
        phase: "WALK_FORWARD",
        passed,
        metrics: { passRate, foldCount: allFoldResults.length, modes },
        verdict: passed ? "WALK_FORWARD_PASSED" : "WALK_FORWARD_FAILED",
      });
    }

    await completeResearchRun(run.id, `Walk-forward ${modes.join(",")}: ${passed ? "PASSED" : "FAILED"} (${(passRate * 100).toFixed(0)}%)`);
    return { runId: run.id, passed, passRate, foldCount: persisted.length, folds: allFoldResults };
  });
}

function buildFolds(
  points: TradePoint[],
  foldCount: number,
  mode: WalkForwardMode,
  purgeGapDays: number,
) {
  const foldSize = Math.floor(points.length / foldCount);
  const folds: Array<{
    foldIndex: number;
    trainStart: Date;
    trainEnd: Date;
    testStart: Date;
    testEnd: Date;
    trainReturns: number[];
    testReturns: number[];
  }> = [];

  for (let f = 0; f < foldCount; f++) {
    const testStartIdx = f * foldSize;
    const testEndIdx = Math.min(points.length, testStartIdx + foldSize);
    if (testEndIdx - testStartIdx < 5) continue;

    let trainStartIdx = 0;
    let trainEndIdx = testStartIdx;

    if (mode === "ROLLING") {
      trainStartIdx = Math.max(0, testStartIdx - foldSize * 2);
      trainEndIdx = testStartIdx;
    } else if (mode === "EXPANDING") {
      trainStartIdx = 0;
      trainEndIdx = testStartIdx;
    } else if (mode === "PURGED") {
      trainStartIdx = 0;
      const purgeMs = purgeGapDays * 24 * 60 * 60 * 1000;
      trainEndIdx = points.findIndex((p, i) => i >= testStartIdx && p.closedAt.getTime() >= points[testStartIdx]!.closedAt.getTime() - purgeMs);
      if (trainEndIdx < 0) trainEndIdx = Math.max(0, testStartIdx - 5);
    } else {
      trainStartIdx = 0;
      trainEndIdx = testStartIdx;
    }

    const trainSlice = points.slice(trainStartIdx, trainEndIdx);
    const testSlice = points.slice(testStartIdx, testEndIdx);
    if (trainSlice.length < 5 || testSlice.length < 3) continue;

    folds.push({
      foldIndex: f + 1,
      trainStart: trainSlice[0]!.closedAt,
      trainEnd: trainSlice[trainSlice.length - 1]!.closedAt,
      testStart: testSlice[0]!.closedAt,
      testEnd: testSlice[testSlice.length - 1]!.closedAt,
      trainReturns: trainSlice.map((p) => p.returnPct),
      testReturns: testSlice.map((p) => p.returnPct),
    });
  }

  return folds;
}

export async function getWalkForwardResults(experimentId?: string, limit = 100) {
  return researchDbOnly(async () => {
    return prisma.walkForwardResult.findMany({
      where: experimentId ? { experimentId } : {},
      orderBy: [{ mode: "asc" }, { foldIndex: "asc" }],
      take: limit,
    });
  });
}
