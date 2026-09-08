import { computeAlphaStats } from "./validation-framework.service";
import {
  DEFAULT_FUNDING_BASIS_THRESHOLDS,
  FUNDING_BASIS_ALPHA_V3_ID,
  pnlConcentrationFunding,
  runFundingBasisEventSimulation,
  splitLongShortStats,
  type FundingBasisThresholds,
  type FundingBasisVariant,
} from "./funding-basis-alpha-v3.service";
import type { FundingBasisPanel } from "./funding-basis-data.service";
import type { HistoricalBar } from "./historical-alpha-simulator.service";
import type { AlphaTradeRecord } from "./types";

const MS_DAY = 24 * 3_600_000;

export type WalkForwardFoldResult = {
  fold: number;
  trainStart: number;
  trainEnd: number;
  valStart: number;
  valEnd: number;
  trainStats: ReturnType<typeof computeAlphaStats>;
  valStats: ReturnType<typeof computeAlphaStats>;
  valEvents: number;
  valSignals: number;
  positive: boolean;
  thresholds: FundingBasisThresholds;
};

export function buildFundingWalkForwardFolds(
  datasetStart: number,
  datasetEnd: number,
  trainDays = 30,
  valDays = 14,
  rollDays = 14,
) {
  const folds: Array<{ trainStart: number; trainEnd: number; valStart: number; valEnd: number }> = [];
  const trainMs = trainDays * MS_DAY;
  const valMs = valDays * MS_DAY;
  const rollMs = rollDays * MS_DAY;
  let cursor = datasetStart + trainMs;
  while (cursor + valMs <= datasetEnd) {
    folds.push({
      trainStart: cursor - trainMs,
      trainEnd: cursor,
      valStart: cursor,
      valEnd: cursor + valMs,
    });
    cursor += rollMs;
  }
  return folds;
}

export function selectBestVariantOnTrain(input: {
  panels: FundingBasisPanel[];
  btc: HistoricalBar[];
  trainStart: number;
  trainEnd: number;
}): { thresholds: FundingBasisThresholds; trainStats: ReturnType<typeof computeAlphaStats> } {
  const variants: FundingBasisVariant[] = ["FUNDING_ONLY", "BASIS_ONLY", "FUNDING_BASIS", "FUNDING_BASIS_CONTEXT"];
  const holdHours = [8, 16];
  let best: { thresholds: FundingBasisThresholds; trainStats: ReturnType<typeof computeAlphaStats> } | null = null;

  for (const variant of variants) {
    for (const hold of holdHours) {
      const thresholds: FundingBasisThresholds = {
        ...DEFAULT_FUNDING_BASIS_THRESHOLDS,
        variant,
        holdHours: hold,
      };
      const { trades } = runFundingBasisEventSimulation({
        panels: input.panels,
        btc: input.btc,
        startTime: input.trainStart,
        endTime: input.trainEnd,
        thresholds,
        split: "TRAIN",
      });
      const stats = computeAlphaStats(trades);
      if (stats.trades < 3) continue;
      if (!best || stats.expectancy > best.trainStats.expectancy) {
        best = { thresholds, trainStats: stats };
      }
    }
  }

  return (
    best ?? {
      thresholds: DEFAULT_FUNDING_BASIS_THRESHOLDS,
      trainStats: computeAlphaStats([]),
    }
  );
}

export function runFundingBasisWalkForward(input: {
  panels: FundingBasisPanel[];
  btc: HistoricalBar[];
  datasetStart: number;
  datasetEnd: number;
}) {
  const folds = buildFundingWalkForwardFolds(input.datasetStart, input.datasetEnd);
  const foldResults: WalkForwardFoldResult[] = [];

  for (let i = 0; i < folds.length; i += 1) {
    const fold = folds[i];
    const { thresholds, trainStats } = selectBestVariantOnTrain({
      panels: input.panels,
      btc: input.btc,
      trainStart: fold.trainStart,
      trainEnd: fold.trainEnd,
    });
    const valRun = runFundingBasisEventSimulation({
      panels: input.panels,
      btc: input.btc,
      startTime: fold.valStart,
      endTime: fold.valEnd,
      thresholds,
      split: "VALIDATION",
    });
    const valStats = computeAlphaStats(valRun.trades);
    foldResults.push({
      fold: i + 1,
      trainStart: fold.trainStart,
      trainEnd: fold.trainEnd,
      valStart: fold.valStart,
      valEnd: fold.valEnd,
      trainStats,
      valStats,
      valEvents: valRun.events,
      valSignals: valRun.signals,
      positive: valStats.netPnl > 0 && valStats.expectancy > 0 && valStats.profitFactor > 1,
      thresholds,
    });
  }

  const positiveFolds = foldResults.filter((f) => f.positive).length;
  const negativeFolds = foldResults.length - positiveFolds;
  const allValTrades: AlphaTradeRecord[] = [];

  for (const fold of foldResults) {
    const valRun = runFundingBasisEventSimulation({
      panels: input.panels,
      btc: input.btc,
      startTime: fold.valStart,
      endTime: fold.valEnd,
      thresholds: fold.thresholds,
      split: "VALIDATION",
    });
    allValTrades.push(...valRun.trades);
  }

  const aggregate = computeAlphaStats(allValTrades);
  const concentration = pnlConcentrationFunding(allValTrades);
  const longShort = splitLongShortStats(allValTrades);

  const foldPnls = foldResults.map((f) => f.valStats.netPnl);
  const totalPnl = foldPnls.reduce((s, v) => s + v, 0);
  const topFoldContribution =
    totalPnl !== 0 ? Number((Math.max(...foldPnls.map(Math.abs)) / Math.abs(totalPnl) * 100).toFixed(2)) : 0;

  const walkForwardPass =
    foldResults.length >= 4 &&
    positiveFolds > negativeFolds &&
    aggregate.expectancy > 0 &&
    aggregate.profitFactor > 1 &&
    aggregate.netPnl > 0 &&
    concentration.topDayContributionPct < 50 &&
    Math.abs(concentration.topSymbolContributionPct) < 45 &&
    topFoldContribution < 60;

  return {
    alphaId: FUNDING_BASIS_ALPHA_V3_ID,
    folds: foldResults,
    foldsTested: foldResults.length,
    positiveFolds,
    negativeFolds,
    aggregate,
    concentration,
    longShort,
    topFoldContribution,
    walkForwardPass,
  };
}

export function evaluateFrozenFundingAlpha(input: {
  panels: FundingBasisPanel[];
  btc: HistoricalBar[];
  trainStart: number;
  trainEnd: number;
  evalStart: number;
  evalEnd: number;
  thresholds?: FundingBasisThresholds;
}) {
  const { thresholds } = input.thresholds
    ? { thresholds: input.thresholds }
    : selectBestVariantOnTrain({
        panels: input.panels,
        btc: input.btc,
        trainStart: input.trainStart,
        trainEnd: input.trainEnd,
      });

  const run = runFundingBasisEventSimulation({
    panels: input.panels,
    btc: input.btc,
    startTime: input.evalStart,
    endTime: input.evalEnd,
    thresholds,
    split: "TEST",
  });
  const stats = computeAlphaStats(run.trades);
  const concentration = pnlConcentrationFunding(run.trades);
  const longShort = splitLongShortStats(run.trades);
  return { stats, concentration, longShort, thresholds, events: run.events, signals: run.signals, cash: run.cash };
}

export function classifyWalkForwardFailure(input: {
  walkForwardPass: boolean;
  aggregate: ReturnType<typeof computeAlphaStats>;
  concentration: ReturnType<typeof pnlConcentrationFunding>;
  positiveFolds: number;
  foldsTested: number;
}): string {
  if (input.walkForwardPass) return "PASS";
  if (input.aggregate.trades < 8) return "SAMPLE_TOO_SMALL";
  if (input.aggregate.expectancy <= 0 && input.aggregate.profitFactor <= 1) return "SIGNAL_WRONG";
  if (input.aggregate.netPnl > 0 && input.aggregate.expectancy <= 0) return "COST_DRAG";
  if (Math.abs(input.concentration.topSymbolContributionPct) >= 45) return "SYMBOL_CONCENTRATION";
  if (input.concentration.topDayContributionPct >= 50) return "TIME_CONCENTRATION";
  if (input.positiveFolds <= input.foldsTested / 2) return "FEATURE_INSTABILITY";
  return "SIGNAL_WRONG";
}
