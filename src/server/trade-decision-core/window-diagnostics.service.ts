import type { runTrySpotReplayUniverse } from "../alpha-engine-v2/try-spot-replay.service";
import { STRATEGY_ACCEPTANCE as A, equityFolds, contribution } from "./validation-evidence.service";
const DAY = 86400000;
export function recentDiagnosticWindows(datasetStart: number, datasetEnd: number) {
    if (!Number.isFinite(datasetStart) || !Number.isFinite(datasetEnd) || datasetEnd - datasetStart + 1 < 135 * DAY || (datasetEnd + 1) % DAY !== 0)
        throw new Error("INVALID_WINDOW_DATASET");
    return [
        ...[30, 60, 90].map(days => ({ id: `trailing_${days}d`, days, start: datasetEnd + 1 - days * DAY, end: datasetEnd, kind: "OVERLAPPING_TRAILING" })),
        ...[30, 60].map(offset => ({ id: `block_${offset + 1}_${offset + 30}d_ago`, days: 30, start: datasetEnd + 1 - (offset + 30) * DAY, end: datasetEnd - offset * DAY, kind: "DISJOINT_30D_BLOCK" })),
    ];
}
export function summarizeWindow(run: ReturnType<typeof runTrySpotReplayUniverse>, start: number, end: number) {
    const trades = run.trades, slip = run.config.slippageBpsPerSide / 10000;
    // Exact same-fill counterfactual: remove modeled slippage and fees without changing
    // signals, quantities or fills. This is attribution, NOT a zero-cost strategy run.
    const rawGross = trades.reduce((sum, t) => sum + t.exitPrice * t.quantity / (1 - slip) - t.notionalTry / (1 + slip), 0);
    const fillGross = trades.reduce((sum, t) => sum + t.exitPrice * t.quantity - t.notionalTry, 0);
    const fees = trades.reduce((sum, t) => sum + t.feeTry, 0);
    const net = trades.reduce((sum, t) => sum + t.netPnlTry, 0);
    const residual = net - (fillGross - fees);
    if (Math.abs(residual) > 1e-6 * Math.max(1, trades.length)) throw new Error("CLOSED_FILL_PNL_MISMATCH");
    const folds = equityFolds(run.equity, start, end, run.portfolio.initialCashTry);
    const foldRatio = folds.length ? folds.filter(f => f.netPnlTry > 0).length / folds.length : 0;
    const conc = contribution(trades), reasons: string[] = [];
    if (trades.length < A.minTrades) reasons.push("LOW_SAMPLE");
    if (run.stats.expectancy <= 0 || run.portfolio.netPnlTry <= 0) reasons.push("NONPOSITIVE_NET_PNL");
    if (run.stats.profitFactor <= A.minProfitFactor) reasons.push("PROFIT_FACTOR");
    if (run.portfolio.maxDrawdownPct >= A.maxDrawdownPct) reasons.push("DRAWDOWN");
    if (foldRatio < A.minPositiveFoldRatio) reasons.push("TEMPORAL_INSTABILITY");
    if (conc.topSymbolContributionPct > A.maxTopSymbolContributionPct) reasons.push("CONCENTRATION");
    if (run.openPositions.length) reasons.push("OPEN_POSITIONS");
    const byExit: Record<string, { trades: number; netPnlTry: number }> = {};
    for (const t of trades) {
        const row = byExit[t.exitReason] ??= { trades: 0, netPnlTry: 0 };
        row.trades++; row.netPnlTry += t.netPnlTry;
    }
    const average = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return {
        trades: trades.length, wins: run.stats.wins, netPnlTry: run.portfolio.netPnlTry,
        returnPct: run.portfolio.netPnlTry / run.portfolio.initialCashTry * 100,
        profitFactor: run.stats.losses ? run.stats.profitFactor : null,
        profitFactorStatus: !trades.length ? "NO_TRADES" : run.stats.losses ? "FINITE" : "NO_LOSING_TRADES",
        maxDrawdownPct: run.portfolio.maxDrawdownPct, openPositions: run.openPositions,
        closedTradeCosts: { rawGrossPnlTry: rawGross, modeledSlippageTry: rawGross - fillGross, feesTry: fees, netPnlTry: net, reconciliationResidualTry: residual,
            scope: "IDENTICAL_CLOSED_FILLS_ONLY_NOT_ZERO_COST_REPLAY" },
        unfinishedPositionPnlTry: run.portfolio.netPnlTry - net,
        meanHoldHours: average(trades.map(t => (t.exitAtMs - t.entryAtMs) / 3600000)),
        meanEntryDelayMinutes: average(trades.map(t => (t.entryAtMs - t.signalAtMs) / 60000)),
        sampledInvestedPct: average(run.equity.map(p => p.equityTry > 0 ? (p.equityTry - p.cashTry) / p.equityTry * 100 : 0)),
        exposureMethod: "HOURLY_AND_DAY_BOUNDARY_SAMPLE_NOT_EXACT_TIME_WEIGHTED",
        expiredOrders: run.portfolio.expiredOrders, rejectedCashOrCapacity: run.portfolio.rejectedCash,
        riskRejectedEntries: run.portfolio.riskRejectedEntries, riskBlockedSignals: run.portfolio.riskBlockedSignals, entryDiagnostics: run.entryDiagnostics,
        byExit, bySymbol: conc.bySymbol, positiveFoldRatio: foldRatio,
        economicScreen: { pass: reasons.length === 0, reasons },
        paperEligible: null, promotionStatus: "BLOCKED_SEEN_DIAGNOSTICS",
    };
}
