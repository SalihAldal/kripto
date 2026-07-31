import type { MarketSnapshot, StrategySignal } from "@/src/server/trading-core/core/types";

export interface SignalStrategy {
  readonly name: string;
  readonly enabled: boolean;
  evaluate(snapshot: MarketSnapshot): Promise<StrategySignal>;
}
