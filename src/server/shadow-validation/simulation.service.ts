import { prisma } from "@/src/server/db/prisma";
import { computeEngineScorecard } from "@/src/server/shadow-validation/engine-scorecard.service";
import { listActiveShadowEngines } from "@/src/server/shadow-validation/engine-registry.service";
import { persistSimulationResult, createValidationRun, completeValidationRun } from "@/src/server/shadow-validation/shadow-validation.repository";
import { captureShadowDecisionsForDecision } from "@/src/server/shadow-validation/shadow-capture.engine";
import type { SIMULATION_WINDOWS } from "@/src/server/shadow-validation/shadow-validation.types";

export async function runHistoricalSimulation(input: {
  windowDays: (typeof SIMULATION_WINDOWS)[number];
  engineIds?: string[];
  limit?: number;
}) {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - input.windowDays * 24 * 60 * 60 * 1000);
  const run = await createValidationRun({
    runType: "SIMULATION",
    periodStart,
    periodEnd,
    engineIds: input.engineIds,
    metadata: { windowDays: input.windowDays },
  });

  const decisions = await prisma.decisionLog.findMany({
    where: { createdAt: { gte: periodStart, lte: periodEnd } },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 200,
    select: { decisionId: true },
  });

  for (const row of decisions.slice(0, 20)) {
    await captureShadowDecisionsForDecision(row.decisionId).catch(() => null);
  }

  const engines = input.engineIds?.length
    ? (await listActiveShadowEngines()).filter((row) => input.engineIds!.includes(row.engineId))
    : await listActiveShadowEngines();

  const results = [];
  for (const engine of engines) {
    const scorecard = await computeEngineScorecard({
      engineId: engine.engineId,
      periodStart,
      periodEnd,
    });
    const saved = await persistSimulationResult({
      runId: run.id,
      engineId: engine.engineId,
      windowDays: input.windowDays,
      periodStart,
      periodEnd,
      decisions: scorecard.completedTrades,
      winRate: scorecard.winRate,
      profitFactor: scorecard.profitFactor,
      sharpeRatio: scorecard.sharpeRatio,
      maxDrawdownPct: scorecard.maxDrawdownPct,
      comparison: scorecard,
    });
    results.push(saved);
  }

  await completeValidationRun(run.id, { windowDays: input.windowDays, engines: engines.length, results: results.length });
  return { runId: run.id, results };
}

export async function runReplayValidation(decisionId: string) {
  const capture = await captureShadowDecisionsForDecision(decisionId);
  const { evaluatePendingShadowDecisions } = await import("@/src/server/shadow-validation/shadow-capture.engine");
  await evaluatePendingShadowDecisions(1);
  return capture;
}
