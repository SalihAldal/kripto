import {
  simulateAlphaAtBar,
  type AlphaSimulatorId,
  type HistoricalBar,
  type SymbolHistoricalPanel,
} from "./historical-alpha-simulator.service";
import { resolveRoundTripCostPct } from "./cost-model-v2.service";
import { computeAlphaStats } from "./validation-framework.service";
import type { AlphaTradeRecord } from "./types";
import { buildRegimeTimeline, regimeAtTime, type CompositeRegime } from "./regime-engine-v2.service";

export type AlphaRegimeCell = {
  alphaId: AlphaSimulatorId;
  regime: CompositeRegime;
  trades: number;
  netPnl: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  winRate: number;
  eligible: boolean;
};

export function buildAlphaRegimeMatrix(input: {
  alphaIds: AlphaSimulatorId[];
  panels: SymbolHistoricalPanel[];
  btc: HistoricalBar[];
  startIdx: number;
  endIdx: number;
  stepHours: number;
  startTime: number;
  endTime: number;
}): AlphaRegimeCell[] {
  const costPct = resolveRoundTripCostPct("FUTURES", "REALISTIC");
  const timeline = buildRegimeTimeline(input.btc, input.startIdx);
  const buckets = new Map<string, AlphaTradeRecord[]>();

  for (let idx = input.startIdx; idx < input.endIdx; idx += input.stepHours) {
    const t = input.panels[0]?.bars[idx]?.closeTime ?? 0;
    if (t < input.startTime || t > input.endTime) continue;
    const regime = regimeAtTime(timeline, t)?.regime ?? "SIDEWAYS";
    for (const alphaId of input.alphaIds) {
      const trades = simulateAlphaAtBar({
        alphaId,
        panels: input.panels,
        btc: input.btc,
        idx,
        split: "TRAIN",
        costPct,
      });
      for (const trade of trades) {
        const key = `${alphaId}::${regime}`;
        const arr = buckets.get(key) ?? [];
        arr.push(trade);
        buckets.set(key, arr);
      }
    }
  }

  const cells: AlphaRegimeCell[] = [];
  for (const alphaId of input.alphaIds) {
    for (const regime of [
      "UPTREND_HIGH_VOL",
      "UPTREND_LOW_VOL",
      "DOWNTREND_HIGH_VOL",
      "DOWNTREND_LOW_VOL",
      "SIDEWAYS",
      "TRANSITION",
    ] as CompositeRegime[]) {
      const trades = buckets.get(`${alphaId}::${regime}`) ?? [];
      const stats = computeAlphaStats(trades);
      cells.push({
        alphaId,
        regime,
        trades: stats.trades,
        netPnl: stats.netPnl,
        expectancy: stats.expectancy,
        profitFactor: stats.profitFactor,
        maxDrawdown: stats.maxDrawdown,
        winRate: stats.trades ? stats.wins / stats.trades : 0,
        eligible: stats.trades >= 5 && stats.netPnl > 0 && stats.expectancy > 0 && stats.profitFactor > 1,
      });
    }
  }
  return cells;
}

export function eligibilityMapFromCells(cells: AlphaRegimeCell[]): Map<CompositeRegime, AlphaSimulatorId[]> {
  const map = new Map<CompositeRegime, AlphaSimulatorId[]>();
  const byRegime = new Map<CompositeRegime, AlphaRegimeCell[]>();
  for (const cell of cells.filter((c) => c.eligible)) {
    const arr = byRegime.get(cell.regime) ?? [];
    arr.push(cell);
    byRegime.set(cell.regime, arr);
  }
  for (const [regime, rows] of byRegime) {
    map.set(
      regime,
      rows.sort((a, b) => b.expectancy - a.expectancy || b.profitFactor - a.profitFactor).map((r) => r.alphaId),
    );
  }
  return map;
}

export type RouterDecision = {
  timestamp: number;
  regime: CompositeRegime;
  selectedAlpha: AlphaSimulatorId | null;
  side: "LONG" | "SHORT" | "CASH";
  reason: string;
  trades: AlphaTradeRecord[];
};

export function routeRegimeAlpha(input: {
  panels: SymbolHistoricalPanel[];
  btc: HistoricalBar[];
  eligibility: Map<CompositeRegime, AlphaSimulatorId[]>;
  startIdx: number;
  endIdx: number;
  stepHours: number;
  startTime: number;
  endTime: number;
  preferCashOnTransition: boolean;
}): { decisions: RouterDecision[]; trades: AlphaTradeRecord[] } {
  const costPct = resolveRoundTripCostPct("FUTURES", "REALISTIC");
  const timeline = buildRegimeTimeline(input.btc, input.startIdx);
  const decisions: RouterDecision[] = [];
  const trades: AlphaTradeRecord[] = [];

  for (let idx = input.startIdx; idx < input.endIdx; idx += input.stepHours) {
    const t = input.panels[0]?.bars[idx]?.closeTime ?? 0;
    if (t < input.startTime || t > input.endTime) continue;
    const snap = regimeAtTime(timeline, t);
    const regime = snap?.regime ?? "SIDEWAYS";

    if (input.preferCashOnTransition && regime === "TRANSITION") {
      decisions.push({
        timestamp: t,
        regime,
        selectedAlpha: null,
        side: "CASH",
        reason: "TRANSITION_CASH",
        trades: [],
      });
      continue;
    }

    const eligible = input.eligibility.get(regime) ?? [];
    if (!eligible.length) {
      decisions.push({
        timestamp: t,
        regime,
        selectedAlpha: null,
        side: "CASH",
        reason: "NO_ELIGIBLE_ALPHA",
        trades: [],
      });
      continue;
    }

    const alphaId = eligible[0];
    const batch = simulateAlphaAtBar({
      alphaId,
      panels: input.panels,
      btc: input.btc,
      idx,
      split: "TEST",
      costPct,
    });
    const side = batch[0]?.side ?? "CASH";
    decisions.push({
      timestamp: t,
      regime,
      selectedAlpha: alphaId,
      side: side === "CASH" ? "CASH" : side,
      reason: "REGIME_ROUTED",
      trades: batch,
    });
    trades.push(...batch);
  }

  return { decisions, trades };
}

export function pnlConcentration(trades: AlphaTradeRecord[]) {
  const bySymbol = new Map<string, number>();
  const byDay = new Map<string, number>();
  let total = 0;
  for (const t of trades) {
    const pnl = (t.netReturnPct / 100) * 1000;
    total += pnl;
    bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + pnl);
    const day = new Date(t.entryTime).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + pnl);
  }
  const topSymbol = [...bySymbol.entries()].sort((a, b) => b[1] - a[1])[0];
  const topDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    topSymbolContributionPct: total !== 0 ? Number(((topSymbol?.[1] ?? 0) / total * 100).toFixed(2)) : 0,
    topDayContributionPct: total !== 0 ? Number(((topDay?.[1] ?? 0) / total * 100).toFixed(2)) : 0,
    topSymbol: topSymbol?.[0] ?? "",
    topDay: topDay?.[0] ?? "",
  };
}
