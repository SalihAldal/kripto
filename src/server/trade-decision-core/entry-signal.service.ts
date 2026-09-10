import { buildOiFeatures } from "@/src/server/alpha-engine-v2/oi-features.service";
import type { ExternalSymbolPanel } from "@/src/server/alpha-engine-v2/external-market-data.types";
import type { EntrySignalIntent, MarketSnapshot, StrategyVariantConfig, SignalAlphaId } from "./types";
import { evaluateLocalConfirmedEntry } from "./local-confirmed-entry.service";

import { evaluateMinuteExpansionEntry } from "./minute-expansion-entry.service";

function nearestFunding(panel: ExternalSymbolPanel, time: number) {
  let best: ExternalSymbolPanel["funding"][number] | undefined;
  for (const row of panel.funding) if (row.fundingTime <= time) best = row;
  return best;
}

function evaluateOiCore(panel: ExternalSymbolPanel, idx: number, alphaId: SignalAlphaId) {
  const feat = buildOiFeatures(panel, idx);
  if (!feat) return null;
  const funding = nearestFunding(panel, panel.bars[idx].closeTime);
  if (!funding && (alphaId === "OI_IMPULSE_LONG" || alphaId === "OI_IMPULSE_LONG_V2_FUNDING")) return null;
  const fund = funding?.fundingRate ?? 0;
  if (alphaId === "OI_IMPULSE_LONG") {
    if (feat.priceReturn4h > 0.3 && feat.oiDeltaPct > 1.5 && fund <= 0.0003) return { feat, fund };
    return null;
  }
  if (alphaId === "OI_IMPULSE_LONG_V2" || alphaId === "OI_IMPULSE_LONG_V2_FUNDING") {
    const core =
      feat.priceReturn4h > 0.15 &&
      feat.oiDeltaPct > 0.8 &&
      feat.oiPercentile >= 0.75 &&
      feat.oiZScore > 0.5;
    if (!core) return null;
    if (alphaId === "OI_IMPULSE_LONG_V2_FUNDING" && fund > 0.00025) return null;
    return { feat, fund };
  }
  return null;
}

export function evaluateEntrySignal(input: {
  variant: StrategyVariantConfig;
  panel: ExternalSymbolPanel;
  barIdx: number;
  snapshot: MarketSnapshot;
}): EntrySignalIntent | null {
  const bar = input.panel.bars[input.barIdx];
  if (!bar) return null;
  if (input.variant.researchOnly) return evaluateResearchEntry(input);
  const core = evaluateOiCore(input.panel, input.barIdx, input.variant.alphaId);
  if (!core) return null;

  if (input.variant.entryCandidate === "entry_regime_filter") {
    if ((input.snapshot.btcExternalReturn4hPct ?? 0) <= 0) return null;
  }
  if (input.variant.entryCandidate === "entry_liquidity_filter") {
    if (input.snapshot.tryVolume <= 0) return null;
    const tryBars = (input.panel as { executionBarsTRY?: Array<{ volume: number }> }).executionBarsTRY;
    const recentVol = tryBars?.slice(Math.max(0, input.snapshot.tryBarIdx - 60), input.snapshot.tryBarIdx + 1).reduce((s, b) => s + b.volume, 0) ?? 0;
    if (recentVol <= 0) return null;
  }

  // Preserve the external relative thesis distance, mapped to an as-of TRY mark.
  const invalidation = input.snapshot.tryPrice * (bar.low * 0.985 / bar.close);
  return {
    signalId: `${input.variant.id}:${input.panel.symbol}:${bar.closeTime}`,
    strategyVersion: input.variant.id,
    variantId: input.variant.id,
    alphaId: input.variant.alphaId,
    side: "LONG",
    signalAtMs: bar.closeTime,
    availableAtMs: bar.closeTime,
    invalidationPrice: invalidation,
    invalidationCurrency: "TRY",
    reasonCodes: [input.variant.entryCandidate, core.feat.oiDeltaPct > 1.5 ? "OI_IMPULSE" : "OI_V2"],
    metadata: {
      tryPrice: input.snapshot.tryPrice,
      externalInvalidationPrice: bar.low * 0.985,
      invalidationMapping: "RELATIVE_DISTANCE_AT_SIGNAL",
      oiDeltaPct: core.feat.oiDeltaPct,
      priceReturn4h: core.feat.priceReturn4h,
      funding: core.fund,
      btcRegime4h: input.snapshot.btcExternalReturn4hPct,
    },
  };
}

export const STRATEGY_VARIANTS: StrategyVariantConfig[] = [
  {
    id: "baseline_fixed_8h_v1",
    entryCandidate: "baseline_oi_v1",
    exitMode: "fixed_8h",
    alphaId: "OI_IMPULSE_LONG",
    oiFundingRequired: false,
    label: "OI V1 fixed 8h TRY",
    targetsLossMechanism: "baseline",
  },
  {
    id: "baseline_fixed_8h_v2",
    entryCandidate: "baseline_oi_v2",
    exitMode: "fixed_8h",
    alphaId: "OI_IMPULSE_LONG_V2",
    oiFundingRequired: false,
    label: "OI V2 fixed 8h TRY",
    targetsLossMechanism: "baseline",
  },
  {
    id: "entry_regime_filter_fixed_8h",
    entryCandidate: "entry_regime_filter",
    exitMode: "fixed_8h",
    alphaId: "OI_IMPULSE_LONG_V2",
    oiFundingRequired: false,
    label: "OI V2 + BTC regime filter",
    targetsLossMechanism: "regime_mismatch",
  },
  {
    id: "baseline_v2_pr04_trail",
    entryCandidate: "baseline_oi_v2",
    exitMode: "pr04_trail",
    alphaId: "OI_IMPULSE_LONG_V2",
    oiFundingRequired: false,
    label: "OI V2 + PR04 trailing exit",
    targetsLossMechanism: "giveback",
  },
  {
    id: "combined_regime_trail",
    entryCandidate: "entry_regime_filter",
    exitMode: "pr04_trail",
    alphaId: "OI_IMPULSE_LONG_V2",
    oiFundingRequired: false,
    label: "Regime filter + PR04 trail",
    targetsLossMechanism: "regime_mismatch+giveback",
  },
];


/** Frozen research hypotheses; never selectable through production getVariantById. */
export const RESEARCH_VARIANTS: StrategyVariantConfig[] = [
  { id: "research_trend_cash", entryCandidate: "trend_cash", exitMode: "research_trend", alphaId: "SPOT_TREND", oiFundingRequired: false, researchOnly: true, label: "Daily breakout + cash (research)" },
  { id: "research_relative_strength", entryCandidate: "relative_strength", exitMode: "research_trend", alphaId: "SPOT_RELATIVE_STRENGTH", oiFundingRequired: false, researchOnly: true, label: "Daily breakout + top-3 strength (research)" },
  { id: "research_shock_reclaim", entryCandidate: "shock_reclaim", exitMode: "research_trend", alphaId: "SPOT_SHOCK_RECLAIM", oiFundingRequired: false, researchOnly: true, label: "Price shock reclaim (research, not liquidation data)" },
  { id: "research_local_breakout", entryCandidate: "local_breakout", exitMode: "pr04_trail", alphaId: "LOCAL_BREAKOUT", oiFundingRequired: false, researchOnly: true, label: "TRY-confirmed hourly breakout + PR04 (frozen research)" },
  { id: "research_local_pullback", entryCandidate: "local_pullback", exitMode: "pr04_trail", alphaId: "LOCAL_PULLBACK", oiFundingRequired: false, researchOnly: true, label: "TRY-confirmed trend pullback + PR04 (frozen research)" },
];

function evaluateResearchEntry(input: {variant: StrategyVariantConfig; panel: ExternalSymbolPanel; barIdx: number; snapshot: MarketSnapshot}): EntrySignalIntent | null {
  if (input.variant.entryCandidate === "minute_expansion") return evaluateMinuteExpansionEntry(input);
  if (input.variant.entryCandidate === "local_breakout" || input.variant.entryCandidate === "local_pullback") return evaluateLocalConfirmedEntry(input);
  const {panel, barIdx: i, variant, snapshot} = input;
  if (i < 240 || snapshot.tryVolume <= 0) return null;
  const b = panel.bars[i];
  const past = panel.bars.slice(i - 240, i);
  const mean = past.reduce((sum, x) => sum + x.close, 0) / past.length;
  const atr = past.slice(-24).reduce((sum, x, k) => {
    const prev = panel.bars[i - 25 + k].close;
    return sum + Math.max(x.high - x.low, Math.abs(x.high - prev), Math.abs(x.low - prev));
  }, 0) / 24;
  if (!(atr > 0 && b.close > 0)) return null;
  let eligible: boolean;
  if (variant.entryCandidate === "shock_reclaim") {
    const prev = panel.bars[i - 1];
    const before = panel.bars[i - 2];
    eligible = prev.close < before.close - 2 * atr && b.close > prev.high && b.close > mean;
  } else {
    // Daily decisions only: the 24h breakout excludes the current completed bar.
    eligible = (i + 1) % 24 === 0 && b.close > mean && b.close > Math.max(...past.slice(-24).map(x => x.high));
    if (variant.entryCandidate === "relative_strength") eligible &&= (snapshot.relativeStrengthRank ?? Infinity) <= 3;
  }
  if (!eligible) return null;
  const stopDistance = Math.min(0.15, Math.max(0.01, 2 * atr / b.close));
  return {
    signalId: `${variant.id}:${panel.symbol}:${b.closeTime}`, strategyVersion: "research-frozen-v1", variantId: variant.id,
    alphaId: variant.alphaId, side: "LONG", signalAtMs: b.closeTime, availableAtMs: b.closeTime,
    invalidationPrice: snapshot.tryPrice * (1 - stopDistance), invalidationCurrency: "TRY",
    reasonCodes: [variant.entryCandidate, "RESEARCH_ONLY"],
    metadata: {tryPrice: snapshot.tryPrice, stopDistance, relativeStrengthRank: snapshot.relativeStrengthRank},
  };
}

/** Rejected exploratory candidates: audit runner only, excluded from promotion and regular research. */
export const OPPORTUNITY_VARIANTS: StrategyVariantConfig[] = [
  { id: "research_minute_pr04", entryCandidate: "minute_expansion", exitMode: "pr04_trail", alphaId: "MINUTE_EXPANSION", oiFundingRequired: false, researchOnly: true, label: "5m expansion + PR04 (frozen research)" },
  { id: "research_minute_risk_trail", entryCandidate: "minute_expansion", exitMode: "research_risk_trail", alphaId: "MINUTE_EXPANSION", oiFundingRequired: false, researchOnly: true, label: "5m expansion + 2R/1R trailing (frozen research)" },
];
