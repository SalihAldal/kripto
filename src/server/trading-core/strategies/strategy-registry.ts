import { tradingFeatureFlags } from "@/src/server/trading-core/core/feature-flags";
import { tradingConfig } from "@/src/server/trading-core/config";
import type { SignalStrategy } from "@/src/server/trading-core/strategies/strategy";

export class StrategyRegistry {
  private readonly strategies = new Map<string, SignalStrategy>();

  register(strategy: SignalStrategy) {
    if (this.strategies.has(strategy.name)) {
      throw new Error(`Strategy already registered: ${strategy.name}`);
    }
    this.strategies.set(strategy.name, strategy);
  }

  enabled() {
    return Array.from(this.strategies.values()).filter((strategy) => {
      const runtime = tradingConfig.getStrategy(strategy.name);
      return strategy.enabled && runtime.enabled && tradingFeatureFlags.isStrategyEnabled(strategy.name, true);
    });
  }

  all() {
    return Array.from(this.strategies.values());
  }
}
