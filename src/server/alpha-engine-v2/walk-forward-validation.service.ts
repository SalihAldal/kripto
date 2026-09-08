import {
  ALPHA_SIMULATOR_IDS,
  type AlphaSimulatorId,
  type HistoricalBar,
  type SymbolHistoricalPanel,
} from "./historical-alpha-simulator.service";
import { computeAlphaStats } from "./validation-framework.service";
import {
  buildAlphaRegimeMatrix,
  eligibilityMapFromCells,
  pnlConcentration,
  routeRegimeAlpha,
} from "./regime-alpha-router.service";

export type WalkForwardFold = {
  fold: number;
  trainStart: number;
  trainEnd: number;
  valStart: number;
  valEnd: number;
  trainStats: ReturnType<typeof computeAlphaStats>;
  valStats: ReturnType<typeof computeAlphaStats>;
  positive: boolean;
  eligibilityCount: number;
};

const MS_HOUR = 3_600_000;
const MS_DAY = 24 * MS_HOUR;

export function buildWalkForwardFolds(
  datasetStart: number,
  datasetEnd: number,
  trainDays = 14,
  valDays = 7,
  rollDays = 7,
): Array<{ trainStart: number; trainEnd: number; valStart: number; valEnd: number }> {
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

export function runWalkForwardRegimeRouter(input: {
  panels: SymbolHistoricalPanel[];
  btc: HistoricalBar[];
  datasetStart: number;
  datasetEnd: number;
  alphaIds?: AlphaSimulatorId[];
  startIdx?: number;
  endIdx?: number;
  stepHours?: number;
}) {
  const alphaIds = input.alphaIds ?? (ALPHA_SIMULATOR_IDS.filter((id) => id !== "CASH_FILTER_REGIME" && id !== "BTC_REGIME_RESIDUAL_SHORT") as AlphaSimulatorId[]);
  const startIdx = input.startIdx ?? 48;
  const endIdx = input.endIdx ?? Math.min(...input.panels.map((p) => p.bars.length - 24));
  const stepHours = input.stepHours ?? 4;
  const folds = buildWalkForwardFolds(input.datasetStart, input.datasetEnd);

  const foldResults: WalkForwardFold[] = [];
  for (let i = 0; i < folds.length; i += 1) {
    const fold = folds[i];
    const trainCells = buildAlphaRegimeMatrix({
      alphaIds,
      panels: input.panels,
      btc: input.btc,
      startIdx,
      endIdx,
      stepHours,
      startTime: fold.trainStart,
      endTime: fold.trainEnd,
    });
    const eligibility = eligibilityMapFromCells(trainCells);
    const routed = routeRegimeAlpha({
      panels: input.panels,
      btc: input.btc,
      eligibility,
      startIdx,
      endIdx,
      stepHours,
      startTime: fold.valStart,
      endTime: fold.valEnd,
      preferCashOnTransition: true,
    });
    const trainRouted = routeRegimeAlpha({
      panels: input.panels,
      btc: input.btc,
      eligibility,
      startIdx,
      endIdx,
      stepHours,
      startTime: fold.trainStart,
      endTime: fold.trainEnd,
      preferCashOnTransition: true,
    });
    const valStats = computeAlphaStats(routed.trades);
    const trainStats = computeAlphaStats(trainRouted.trades);
    foldResults.push({
      fold: i + 1,
      trainStart: fold.trainStart,
      trainEnd: fold.trainEnd,
      valStart: fold.valStart,
      valEnd: fold.valEnd,
      trainStats,
      valStats,
      positive: valStats.netPnl > 0 && valStats.expectancy > 0 && valStats.profitFactor > 1,
      eligibilityCount: [...eligibility.values()].reduce((s, arr) => s + arr.length, 0),
    });
  }

  const positiveFolds = foldResults.filter((f) => f.positive).length;
  const negativeFolds = foldResults.length - positiveFolds;
  const expectancies = foldResults.map((f) => f.valStats.expectancy).filter((v) => Number.isFinite(v));
  const pfs = foldResults.map((f) => f.valStats.profitFactor).filter((v) => Number.isFinite(v));
  const median = (arr: number[]) => {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const allValTrades = foldResults.flatMap((f, i) => {
    const fold = folds[i];
    const trainCells = buildAlphaRegimeMatrix({
      alphaIds,
      panels: input.panels,
      btc: input.btc,
      startIdx,
      endIdx,
      stepHours,
      startTime: fold.trainStart,
      endTime: fold.trainEnd,
    });
    const eligibility = eligibilityMapFromCells(trainCells);
    return routeRegimeAlpha({
      panels: input.panels,
      btc: input.btc,
      eligibility,
      startIdx,
      endIdx,
      stepHours,
      startTime: fold.valStart,
      endTime: fold.valEnd,
      preferCashOnTransition: true,
    }).trades;
  });

  const concentration = pnlConcentration(allValTrades);
  const aggregate = computeAlphaStats(allValTrades);

  const walkForwardPass =
    foldResults.length >= 4 &&
    positiveFolds > negativeFolds &&
    aggregate.expectancy > 0 &&
    aggregate.profitFactor > 1 &&
    concentration.topDayContributionPct < 50 &&
    concentration.topSymbolContributionPct < 45;

  return {
    folds: foldResults,
    foldsTested: foldResults.length,
    positiveFolds,
    negativeFolds,
    medianExpectancy: median(expectancies),
    medianPF: median(pfs),
    worstExpectancy: expectancies.length ? Math.min(...expectancies) : 0,
    worstPF: pfs.length ? Math.min(...pfs) : 0,
    aggregate,
    concentration,
    walkForwardPass,
  };
}

export async function evaluateFrozenRouterOnWindow(input: {
  panels: SymbolHistoricalPanel[];
  btc: HistoricalBar[];
  trainStart: number;
  trainEnd: number;
  evalStart: number;
  evalEnd: number;
  alphaIds?: AlphaSimulatorId[];
}) {
  const alphaIds = input.alphaIds ?? (ALPHA_SIMULATOR_IDS.filter((id) => id !== "CASH_FILTER_REGIME") as AlphaSimulatorId[]);
  const startIdx = 48;
  const endIdx = Math.min(...input.panels.map((p) => p.bars.length - 24));
  const trainCells = buildAlphaRegimeMatrix({
    alphaIds,
    panels: input.panels,
    btc: input.btc,
    startIdx,
    endIdx,
    stepHours: 4,
    startTime: input.trainStart,
    endTime: input.trainEnd,
  });
  const eligibility = eligibilityMapFromCells(trainCells);
  const routed = routeRegimeAlpha({
    panels: input.panels,
    btc: input.btc,
    eligibility,
    startIdx,
    endIdx,
    stepHours: 4,
    startTime: input.evalStart,
    endTime: input.evalEnd,
    preferCashOnTransition: true,
  });
  const stats = computeAlphaStats(routed.trades);
  const concentration = pnlConcentration(routed.trades);
  return { stats, concentration, eligibility: [...eligibility.entries()], decisions: routed.decisions.length };
}
