import { StrategyRegistry } from "@/src/server/trading-core/strategies/strategy-registry";
import { StrategySdkAdapter } from "@/src/server/trading-core/strategy-sdk/strategy-sdk-adapter";
import type { TradingStrategySdk } from "@/src/server/trading-core/strategy-sdk/strategy-sdk.types";

export class StrategySdkPluginRegistry {
  private readonly strategies = new Map<string, TradingStrategySdk>();

  register(strategy: TradingStrategySdk) {
    if (this.strategies.has(strategy.meta.name)) {
      throw new Error(`SDK strategy already registered: ${strategy.meta.name}`);
    }
    this.strategies.set(strategy.meta.name, strategy);
    return strategy;
  }

  all() {
    return Array.from(this.strategies.values());
  }

  installInto(registry: StrategyRegistry) {
    for (const strategy of this.all()) registry.register(new StrategySdkAdapter(strategy));
  }
}

const globalRegistry = globalThis as typeof globalThis & { __tradingStrategySdkRegistry?: StrategySdkPluginRegistry };
export const tradingStrategySdkRegistry = globalRegistry.__tradingStrategySdkRegistry ?? new StrategySdkPluginRegistry();
globalRegistry.__tradingStrategySdkRegistry = tradingStrategySdkRegistry;

export function registerTradingStrategy(strategy: TradingStrategySdk) {
  return tradingStrategySdkRegistry.register(strategy);
}

export function installTradingStrategyPlugins(registry: StrategyRegistry) {
  tradingStrategySdkRegistry.installInto(registry);
}
