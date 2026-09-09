import type { ExternalSymbolPanel } from "../alpha-engine-v2/external-market-data.types";
import type { EntrySignalIntent, MarketSnapshot, StrategyVariantConfig, TryBar } from "./types";
import { LOCAL_ENTRY_RISK, roundTripCostPct } from "./local-entry-risk.service";
const HOUR = 3600000;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
export const LOCAL_ENTRY_RULES = Object.freeze({ trendHours: 168, fastHours: 48, rangeHours: 24, quoteVolumeMultiplier: 1.2,
    minActiveMinutes: 54, minRangeToCost: 3, minStopPct: .5, maxStopPct: 5, version: "local-confirmed-frozen-v1" });
/** Uses only closed external hours and contiguous local minutes already available.
 * Historical range/cost is a feasibility screen, not a forecast of expected profit.
 */
export function evaluateLocalConfirmedEntry(input: { panel: ExternalSymbolPanel; barIdx: number; snapshot: MarketSnapshot; variant: StrategyVariantConfig }): EntrySignalIntent | null {
    const { panel, barIdx: i, snapshot: s, variant } = input, rule = LOCAL_ENTRY_RULES;
    const count = (reason: string) => { if (s.entryDiagnostics) s.entryDiagnostics[reason] = (s.entryDiagnostics[reason] ?? 0) + 1; };
    const reject = (reason: string): null => { count(reason); return null; };
    count("EVALUATED");
    if (i < rule.trendHours || !s.executionEstimate || !Number.isFinite(s.btcExternalReturn4hPct) || s.btcExternalReturn4hPct! < -1) return reject("CONTEXT_OR_BTC_SHOCK");
    const b = panel.bars[i], history = panel.bars.slice(i - rule.trendHours, i + 1);
    if (history.some((row, k) => row.closeTime > s.nowMs || ![row.close, row.high, row.low, row.quoteVolume].every(Number.isFinite) || row.close <= 0 || row.quoteVolume < 0 || (k > 0 && row.closeTime - history[k - 1].closeTime !== HOUR))) return reject("EXTERNAL_DATA_GAP");
    const before = history.slice(0, -1), fast = mean(before.slice(-rule.fastHours).map(x => x.close)), slow = mean(before.map(x => x.close));
    if (!(b.close > slow && fast > slow)) return reject("EXTERNAL_TREND");
    const past24 = before.slice(-24), avgVolume = mean(past24.map(x => x.quoteVolume));
    const atr = mean(past24.map((x, k) => Math.max(x.high - x.low, Math.abs(x.high - panel.bars[i - 25 + k].close), Math.abs(x.low - panel.bars[i - 25 + k].close))));
    const costPct = roundTripCostPct(s.executionEstimate.feePerSidePct, s.executionEstimate.slippageBpsPerSide);
    const rangeRoomPct = 2 * atr / b.close * 100;
    if (!(avgVolume > 0 && b.quoteVolume >= rule.quoteVolumeMultiplier * avgVolume && rangeRoomPct >= costPct * rule.minRangeToCost)) return reject("VOLUME_OR_COST_ROOM");
    const prev = panel.bars[i - 1];
    const setup = variant.entryCandidate === "local_breakout"
        ? b.close > Math.max(...past24.map(x => x.high))
        : Math.min(...before.slice(-3).map(x => x.low)) <= mean(past24.map(x => x.close)) && b.close > prev.high && b.close > fast;
    if (!setup) return reject("EXTERNAL_SETUP");
    const local = (panel as ExternalSymbolPanel & { executionBarsTRY?: TryBar[] }).executionBarsTRY;
    if (!local || !Number.isInteger(s.tryBarIdx) || s.tryBarIdx < 179) return reject("LOCAL_HISTORY_MISSING");
    const rows = local.slice(s.tryBarIdx - 179, s.tryBarIdx + 1);
    if (rows.length !== 180 || rows.some((x, k) => x.closeTime > s.nowMs || ![x.close, x.high, x.low, x.volume, x.quoteVolume].every(Number.isFinite) || x.close <= 0 || x.low <= 0 || x.volume < 0 || x.quoteVolume < 0 || (k > 0 && x.closeTime - rows[k - 1].closeTime !== 60000))) return reject("LOCAL_DATA_GAP");
    const last = rows[179];
    if (s.nowMs - last.closeTime > 60000 || last.close !== s.tryPrice || last.volume <= 0 || last.quoteVolume <= 0) return reject("LOCAL_STALE_OR_NO_TRADE");
    const hour = rows.slice(-60), prior = rows.slice(0, -60);
    const quote = hour.reduce((sum, x) => sum + x.quoteVolume, 0), volume = hour.reduce((sum, x) => sum + x.volume, 0);
    if (hour.filter(x => x.volume > 0 && x.quoteVolume > 0).length < rule.minActiveMinutes || volume <= 0 || quote < prior.reduce((sum, x) => sum + x.quoteVolume, 0) / 2) return reject("LOCAL_LIQUIDITY");
    const vwap = quote / volume;
    const localTrigger = variant.entryCandidate === "local_breakout" ? last.close > Math.max(...prior.map(x => x.high)) : last.close > Math.max(...rows.slice(-30, -15).map(x => x.high));
    if (!localTrigger || last.close <= vwap) return reject("LOCAL_PRICE_CONFIRMATION");
    const stop = Math.min(...hour.map(x => x.low)) * .999, stopPct = (1 - stop / last.close) * 100;
    if (stopPct < rule.minStopPct || stopPct > rule.maxStopPct) return reject("LOCAL_STOP_DISTANCE");
    count("INTENT_ACCEPTED");
    return { signalId: `${variant.id}:${panel.symbol}:${b.closeTime}`, strategyVersion: rule.version, variantId: variant.id, alphaId: variant.alphaId,
        side: "LONG", signalAtMs: b.closeTime, availableAtMs: b.closeTime, invalidationPrice: stop, invalidationCurrency: "TRY",
        reasonCodes: [variant.entryCandidate, "LOCAL_PRICE_VOLUME_CONFIRMED", "RANGE_EXCEEDS_MODELED_COST", "RESEARCH_ONLY"],
        metadata: { tryPrice: last.close, stopDistance: stopPct / 100, executionRiskVersion: LOCAL_ENTRY_RISK.version, rangeRoomPct, estimatedRoundTripCostPct: costPct,
            localVwap: vwap, externalQuoteVolumeRatio: b.quoteVolume / avgVolume, localAvailableAtMs: last.closeTime, stopSource: "PRIOR_CLOSED_TRY_HOUR_LOW" } };
}
