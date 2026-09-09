import type { ExternalSymbolPanel } from "../alpha-engine-v2/external-market-data.types";
import type { EntrySignalIntent, MarketSnapshot, StrategyVariantConfig, TryBar } from "./types";
import { LOCAL_ENTRY_RISK, roundTripCostPct } from "./local-entry-risk.service";

const HOUR = 3600000;

/** Frozen pre-registration rules — no post-hoc parameter search. */
export const ECON_ENTRY_RULES = Object.freeze({
  version: "econ-breakout-frozen-v1",
  trendHours: 168,
  fastHours: 48,
  breakoutLookbackHours: 24,
  pullbackLookbackHours: 72,
  volumeMultiplier: 1.3,
  rsMaxRank: 8,
  rsUniverseMin: 12,
  minActiveMinutes: 54,
  minRangeToCost: 3,
  minStopPct: 0.5,
  maxStopPct: 5,
  maxExtensionAtr: 3,
  pullbackAtrMin: 0.35,
  pullbackAtrMax: 1.5,
  minTryQuoteVolumeHour: 50_000,
  btcShockFloorPct: -1,
});

function mean(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function atrPct(bars: ExternalSymbolPanel["bars"], endIdx: number, hours = 24) {
  const slice = bars.slice(endIdx - hours, endIdx);
  return (
    slice.reduce((sum, x, k) => {
      const prev = bars[endIdx - hours + k - 1]?.close ?? x.close;
      return sum + Math.max(x.high - x.low, Math.abs(x.high - prev), Math.abs(x.low - prev));
    }, 0) / slice.length
  );
}

function validateLocalMinuteRows(local: TryBar[], tryBarIdx: number, nowMs: number) {
  if (!Number.isInteger(tryBarIdx) || tryBarIdx < 179) return null;
  const rows = local.slice(tryBarIdx - 179, tryBarIdx + 1);
  if (
    rows.length !== 180 ||
    rows.some(
      (x, k) =>
        x.closeTime > nowMs ||
        ![x.close, x.high, x.low, x.volume, x.quoteVolume].every(Number.isFinite) ||
        x.close <= 0 ||
        x.volume < 0 ||
        x.quoteVolume < 0 ||
        (k > 0 && x.closeTime - rows[k - 1].closeTime !== 60000),
    )
  ) {
    return null;
  }
  const last = rows[179];
  if (nowMs - last.closeTime > 60000 || last.volume <= 0 || last.quoteVolume <= 0) return null;
  return { rows, last };
}

export function evaluateEconBreakoutEntry(input: {
  panel: ExternalSymbolPanel;
  barIdx: number;
  snapshot: MarketSnapshot;
  variant: StrategyVariantConfig;
}): EntrySignalIntent | null {
  const { panel, barIdx: i, snapshot: s, variant } = input;
  const rule = ECON_ENTRY_RULES;
  const count = (reason: string) => {
    if (s.entryDiagnostics) s.entryDiagnostics[reason] = (s.entryDiagnostics[reason] ?? 0) + 1;
  };
  const reject = (reason: string): null => {
    count(reason);
    return null;
  };
  count("EVALUATED");

  if (i < rule.trendHours || !s.executionEstimate || !Number.isFinite(s.btcExternalReturn4hPct)) return reject("CONTEXT_MISSING");
  if (s.btcExternalReturn4hPct! < rule.btcShockFloorPct) return reject("BTC_REGIME_SHOCK");

  const b = panel.bars[i];
  const before = panel.bars.slice(i - rule.trendHours, i);
  if (before.some((row, k) => row.closeTime > s.nowMs || row.close <= 0 || (k > 0 && row.closeTime - before[k - 1].closeTime !== HOUR))) {
    return reject("EXTERNAL_DATA_GAP");
  }

  const fast = mean(before.slice(-rule.fastHours).map((x) => x.close));
  const slow = mean(before.map((x) => x.close));
  if (!(b.close > slow && fast > slow)) return reject("TREND_FILTER");

  const past24 = before.slice(-rule.breakoutLookbackHours);
  const avgVolume = mean(past24.map((x) => x.quoteVolume));
  const atr = atrPct(panel.bars, i);
  const costPct = roundTripCostPct(s.executionEstimate.feePerSidePct, s.executionEstimate.slippageBpsPerSide);
  const rangeRoomPct = (2 * atr / b.close) * 100;
  if (!(avgVolume > 0 && b.quoteVolume >= rule.volumeMultiplier * avgVolume && rangeRoomPct >= costPct * rule.minRangeToCost)) {
    return reject("VOLUME_OR_COST_ROOM");
  }

  if (b.close > slow + rule.maxExtensionAtr * atr) return reject("OVEREXTENSION");

  const rsRank = s.relativeStrengthRank ?? Infinity;
  if (rsRank > rule.rsMaxRank) return reject("RELATIVE_STRENGTH");

  let setup = false;
  let setupCode = variant.entryCandidate;
  if (variant.entryCandidate === "econ_breakout_rs") {
    setup = b.close > Math.max(...past24.map((x) => x.high));
  } else if (variant.entryCandidate === "econ_pullback_reclaim") {
    const lookback = panel.bars.slice(Math.max(0, i - rule.pullbackLookbackHours), i);
    const breakoutIdx = lookback.findIndex((row, idx) => {
      const prior = lookback.slice(Math.max(0, idx - rule.breakoutLookbackHours), idx);
      if (prior.length < rule.breakoutLookbackHours) return false;
      return row.close > Math.max(...prior.map((x) => x.high));
    });
    if (breakoutIdx < 0) return reject("NO_PRIOR_BREAKOUT");
    const breakoutLevel = lookback[breakoutIdx].close;
    const pullbackDepth = (breakoutLevel - Math.min(...lookback.slice(breakoutIdx).map((x) => x.low))) / atr;
    const reclaim = b.close > panel.bars[i - 1].high && b.close > breakoutLevel * 0.995;
    setup = pullbackDepth >= rule.pullbackAtrMin && pullbackDepth <= rule.pullbackAtrMax && reclaim;
  } else {
    return reject("UNKNOWN_ECON_CANDIDATE");
  }
  if (!setup) return reject("EXTERNAL_SETUP");

  const local = (panel as ExternalSymbolPanel & { executionBarsTRY?: TryBar[] }).executionBarsTRY;
  if (!local) return reject("LOCAL_HISTORY_MISSING");
  const minute = validateLocalMinuteRows(local, s.tryBarIdx, s.nowMs);
  if (!minute) return reject("LOCAL_DATA_GAP");
  const { rows, last } = minute;
  if (last.close !== s.tryPrice) return reject("LOCAL_STALE");

  const hour = rows.slice(-60);
  const quote = hour.reduce((sum, x) => sum + x.quoteVolume, 0);
  const volume = hour.reduce((sum, x) => sum + x.volume, 0);
  if (hour.filter((x) => x.volume > 0).length < rule.minActiveMinutes || quote < rule.minTryQuoteVolumeHour) {
    return reject("LOCAL_LIQUIDITY");
  }
  const vwap = quote / volume;
  const localTrigger =
    variant.entryCandidate === "econ_breakout_rs"
      ? last.close > Math.max(...rows.slice(0, -1).map((x) => x.high))
      : last.close > Math.max(...rows.slice(-30, -5).map((x) => x.high));
  if (!localTrigger || last.close <= vwap) return reject("LOCAL_PRICE_CONFIRMATION");

  const stop = Math.min(...hour.map((x) => x.low)) * 0.999;
  const stopPct = (1 - stop / last.close) * 100;
  if (stopPct < rule.minStopPct || stopPct > rule.maxStopPct) return reject("LOCAL_STOP_DISTANCE");

  count("INTENT_ACCEPTED");
  return {
    signalId: `${variant.id}:${panel.symbol}:${b.closeTime}`,
    strategyVersion: rule.version,
    variantId: variant.id,
    alphaId: variant.alphaId,
    side: "LONG",
    signalAtMs: b.closeTime,
    availableAtMs: b.closeTime,
    invalidationPrice: stop,
    invalidationCurrency: "TRY",
    reasonCodes: [setupCode, "ECON_TRY_CONFIRMED", "RESEARCH_ONLY"],
    metadata: {
      tryPrice: last.close,
      stopDistance: stopPct / 100,
      executionRiskVersion: LOCAL_ENTRY_RISK.version,
      rangeRoomPct,
      estimatedRoundTripCostPct: costPct,
      localVwap: vwap,
      relativeStrengthRank: rsRank,
      externalQuoteVolumeRatio: b.quoteVolume / avgVolume,
      localAvailableAtMs: last.closeTime,
      regime: s.btcExternalReturn4hPct,
    },
  };
}
