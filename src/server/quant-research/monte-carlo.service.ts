import {
  completeResearchRun,
  createResearchRun,
  ensureDefaultResearchProject,
  persistMonteCarloRun,
} from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { fetchHistoricalReturns } from "@/src/server/quant-research/backtesting-engine.service";

export async function runMonteCarloSimulation(input?: {
  genomeId?: string;
  iterations?: number;
  windowDays?: number;
}) {
  return researchDbOnly(async () => {
    const project = await ensureDefaultResearchProject();
    const iterations = input?.iterations ?? 1000;
    const run = await createResearchRun({
      projectId: project.id,
      runType: "MONTE_CARLO",
      windowDays: input?.windowDays ?? 90,
      metadata: { iterations, genomeId: input?.genomeId },
    });

    const baseReturns = await fetchHistoricalReturns(input?.windowDays ?? 90);
    if (baseReturns.length < 5) {
      await completeResearchRun(run.id, "Insufficient data for Monte Carlo");
      return { passed: false, iterations: 0 };
    }

    const simulationResults: number[] = [];
    const drawdowns: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const shuffled = shuffleWithNoise(baseReturns);
      const slippageAdj = shuffled.map((r) => r - (Math.random() * 0.15));
      const metrics = computePerformanceMetrics(slippageAdj);
      simulationResults.push(metrics.totalReturnPct);
      drawdowns.push(metrics.maxDrawdownPct);
    }

    simulationResults.sort((a, b) => a - b);
    const p5 = simulationResults[Math.floor(iterations * 0.05)] ?? 0;
    const p50 = simulationResults[Math.floor(iterations * 0.5)] ?? 0;
    const p95 = simulationResults[Math.floor(iterations * 0.95)] ?? 0;
    const maxDdP95 = percentile(drawdowns, 95);
    const passed = p5 > 0 && maxDdP95 < 15;

    const mc = await persistMonteCarloRun({
      runId: run.id,
      genomeId: input?.genomeId,
      iterations,
      passed,
      metrics: { p5, p50, p95, maxDrawdownP95: maxDdP95 },
      distribution: { returns: { p5, p50, p95 }, drawdowns: { p95: maxDdP95 } },
    });

    await completeResearchRun(run.id, `Monte Carlo ${iterations} iter: ${passed ? "PASSED" : "FAILED"}`);
    return { runId: run.id, monteCarloId: mc.id, passed, p5, p50, p95, maxDrawdownP95: maxDdP95 };
  });
}

function shuffleWithNoise(returns: number[]) {
  const copy = [...returns];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.map((r) => r * (0.95 + Math.random() * 0.1));
}

function percentile(values: number[], pct: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((pct / 100) * sorted.length)] ?? 0;
}
