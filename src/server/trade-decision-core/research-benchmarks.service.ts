import type { TrySpotPanel } from "./try-dataset-loader.service";
import type { TryBar } from "./types";
/** Buy-and-hold comparisons use the same delayed closed-bar/volume-cap model.
 * They are fully allocated benchmarks, not exposure-matched alpha estimates.
 */
export function spotHoldBenchmark(panels: TrySpotPanel[], start: number, end: number, cash = 10000, fee = .0015, slip = .0007) {
    const stake = cash / Math.max(panels.length, 1) / (1 + fee);
    let value = cash, entries = 0;
    for (const panel of panels) {
        let qty = 0, entryCost = 0, lastMark = 0;
        for (const b of panel.executionBarsTRY) {
            if (b.closeTime <= start)
                continue;
            if (b.closeTime > end)
                break;
            if (b.volume <= 0 || b.quoteVolume <= 0)
                continue;
            lastMark = b.close;
            if (qty === 0 && b.quoteVolume * .01 >= stake) {
                qty = Math.floor(stake / (b.close * (1 + slip)) * 1e8) / 1e8;
                entryCost = qty * b.close * (1 + slip) * (1 + fee);
                if (qty > 0)
                    entries++;
            }
        }
        if (qty > 0)
            value += qty * lastMark - entryCost;
    }
    return { initialCashTry: cash, finalMarkedEquityTry: value, netPnlTry: value - cash, returnPct: (value / cash - 1) * 100, entries, exitFeesIncluded: false, model: "BUY_AND_HOLD_MARKED_NOT_LIQUIDATED_NOT_EXPOSURE_MATCHED" };
}
export function currencyAdjustedReturn(bars: TryBar[], start: number, end: number, initialTry: number, finalTry: number) {
    let first: TryBar | undefined, last: TryBar | undefined;
    for (const b of bars) {
        if (b.closeTime > end)
            break;
        if (b.volume <= 0)
            continue;
        if (b.closeTime <= start)
            first = b;
        last = b;
    }
    if (!first || !last || start - first.closeTime > 300000 || end - last.closeTime > 300000)
        return { status: "MISSING_OR_STALE_FX", returnUsdtPct: null };
    return { status: "CONTEXT_TRANSLATION_NOT_FX_EXECUTION", startUsdtTry: first.close, endUsdtTry: last.close,
        returnUsdtPct: ((finalTry / last.close) / (initialTry / first.close) - 1) * 100 };
}
