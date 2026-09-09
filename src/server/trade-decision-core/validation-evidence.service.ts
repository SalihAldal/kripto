import type { EquityPoint } from "../alpha-engine-v2/try-spot-replay.service";
import type { TrySpotTradeRecord } from "./types";
export const STRATEGY_ACCEPTANCE = Object.freeze({ minTrades: 40, minExpectancy: 0, minProfitFactor: 1.05, maxDrawdownPct: 20, minPositiveFoldRatio: .55, maxTopSymbolContributionPct: 45 });
export function equityFolds(points: EquityPoint[], start: number, end: number, initialCash: number) {
    const days15 = 15 * 86400000, folds: {
        start: number;
        end: number;
        netPnlTry: number;
    }[] = [];
    let cursor = 0, balance = initialCash;
    for (let a = start; a + days15 - 1 <= end; a += days15) {
        const before = balance;
        while (cursor < points.length && points[cursor].atMs < a + days15)
            balance = points[cursor++].equityTry;
        folds.push({ start: a, end: a + days15 - 1, netPnlTry: balance - before });
    }
    return folds;
}
/** Deterministic weekly block bootstrap, retaining daily cross-symbol dependence.
 * Descriptive interval, not a multiple-testing-adjusted promotion criterion.
 */
export function weeklyBootstrap(points: EquityPoint[], initialCash: number) {
    const days = new Map<number, number>();
    for (const p of points)
        days.set(Math.floor(p.atMs / 86400000), p.equityTry);
    let previous = initialCash;
    const daily = [...days.values()].map(v => { const r = previous > 0 ? v / previous - 1 : 0; previous = v; return r; });
    if (daily.length < 28)
        return { status: "INSUFFICIENT_DATA", lowerDailyMeanPct: null, upperDailyMeanPct: null };
    let seed = 41273;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const means: number[] = [];
    for (let b = 0; b < 1000; b++) {
        let sum = 0, n = 0;
        while (n < daily.length) {
            const from = Math.floor(random() * (daily.length - 6));
            for (let k = 0; k < 7 && n < daily.length; k++, n++)
                sum += daily[from + k];
        }
        means.push(sum / daily.length * 100);
    }
    means.sort((a, b) => a - b);
    return { status: "DESCRIPTIVE_ONLY_NOT_MULTIPLE_TEST_ADJUSTED", lowerDailyMeanPct: means[24], upperDailyMeanPct: means[974] };
}
export function contribution(trades: TrySpotTradeRecord[]) {
    const totals = new Map<string, number>();
    for (const t of trades)
        totals.set(t.symbol, (totals.get(t.symbol) ?? 0) + t.netPnlTry);
    const positive = [...totals].map(([symbol, pnl]) => ({ symbol, pnl: Math.max(pnl, 0) })).sort((a, b) => b.pnl - a.pnl);
    const total = positive.reduce((s, x) => s + x.pnl, 0);
    return { topSymbol: positive[0]?.symbol ?? null, topSymbolContributionPct: total ? positive[0].pnl / total * 100 : 0, bySymbol: Object.fromEntries(totals) };
}
