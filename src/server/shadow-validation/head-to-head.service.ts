import type { ValidationReportCadence } from "@prisma/client";
import { computeEngineScorecard, persistEngineScorecard } from "@/src/server/shadow-validation/engine-scorecard.service";
import { listActiveShadowEngines } from "@/src/server/shadow-validation/engine-registry.service";
import { persistEngineComparison } from "@/src/server/shadow-validation/shadow-validation.repository";

export async function runHeadToHeadComparison(input: {
  periodStart: Date;
  periodEnd: Date;
  cadence: ValidationReportCadence;
}) {
  const engines = await listActiveShadowEngines();
  const scorecards = [];
  for (const engine of engines) {
    const scorecard = await computeEngineScorecard({
      engineId: engine.engineId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      cadence: input.cadence,
    });
    await persistEngineScorecard({ scorecard, ...input });
    scorecards.push(scorecard);
  }

  scorecards.sort((a, b) => b.profitFactor - a.profitFactor || b.sharpeRatio - a.sharpeRatio);
  const ranking = scorecards.map((row, index) => ({ rank: index + 1, engineId: row.engineId, profitFactor: row.profitFactor }));

  const comparisons = [];
  for (let i = 0; i < scorecards.length; i += 1) {
    for (let j = i + 1; j < scorecards.length; j += 1) {
      const a = scorecards[i];
      const b = scorecards[j];
      const winnerEngineId = a.profitFactor >= b.profitFactor ? a.engineId : b.engineId;
      const row = await persistEngineComparison({
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        cadence: input.cadence,
        engineA: a.engineId,
        engineB: b.engineId,
        ranking,
        headToHead: { a, b },
        profitDeltaPct: a.expectancy - b.expectancy,
        riskDeltaPct: a.maxDrawdownPct - b.maxDrawdownPct,
        winnerEngineId,
      });
      comparisons.push(row);
    }
  }

  return { ranking, comparisons: comparisons.length, scorecards };
}

export async function runBenchmarkReport(cadence: ValidationReportCadence) {
  const periodEnd = new Date();
  const periodStart = new Date(
    periodEnd.getTime() -
      (cadence === "DAILY" ? 1 : cadence === "WEEKLY" ? 7 : 30) * 24 * 60 * 60 * 1000,
  );
  return runHeadToHeadComparison({ periodStart, periodEnd, cadence });
}
