import { computeAlphaStats } from "./validation-framework.service";
import { runOiImpulseSimulation, type OiImpulseAlphaId, type OiImpulseVariant } from "./oi-impulse-alpha-v2.service";
import { pnlConcentrationExternal } from "./external-microstructure-alpha.service";
import type { ExternalSymbolPanel } from "./external-market-data.types";
import type { AlphaTradeRecord } from "./types";

const MS_DAY = 24 * 3_600_000;

export function buildOiWalkForwardFolds(datasetStart: number, datasetEnd: number, trainDays = 45, valDays = 15, rollDays = 15) {
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

export type OiWalkForwardResult = {
  alphaId: OiImpulseAlphaId;
  variant?: OiImpulseVariant;
  folds: Array<{ fold: number; valStats: ReturnType<typeof computeAlphaStats>; positive: boolean }>;
  foldsTested: number;
  positiveFolds: number;
  negativeFolds: number;
  aggregate: ReturnType<typeof computeAlphaStats>;
  concentration: ReturnType<typeof pnlConcentrationExternal>;
  walkForwardPass: boolean;
  failReasons: string[];
};

export function runOiImpulseWalkForward(input: {
  alphaId: OiImpulseAlphaId;
  panels: ExternalSymbolPanel[];
  wfStart: number;
  wfEnd: number;
  freshCutoff: number;
  variant?: OiImpulseVariant;
  trainDays?: number;
  valDays?: number;
  rollDays?: number;
  slippageMultiplier?: number;
}): OiWalkForwardResult {
  const folds = buildOiWalkForwardFolds(input.wfStart, input.wfEnd, input.trainDays ?? 45, input.valDays ?? 15, input.rollDays ?? 15);
  const startIdx = 48;
  const endIdx = Math.min(...input.panels.map((p) => p.bars.length - 12));
  const foldResults = [];
  const allTrades: AlphaTradeRecord[] = [];

  for (let i = 0; i < folds.length; i += 1) {
    const fold = folds[i];
    const trades = runOiImpulseSimulation({
      alphaId: input.alphaId,
      panels: input.panels,
      startIdx,
      endIdx,
      stepHours: 4,
      startTime: fold.valStart,
      endTime: Math.min(fold.valEnd, input.freshCutoff),
      split: "VALIDATION",
      variant: input.variant,
      slippageMultiplier: input.slippageMultiplier,
    });
    const stats = computeAlphaStats(trades);
    foldResults.push({ fold: i + 1, valStats: stats, positive: stats.netPnl > 0 && stats.expectancy > 0 && stats.profitFactor > 1 });
    allTrades.push(...trades);
  }

  const aggregate = computeAlphaStats(allTrades);
  const concentration = pnlConcentrationExternal(allTrades);
  const positiveFolds = foldResults.filter((f) => f.positive).length;
  const foldPnls = foldResults.map((f) => f.valStats.netPnl);
  const totalPnl = foldPnls.reduce((s, v) => s + v, 0);
  concentration.topFoldContributionPct =
    totalPnl !== 0 ? Number((Math.max(...foldPnls.map(Math.abs)) / Math.abs(totalPnl) * 100).toFixed(2)) : 0;

  const failReasons: string[] = [];
  if (folds.length < 6) failReasons.push("INSUFFICIENT_FOLDS");
  if (positiveFolds / Math.max(folds.length, 1) < 0.6) failReasons.push("POSITIVE_FOLD_RATIO");
  if (aggregate.expectancy <= 0) failReasons.push("EXPECTANCY");
  if (aggregate.profitFactor <= 1) failReasons.push("PROFIT_FACTOR");
  if (aggregate.netPnl <= 0) failReasons.push("NET_PNL");
  if (aggregate.trades < 100) failReasons.push("LOW_SAMPLE");
  if (Math.abs(concentration.topFoldContributionPct) >= 40) failReasons.push("FOLD_CONCENTRATION");
  if (concentration.topDayContributionPct >= 35) failReasons.push("DAY_CONCENTRATION");
  if (Math.abs(concentration.topSymbolContributionPct) >= 40) failReasons.push("SYMBOL_CONCENTRATION");

  const walkForwardPass = failReasons.length === 0;

  return {
    alphaId: input.alphaId,
    variant: input.variant,
    folds: foldResults,
    foldsTested: folds.length,
    positiveFolds,
    negativeFolds: folds.length - positiveFolds,
    aggregate,
    concentration,
    walkForwardPass,
    failReasons,
  };
}

export function evaluateOiFreshUnseen(input: {
  alphaId: OiImpulseAlphaId;
  panels: ExternalSymbolPanel[];
  freshStart: number;
  freshEnd: number;
  variant?: OiImpulseVariant;
}) {
  const startIdx = 48;
  const endIdx = Math.min(...input.panels.map((p) => p.bars.length - 12));
  const trades = runOiImpulseSimulation({
    alphaId: input.alphaId,
    panels: input.panels,
    startIdx,
    endIdx,
    stepHours: 4,
    startTime: input.freshStart,
    endTime: input.freshEnd,
    split: "TEST",
    variant: input.variant,
  });
  const stats = computeAlphaStats(trades);
  const concentration = pnlConcentrationExternal(trades);
  const pass = stats.trades >= 20 && stats.netPnl > 0 && stats.expectancy > 0 && stats.profitFactor > 1;
  return { stats, concentration, trades, pass };
}

export function runCostSensitivity(input: {
  alphaId: OiImpulseAlphaId;
  panels: ExternalSymbolPanel[];
  start: number;
  end: number;
  variant?: OiImpulseVariant;
}) {
  const multipliers = [0.75, 1.0, 1.5];
  return multipliers.map((m) => {
    const trades = runOiImpulseSimulation({
      alphaId: input.alphaId,
      panels: input.panels,
      startIdx: 48,
      endIdx: Math.min(...input.panels.map((p) => p.bars.length - 12)),
      stepHours: 4,
      startTime: input.start,
      endTime: input.end,
      split: "TEST",
      variant: input.variant,
      slippageMultiplier: m,
    });
    const stats = computeAlphaStats(trades);
    return { multiplier: m, ...stats };
  });
}

export function runHoldingHorizonDecay(input: {
  alphaId: OiImpulseAlphaId;
  panel: ExternalSymbolPanel;
  idx: number;
  horizons: number[];
}) {
  return input.horizons.map((holdHours) => {
    const trade = runOiImpulseSimulation({
      alphaId: input.alphaId,
      panels: [input.panel],
      startIdx: input.idx,
      endIdx: input.idx + 1,
      stepHours: 1,
      startTime: input.panel.bars[input.idx]?.closeTime ?? 0,
      endTime: input.panel.bars[input.idx]?.closeTime ?? 0,
      split: "TRAIN",
      holdHours,
    })[0];
    return { holdHours, netReturnPct: trade?.netReturnPct ?? 0 };
  });
}
