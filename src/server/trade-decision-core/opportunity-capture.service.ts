import type { TryBar } from "./types";
import type { EquityPoint } from "../alpha-engine-v2/try-spot-replay.service";
const DAY = 86400000;
export type OpportunityDay = { dayStart: number; symbol: string; activeMinutes: number; firstClose: number;
  closeReturnPct: number; peakCloseReturnPct: number; intrabarHighReturnPct: number;
  firstTwoPctAt: number | null; remainingPeakAfterNextMinutePct: number | null;
  nextHourLatencyMinutes: number | null; quoteVolumeTry: number };
/** Ex-post labels for coverage diagnostics ONLY. Never import this into an entry evaluator.
 * Counts coin-days, not overlapping windows or fictitious trough-to-peak trades.
 * Next-minute remaining peak is an optimistic descriptive ceiling, not executable P&L.
 */
export function opportunityDays(symbol: string, bars: TryBar[]): OpportunityDay[] {
  const result: OpportunityDay[] = [];
  let bucket: TryBar[] = [], day = -1;
  const flush = () => {
    if (!bucket.length) return;
    const first = bucket[0], last = bucket.at(-1)!;
    const peak = Math.max(...bucket.map(b => b.close)), high = Math.max(...bucket.map(b => b.high));
    const crossing = bucket.findIndex(b => b.close >= first.close * 1.02), next = crossing >= 0 ? bucket[crossing + 1] : undefined;
    const after = next && next.closeTime - bucket[crossing].closeTime === 60000 ? bucket.slice(crossing + 1) : [];
    const at = crossing >= 0 ? bucket[crossing].closeTime : null;
    result.push({ dayStart: day * DAY, symbol, activeMinutes: bucket.length, firstClose: first.close,
      closeReturnPct: (last.close / first.close - 1) * 100, peakCloseReturnPct: (peak / first.close - 1) * 100,
      intrabarHighReturnPct: (high / first.close - 1) * 100, firstTwoPctAt: at,
      remainingPeakAfterNextMinutePct: after.length ? (Math.max(...after.map(b => b.close)) / after[0].close - 1) * 100 : null,
      nextHourLatencyMinutes: at === null ? null : ((Math.ceil((at + 1) / 3600000) * 3600000 - 1) - at) / 60000,
      quoteVolumeTry: bucket.reduce((n,b) => n + b.quoteVolume, 0) });
  };
  for (const b of bars) {
    const current = Math.floor(b.openTime / DAY);
    if (current !== day) { flush(); bucket = []; day = current; }
    if (b.volume > 0 && b.quoteVolume > 0) bucket.push(b);
  }
  flush(); return result;
}

export function dailyAccountTargets(equity: EquityPoint[], initialCash: number, start: number, end: number) {
  const boundaries = new Map(equity.filter(p => p.atMs >= start && p.atMs <= end && (p.atMs + 1) % DAY === 0).map(p => [p.atMs, p.equityTry]));
  const daily: Array<{ end: number; returnPct: number }> = [];
  let previous = initialCash;
  for (let at = start + DAY - 1; at <= end; at += DAY) {
    const value = boundaries.get(at);
    // Missing data must not silently become a zero-return cash day.
    if (value == null || !(value > 0 && previous > 0)) return { status: "INCOMPLETE_DAY_BOUNDARIES", daily };
    daily.push({ end: at, returnPct: (value / previous - 1) * 100 }); previous = value;
  }
  return { status: "COMPLETE", daily, totalDays: daily.length,
    geometricDailyReturnPct: daily.length ? (Math.pow(previous / initialCash, 1 / daily.length) - 1) * 100 : null,
    negativeDays: daily.filter(d => d.returnPct < -1e-10).length,
    flatDays: daily.filter(d => Math.abs(d.returnPct) <= 1e-10).length,
    targets: [1,2,3,4].map(pct => ({ pct, daysMet: daily.filter(d => d.returnPct >= pct).length, everyDayMet: daily.length > 0 && daily.every(d => d.returnPct >= pct) })) };
}
