import { evaluateEntrySignal, STRATEGY_VARIANTS } from "./entry-signal.service";
import type { ExternalSymbolPanel } from "@/src/server/alpha-engine-v2/external-market-data.types";
import type { EntrySignalIntent, MarketSnapshot, StrategyVariantConfig } from "./types";

export { STRATEGY_VARIANTS } from "./entry-signal.service";
export { loadTrySpotPanel, loadTrySpotUniverse, loadAssetMapping, resolveDatasetRoot } from "./try-dataset-loader.service";
export { aggregateLossAttribution } from "./entry-loss-attribution.service";

/** Shared entry decision used by replay and production adapters. */
export function evaluateUnifiedEntryDecision(input: {
  variant: StrategyVariantConfig;
  panel: ExternalSymbolPanel;
  barIdx: number;
  snapshot: MarketSnapshot;
  nowMs: number;
}): EntrySignalIntent | null {
  const bar = input.panel.bars[input.barIdx];
  const s = input.snapshot;
  if (!bar || !Number.isFinite(bar.closeTime) || !Number.isFinite(bar.close) || bar.close <= 0 || !Number.isFinite(s.nowMs) || !Number.isFinite(input.nowMs) || bar.closeTime > input.nowMs || s.nowMs > input.nowMs) return null;
  if (!Number.isFinite(s.tryPrice) || s.tryPrice <= 0 || !Number.isFinite(s.tryVolume)) return null;
  if (s.tryAvailableAtMs != null && (!Number.isFinite(s.tryAvailableAtMs) || s.tryAvailableAtMs > input.nowMs || input.nowMs - s.tryAvailableAtMs > 5 * 60_000)) return null;
  if (input.nowMs - bar.closeTime > 65 * 60_000) return null;
  if (s.externalSymbol !== input.panel.symbol || s.executionSymbol !== `${s.baseAsset}TRY` || s.externalSymbol !== `${s.baseAsset}USDT`) return null;
  return evaluateEntrySignal({
    variant: input.variant,
    panel: input.panel,
    barIdx: input.barIdx,
    snapshot: { ...input.snapshot, nowMs: input.nowMs },
  });
}

export function getVariantById(id: StrategyVariantConfig["id"]) {
  const v = STRATEGY_VARIANTS.find((row) => row.id === id);
  if (!v) throw new Error(`Unknown variant ${id}`);
  return v;
}
