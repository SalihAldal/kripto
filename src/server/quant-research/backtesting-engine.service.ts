import { prisma } from "@/src/server/db/prisma";
import {
  completeResearchRun,
  createResearchRun,
  ensureDefaultResearchProject,
  persistSimulationRun,
} from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";
import type { BacktestWindow } from "@/src/server/quant-research/quant-research.types";

export async function fetchHistoricalReturns(windowDays: BacktestWindow | number = 90) {
  const since =
    windowDays === 0
      ? new Date(0)
      : new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const trades = await prisma.learningTrade.findMany({
    where: { closedAt: { gte: since } },
    orderBy: { closedAt: "asc" },
    take: windowDays === 0 ? 10000 : 5000,
    select: { returnPercent: true, outcome: true, symbol: true, closedAt: true, marketRegime: true, metadata: true },
  });

  return trades.map((t) => Number(t.returnPercent ?? 0));
}

export async function runBacktest(input?: {
  genomeId?: string;
  windowDays?: BacktestWindow | number;
  projectId?: string;
}) {
  return researchDbOnly(async () => {
    const project = input?.projectId
      ? await prisma.researchProject.findUnique({ where: { id: input.projectId } })
      : await ensureDefaultResearchProject();
    if (!project) return null;

    const windowDays = input?.windowDays ?? 90;
    const run = await createResearchRun({
      projectId: project.id,
      runType: "BACKTEST",
      windowDays: windowDays === 0 ? undefined : windowDays,
      metadata: { genomeId: input?.genomeId, isolated: true },
    });

    const returns = await fetchHistoricalReturns(windowDays);
    const metrics = computePerformanceMetrics(returns);

    const sim = await persistSimulationRun({
      runId: run.id,
      genomeId: input?.genomeId,
      windowDays: windowDays === 0 ? 9999 : windowDays,
      tradeCount: metrics.tradeCount,
      metrics: metrics as unknown as Record<string, unknown>,
    });

    await completeResearchRun(run.id, `Backtest ${windowDays}d: ${metrics.tradeCount} trades, PF ${metrics.profitFactor}`);
    return { runId: run.id, simulationId: sim.id, windowDays, metrics };
  });
}

export async function runMultiWindowBacktests(genomeId?: string) {
  const windows: BacktestWindow[] = [30, 90, 180, 365, 0];
  const results = [];
  for (const windowDays of windows) {
    const result = await runBacktest({ genomeId, windowDays }).catch(() => null);
    if (result) results.push(result);
  }
  return { windows: results.length, results };
}
