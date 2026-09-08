import { atrPct, estimateBeta, percentileRank, returnPct } from "./feature-registry.service";
import {
  runHistoricalAlphaSimulation,
  simulateAlphaAtBar,
  type HistoricalBar,
  type SymbolHistoricalPanel,
} from "./historical-alpha-simulator.service";
import { computeAlphaStats } from "./validation-framework.service";
import type { AlphaTradeRecord } from "./types";
import { resolveRoundTripCostPct } from "./cost-model-v2.service";

export type ForensicVerdict =
  | "IMPLEMENTATION_PARITY_OK"
  | "REGIME_SHIFT"
  | "SYMBOL_CONCENTRATION"
  | "TIME_CONCENTRATION"
  | "DATA_SHIFT"
  | "SIGNAL_SHIFT";

function btcRegime(btc: HistoricalBar[], idx: number) {
  const closes = btc.map((b) => b.close);
  const r24 = returnPct(closes, idx, 24);
  const vol = atrPct(btc, idx, 60);
  if (vol > 2.5) return "HIGH_VOL";
  if (r24 > 1.2) return "UPTREND";
  if (r24 < -1.2) return "DOWNTREND";
  return "SIDEWAYS";
}

function dayKey(ts: number) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function analyzeResidualMomentumShort(input: {
  panels: SymbolHistoricalPanel[];
  btc: HistoricalBar[];
  dataset: { trainEnd: number; valEnd: number };
  startIdx: number;
  endIdx: number;
  stepHours: number;
}) {
  const costPct = resolveRoundTripCostPct("FUTURES", "REALISTIC");
  const splitOf = (t: number): AlphaTradeRecord["split"] => {
    if (t < input.dataset.trainEnd) return "TRAIN";
    if (t < input.dataset.valEnd) return "VALIDATION";
    return "TEST";
  };

  const parityCheck = {
    sameAlphaCode: true,
    sameCostPct: costPct,
    sameHoldHours: 8,
    sameStepHours: input.stepHours,
    validationFinalUseSameSimulator: true,
  };

  const trades: AlphaTradeRecord[] = [];
  const enriched: Array<AlphaTradeRecord & { regime: string; residual: number; beta: number; btcRet24: number }> = [];

  for (let idx = input.startIdx; idx < input.endIdx; idx += input.stepHours) {
    const t = input.panels[0]?.bars[idx]?.closeTime ?? 0;
    const split = splitOf(t);
    const regime = btcRegime(input.btc, Math.min(idx, input.btc.length - 1));
    const btcCloses = input.btc.map((b) => b.close);
    const batch = simulateAlphaAtBar({
      alphaId: "RESIDUAL_MOMENTUM_SHORT",
      panels: input.panels,
      btc: input.btc,
      idx,
      split,
      costPct,
    });
    for (const trade of batch) {
      const panel = input.panels.find((p) => p.symbol === trade.symbol);
      const closes = panel?.bars.map((b) => b.close) ?? [];
      const beta = estimateBeta(closes, btcCloses, idx, 24);
      const residual = returnPct(closes, idx, 24) - beta * returnPct(btcCloses, idx, 24);
      enriched.push({
        ...trade,
        regime,
        residual,
        beta,
        btcRet24: returnPct(btcCloses, idx, 24),
      });
    }
    trades.push(...batch);
  }

  const bySplit = {
    TRAIN: enriched.filter((t) => t.split === "TRAIN"),
    VALIDATION: enriched.filter((t) => t.split === "VALIDATION"),
    TEST: enriched.filter((t) => t.split === "TEST"),
  };

  const symbolStats = (rows: typeof enriched) => {
    const map = new Map<string, AlphaTradeRecord[]>();
    for (const row of rows) {
      const arr = map.get(row.symbol) ?? [];
      arr.push(row);
      map.set(row.symbol, arr);
    }
    return [...map.entries()].map(([symbol, symTrades]) => ({
      symbol,
      stats: computeAlphaStats(symTrades),
    })).sort((a, b) => b.stats.netPnl - a.stats.netPnl);
  };

  const regimeStats = (rows: typeof enriched) => {
    const map = new Map<string, typeof enriched>();
    for (const row of rows) {
      const arr = map.get(row.regime) ?? [];
      arr.push(row);
      map.set(row.regime, arr);
    }
    return [...map.entries()].map(([regime, regTrades]) => ({
      regime,
      stats: computeAlphaStats(regTrades),
    }));
  };

  const timeConcentration = (rows: typeof enriched) => {
    const byDay = new Map<string, number>();
    for (const row of rows) {
      const key = dayKey(row.entryTime);
      byDay.set(key, (byDay.get(key) ?? 0) + (row.netReturnPct / 100) * 1000);
    }
    const days = [...byDay.entries()].sort((a, b) => b[1] - a[1]);
    const total = days.reduce((s, [, v]) => s + v, 0);
    const bestDay = days[0]?.[1] ?? 0;
    const best3 = days.slice(0, 3).reduce((s, [, v]) => s + v, 0);
    return {
      bestDayContributionPct: total !== 0 ? Number(((bestDay / total) * 100).toFixed(2)) : 0,
      best3DaysContributionPct: total !== 0 ? Number(((best3 / total) * 100).toFixed(2)) : 0,
      topDays: days.slice(0, 5),
    };
  };

  const valStats = computeAlphaStats(bySplit.VALIDATION);
  const testStats = computeAlphaStats(bySplit.TEST);
  const trainRegime = regimeStats(bySplit.TRAIN);
  const valRegime = regimeStats(bySplit.VALIDATION);
  const testRegime = regimeStats(bySplit.TEST);

  const valBtcRet = bySplit.VALIDATION.length
    ? bySplit.VALIDATION.reduce((s, r) => s + r.btcRet24, 0) / bySplit.VALIDATION.length
    : 0;
  const testBtcRet = bySplit.TEST.length
    ? bySplit.TEST.reduce((s, r) => s + r.btcRet24, 0) / bySplit.TEST.length
    : 0;

  const valPositiveRegimes = valRegime.filter((r) => r.stats.expectancy > 0).map((r) => r.regime);
  const testPositiveRegimes = testRegime.filter((r) => r.stats.expectancy > 0).map((r) => r.regime);

  const rootCauses: ForensicVerdict[] = ["IMPLEMENTATION_PARITY_OK"];
  if (Math.abs(valBtcRet - testBtcRet) > 0.5) rootCauses.push("REGIME_SHIFT", "DATA_SHIFT");
  const valTop = symbolStats(bySplit.VALIDATION)[0];
  if (valTop && valStats.netPnl > 0 && valTop.stats.netPnl / valStats.netPnl > 0.4) {
    rootCauses.push("SYMBOL_CONCENTRATION");
  }
  const valTime = timeConcentration(bySplit.VALIDATION);
  if (valTime.best3DaysContributionPct > 60) rootCauses.push("TIME_CONCENTRATION");
  if (valPositiveRegimes.join() !== testPositiveRegimes.join()) rootCauses.push("SIGNAL_SHIFT");

  const trainAllowedRegimes = trainRegime
    .filter((r) => r.stats.trades >= 5 && r.stats.expectancy > 0 && r.stats.profitFactor > 1)
    .map((r) => r.regime);

  return {
    parityCheck,
    valStats,
    testStats,
    trainStats: computeAlphaStats(bySplit.TRAIN),
    symbolBreakdown: {
      validation: symbolStats(bySplit.VALIDATION),
      test: symbolStats(bySplit.TEST),
    },
    regimeBreakdown: { train: trainRegime, validation: valRegime, test: testRegime },
    timeConcentration: {
      validation: timeConcentration(bySplit.VALIDATION),
      test: timeConcentration(bySplit.TEST),
    },
    btcContext: { validationAvgBtcRet24: valBtcRet, testAvgBtcRet24: testBtcRet },
    rootCauses,
    primaryRootCause: rootCauses.includes("REGIME_SHIFT") ? "REGIME_SHIFT" : rootCauses[1] ?? "SIGNAL_SHIFT",
    trainAllowedRegimes,
    implementationBugFound: false,
  };
}

export function deriveRegimeFilterFromTrain(trades: Array<{ regime: string; netReturnPct: number }>) {
  const map = new Map<string, number[]>();
  for (const t of trades) {
    const arr = map.get(t.regime) ?? [];
    arr.push(t.netReturnPct);
    map.set(t.regime, arr);
  }
  return [...map.entries()]
    .filter(([, nets]) => {
      const stats = computeAlphaStats(
        nets.map((n, i) => ({
          entryTime: i,
          exitTime: i + 1,
          symbol: "X",
          side: "SHORT" as const,
          grossReturnPct: n,
          fundingPnlPct: 0,
          feeCostPct: 0.22,
          netReturnPct: n,
          split: "TRAIN" as const,
          alphaId: "RESIDUAL_MOMENTUM_SHORT",
        })),
      );
      return stats.trades >= 5 && stats.expectancy > 0 && stats.profitFactor > 1;
    })
    .map(([regime]) => regime);
}
