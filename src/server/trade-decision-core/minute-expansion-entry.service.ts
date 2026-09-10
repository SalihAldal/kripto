import type { ExternalSymbolPanel } from "../alpha-engine-v2/external-market-data.types";
import type { EntrySignalIntent, MarketSnapshot, StrategyVariantConfig, TryBar } from "./types";
import { LOCAL_ENTRY_RISK, roundTripCostPct } from "./local-entry-risk.service";
export const MINUTE_EXPANSION_RULES = Object.freeze({ version: "minute-expansion-frozen-v1", cadenceMs: 300000,
  historyMinutes: 75, volumeMultiplier: 2, minMovePct: .5, maxMovePct: 3,
  minStopPct: .5, maxStopPct: 3, trailArmR: 2, trailDistanceR: 1 });
/** A bounded research hypothesis. No daily winner list, intrabar path, or future hour input. */
export function evaluateMinuteExpansionEntry(input: { panel: ExternalSymbolPanel; snapshot: MarketSnapshot; variant: StrategyVariantConfig }): EntrySignalIntent | null {
  const { panel, snapshot: s, variant } = input, rule = MINUTE_EXPANSION_RULES;
  const count = (reason: string) => { if (s.entryDiagnostics) s.entryDiagnostics[reason] = (s.entryDiagnostics[reason] ?? 0) + 1; };
  const reject = (reason: string): null => { count(reason); return null; };
  count("EVALUATED");
  if ((s.nowMs + 1) % rule.cadenceMs !== 0 || !s.executionEstimate || !Number.isFinite(s.btcExternalReturn4hPct) || s.btcExternalReturn4hPct! < -1) return reject("CADENCE_OR_BTC_SHOCK");
  const local = (panel as ExternalSymbolPanel & { executionBarsTRY?: TryBar[] }).executionBarsTRY;
  if (!local || !Number.isInteger(s.tryBarIdx) || s.tryBarIdx < rule.historyMinutes - 1) return reject("LOCAL_HISTORY_MISSING");
  const rows = local.slice(s.tryBarIdx - rule.historyMinutes + 1, s.tryBarIdx + 1), last = rows.at(-1)!;
  if (rows.some((b, i) => b.closeTime > s.nowMs || ![b.closeTime,b.close,b.high,b.low,b.volume,b.quoteVolume].every(Number.isFinite) || b.low <= 0 || b.high < b.close || b.low > b.close || b.volume < 0 || b.quoteVolume < 0 || (i > 0 && b.closeTime - rows[i-1].closeTime !== 60000)) || last.closeTime !== s.nowMs || last.close !== s.tryPrice) return reject("LOCAL_DATA_GAP");
  const recent = rows.slice(-15), prior = rows.slice(0, -15);
  const quote = recent.reduce((n, b) => n + b.quoteVolume, 0), volume = recent.reduce((n, b) => n + b.volume, 0);
  const baseQuote = prior.reduce((n, b) => n + b.quoteVolume, 0) / 4;
  if (recent.filter(b => b.volume > 0 && b.quoteVolume > 0).length < 12 || last.volume <= 0 || last.quoteVolume <= 0 || !(baseQuote > 0 && volume > 0 && quote >= rule.volumeMultiplier * baseQuote)) return reject("LOCAL_VOLUME_EXPANSION");
  const move = (last.close / prior.at(-1)!.close - 1) * 100;
  if (move < rule.minMovePct || move > rule.maxMovePct || last.close <= Math.max(...prior.map(b => b.high)) || last.close <= quote / volume) return reject("LOCAL_BREAKOUT_OR_CHASE");
  const stop = Math.min(...recent.map(b => b.low)) * .999, distancePct = (1 - stop / last.close) * 100;
  const cost = roundTripCostPct(s.executionEstimate.feePerSidePct, s.executionEstimate.slippageBpsPerSide);
  if (distancePct < rule.minStopPct || distancePct > rule.maxStopPct || 2 * distancePct < 3 * cost) return reject("STOP_OR_COST_ROOM");
  count("INTENT_ACCEPTED");
  return { signalId: `${variant.id}:${panel.symbol}:${s.nowMs}`, strategyVersion: rule.version, variantId: variant.id, alphaId: variant.alphaId,
    side: "LONG", signalAtMs: s.nowMs, availableAtMs: s.nowMs, invalidationPrice: stop, invalidationCurrency: "TRY",
    reasonCodes: ["MINUTE_PRICE_VOLUME_EXPANSION", "RESEARCH_ONLY"], metadata: { tryPrice: last.close, stopDistance: distancePct / 100,
      executionRiskVersion: LOCAL_ENTRY_RISK.version, localAvailableAtMs: last.closeTime, quoteVolumeRatio: quote / baseQuote, move15mPct: move,
      estimatedRoundTripCostPct: cost, stopSource: "CLOSED_TRY_15M_LOW" } };
}
/** Closing marks only. Activation and distance scale with initial execution-price risk. */
export function expansionTrailingStop(entry: number, initialStop: number, peakClose: number) {
  const risk = entry - initialStop;
  return risk > 0 && peakClose >= entry + MINUTE_EXPANSION_RULES.trailArmR * risk
    ? Math.max(initialStop, peakClose - MINUTE_EXPANSION_RULES.trailDistanceR * risk) : initialStop;
}
