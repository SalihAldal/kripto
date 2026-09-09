import { buildOiFeatures } from "@/src/server/alpha-engine-v2/oi-features.service";
import type { OiImpulseAlphaId } from "@/src/server/alpha-engine-v2/oi-impulse-alpha-v2.service";
import type { ExternalSymbolPanel } from "@/src/server/alpha-engine-v2/external-market-data.types";
import type { EntryCandidateId, EntrySignalIntent, MarketSnapshot, StrategyVariantConfig } from "./types";

function nearestFunding(panel: ExternalSymbolPanel, time: number) {
  let best = panel.funding[0];
  for (const row of panel.funding) if (row.fundingTime <= time) best = row;
  return best;
}

function evaluateOiCore(panel: ExternalSymbolPanel, idx: number, alphaId: OiImpulseAlphaId) {
  const feat = buildOiFeatures(panel, idx);
  if (!feat) return null;
  const fund = nearestFunding(panel, panel.bars[idx].closeTime)?.fundingRate ?? 0;
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

  const invalidation = bar.low * 0.985;
  return {
    signalId: `${input.variant.id}:${input.panel.symbol}:${bar.closeTime}`,
    strategyVersion: input.variant.id,
    variantId: input.variant.id,
    alphaId: input.variant.alphaId,
    side: "LONG",
    signalAtMs: bar.closeTime,
    availableAtMs: bar.closeTime,
    invalidationPrice: invalidation,
    reasonCodes: [input.variant.entryCandidate, core.feat.oiDeltaPct > 1.5 ? "OI_IMPULSE" : "OI_V2"],
    metadata: {
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
