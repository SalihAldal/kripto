export { RsiMacdStrategy } from "@/src/server/trading-core/strategies/rsi-macd.strategy";
export { VolumeSpikeStrategy } from "@/src/server/trading-core/strategies/volume-spike.strategy";
export { StrategyRegistry } from "@/src/server/trading-core/strategies/strategy-registry";
export type { SignalStrategy } from "@/src/server/trading-core/strategies/strategy";
import { tradingFeatureFlags } from "@/src/server/trading-core/core/feature-flags";

export function isStrategyEnabled(name: string, defaultValue = true) {
  return tradingFeatureFlags.isStrategyEnabled(name, defaultValue);
}
