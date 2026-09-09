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
  if (input.snapshot.nowMs > input.nowMs) return null;
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
