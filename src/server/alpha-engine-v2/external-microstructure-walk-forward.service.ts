import { computeAlphaStats } from "./validation-framework.service";
import {
  EXTERNAL_ALPHA_IDS,
  pnlConcentrationExternal,
  runExternalAlphaSimulation,
  type ExternalAlphaId,
} from "./external-microstructure-alpha.service";
import type { ExternalSymbolPanel } from "./external-market-data.types";
import type { AlphaTradeRecord } from "./types";

const MS_DAY = 24 * 3_600_000;

export function buildExternalWalkForwardFolds(
  datasetStart: number,
  datasetEnd: number,
  trainDays = 30,
  valDays = 14,
  rollDays = 14,
) {
  const folds = [];
  const trainMs = trainDays * MS_DAY;
  const valMs = valDays * MS_DAY;
  const rollMs = rollDays * MS_DAY;
  let cursor = datasetStart + trainMs;
  while (cursor + valMs <= datasetEnd) {
    folds.push({ trainStart: cursor - trainMs, trainEnd: cursor, valStart: cursor, valEnd: cursor + valMs });
    cursor += rollMs;
  }
  return folds;
}

export type ExternalAlphaFoldResult = {
  fold: number;
  alphaId: ExternalAlphaId;
  valStats: ReturnType<typeof computeAlphaStats>;
  positive: boolean;
};

export function runExternalAlphaWalkForward(input: {
  alphaId: ExternalAlphaId;
  panels: ExternalSymbolPanel[];
  datasetStart: number;
  datasetEnd: number;
  startIdx?: number;
  endIdx?: number;
}) {
  const startIdx = input.startIdx ?? 48;
  const endIdx = input.endIdx ?? Math.min(...input.panels.map((p) => p.bars.length - 12));
  const folds = buildExternalWalkForwardFolds(input.datasetStart, input.datasetEnd);
  const foldResults: ExternalAlphaFoldResult[] = [];

  for (let i = 0; i < folds.length; i += 1) {
    const fold = folds[i];
    const trades = runExternalAlphaSimulation({
      alphaId: input.alphaId,
      panels: input.panels,
      startIdx,
      endIdx,
      stepHours: 4,
      startTime: fold.valStart,
      endTime: fold.valEnd,
      split: "VALIDATION",
    });
    const stats = computeAlphaStats(trades);
    foldResults.push({
      fold: i + 1,
      alphaId: input.alphaId,
      valStats: stats,
      positive: stats.netPnl > 0 && stats.expectancy > 0 && stats.profitFactor > 1,
    });
  }

  const allTrades: AlphaTradeRecord[] = [];
  for (const fold of folds) {
    allTrades.push(
      ...runExternalAlphaSimulation({
        alphaId: input.alphaId,
        panels: input.panels,
        startIdx,
        endIdx,
        stepHours: 4,
        startTime: fold.valStart,
        endTime: fold.valEnd,
        split: "VALIDATION",
      }),
    );
  }

  const aggregate = computeAlphaStats(allTrades);
  const concentration = pnlConcentrationExternal(allTrades);
  const positiveFolds = foldResults.filter((f) => f.positive).length;
  const foldPnls = foldResults.map((f) => f.valStats.netPnl);
  const totalPnl = foldPnls.reduce((s, v) => s + v, 0);
  const topFoldContribution = totalPnl !== 0 ? Math.max(...foldPnls.map(Math.abs)) / Math.abs(totalPnl) * 100 : 0;
  concentration.topFoldContributionPct = Number(topFoldContribution.toFixed(2));

  const walkForwardPass =
    (folds.length >= 4 || (folds.length >= 2 && aggregate.trades >= 20)) &&
    positiveFolds > folds.length - positiveFolds &&
    aggregate.expectancy > 0 &&
    aggregate.profitFactor > 1 &&
    aggregate.netPnl > 0 &&
    Math.abs(concentration.topSymbolContributionPct) < 45 &&
    concentration.topDayContributionPct < 50 &&
    topFoldContribution < 60;

  return {
    alphaId: input.alphaId,
    folds: foldResults,
    foldsTested: folds.length,
    positiveFolds,
    negativeFolds: folds.length - positiveFolds,
    aggregate,
    concentration,
    walkForwardPass,
  };
}

export function evaluateAllExternalAlphas(input: {
  panels: ExternalSymbolPanel[];
  datasetStart: number;
  datasetEnd: number;
  trainDays?: number;
  valDays?: number;
  rollDays?: number;
}) {
  const trainDays = input.trainDays ?? 30;
  const valDays = input.valDays ?? 14;
  const rollDays = input.rollDays ?? 14;
  return EXTERNAL_ALPHA_IDS.map((alphaId) => {
    const folds = buildExternalWalkForwardFolds(input.datasetStart, input.datasetEnd, trainDays, valDays, rollDays);
    const startIdx = 48;
    const endIdx = Math.min(...input.panels.map((p) => p.bars.length - 12));
    const foldResults: ExternalAlphaFoldResult[] = [];
    for (let i = 0; i < folds.length; i += 1) {
      const fold = folds[i];
      const trades = runExternalAlphaSimulation({
        alphaId,
        panels: input.panels,
        startIdx,
        endIdx,
        stepHours: 4,
        startTime: fold.valStart,
        endTime: fold.valEnd,
        split: "VALIDATION",
      });
      const stats = computeAlphaStats(trades);
      foldResults.push({
        fold: i + 1,
        alphaId,
        valStats: stats,
        positive: stats.netPnl > 0 && stats.expectancy > 0 && stats.profitFactor > 1,
      });
    }
    const allTrades: AlphaTradeRecord[] = [];
    for (const fold of folds) {
      allTrades.push(
        ...runExternalAlphaSimulation({
          alphaId,
          panels: input.panels,
          startIdx,
          endIdx,
          stepHours: 4,
          startTime: fold.valStart,
          endTime: fold.valEnd,
          split: "VALIDATION",
        }),
      );
    }
    const aggregate = computeAlphaStats(allTrades);
    const concentration = pnlConcentrationExternal(allTrades);
    const positiveFolds = foldResults.filter((f) => f.positive).length;
    const foldPnls = foldResults.map((f) => f.valStats.netPnl);
    const totalPnl = foldPnls.reduce((s, v) => s + v, 0);
    const topFoldContribution = totalPnl !== 0 ? Math.max(...foldPnls.map(Math.abs)) / Math.abs(totalPnl) * 100 : 0;
    concentration.topFoldContributionPct = Number(topFoldContribution.toFixed(2));
    const walkForwardPass =
      (folds.length >= 4 || (folds.length >= 2 && aggregate.trades >= 20)) &&
      positiveFolds > folds.length - positiveFolds &&
      aggregate.expectancy > 0 &&
      aggregate.profitFactor > 1 &&
      aggregate.netPnl > 0 &&
      Math.abs(concentration.topSymbolContributionPct) < 45 &&
      concentration.topDayContributionPct < 50 &&
      topFoldContribution < 60;
    return {
      alphaId,
      folds: foldResults,
      foldsTested: folds.length,
      positiveFolds,
      negativeFolds: folds.length - positiveFolds,
      aggregate,
      concentration,
      walkForwardPass,
    };
  });
}

export function evaluateFrozenExternalAlpha(input: {
  alphaId: ExternalAlphaId;
  panels: ExternalSymbolPanel[];
  evalStart: number;
  evalEnd: number;
}) {
  const startIdx = 48;
  const endIdx = Math.min(...input.panels.map((p) => p.bars.length - 12));
  const trades = runExternalAlphaSimulation({
    alphaId: input.alphaId,
    panels: input.panels,
    startIdx,
    endIdx,
    stepHours: 4,
    startTime: input.evalStart,
    endTime: input.evalEnd,
    split: "TEST",
  });
  return { stats: computeAlphaStats(trades), concentration: pnlConcentrationExternal(trades), trades };
}
