import {
  completeResearchRun,
  createResearchRun,
  ensureDefaultResearchProject,
  persistWalkForwardRun,
} from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { fetchHistoricalReturns } from "@/src/server/quant-research/backtesting-engine.service";

export async function runWalkForwardAnalysis(input?: {
  genomeId?: string;
  folds?: number;
  windowDays?: number;
  trainPct?: number;
}) {
  return researchDbOnly(async () => {
    const project = await ensureDefaultResearchProject();
    const folds = input?.folds ?? 5;
    const trainPct = input?.trainPct ?? 0.7;
    const run = await createResearchRun({
      projectId: project.id,
      runType: "WALK_FORWARD",
      windowDays: input?.windowDays ?? 180,
      metadata: { folds, trainPct, genomeId: input?.genomeId },
    });

    const returns = await fetchHistoricalReturns(input?.windowDays ?? 180);
    const foldSize = Math.floor(returns.length / folds);
    const foldResults: Array<{ fold: number; trainMetrics: ReturnType<typeof computePerformanceMetrics>; testMetrics: ReturnType<typeof computePerformanceMetrics>; passed: boolean }> = [];

    for (let f = 0; f < folds; f++) {
      const start = f * foldSize;
      const end = start + foldSize;
      const foldReturns = returns.slice(start, end);
      if (foldReturns.length < 10) continue;
      const trainSize = Math.floor(foldReturns.length * trainPct);
      const trainMetrics = computePerformanceMetrics(foldReturns.slice(0, trainSize));
      const testMetrics = computePerformanceMetrics(foldReturns.slice(trainSize));
      const passed = testMetrics.profitFactor >= 1 && testMetrics.expectancy > 0 && testMetrics.sharpe > 0.5;
      foldResults.push({ fold: f + 1, trainMetrics, testMetrics, passed });
    }

    const passed = foldResults.filter((f) => f.passed).length >= Math.ceil(folds * 0.6);
    const avgTestPf = foldResults.length > 0 ? foldResults.reduce((s, f) => s + f.testMetrics.profitFactor, 0) / foldResults.length : 0;

    const wf = await persistWalkForwardRun({
      runId: run.id,
      genomeId: input?.genomeId,
      folds,
      passed,
      metrics: { avgTestProfitFactor: avgTestPf, passRate: foldResults.filter((f) => f.passed).length / Math.max(1, foldResults.length) },
      foldResults,
    });

    await completeResearchRun(run.id, `Walk-forward ${folds} folds: ${passed ? "PASSED" : "FAILED"}`);
    return { runId: run.id, walkForwardId: wf.id, passed, foldResults };
  });
}
