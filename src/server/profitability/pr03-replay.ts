import { evaluateBreakoutRetestStrategy } from "@/src/server/profitability/pr03-breakout-evaluator";
import { resetBreakoutSetupStoreForTests } from "@/src/server/profitability/pr03-breakout-setup";
import { evaluateMomentumContinuationStrategy } from "@/src/server/profitability/pr03-momentum-evaluator";
import { resetMomentumSetupStoreForTests } from "@/src/server/profitability/pr03-momentum-setup";
import {
  PR03_POLICY_VERSION,
  PR03_SCHEMA_VERSION,
  type CausalCandle,
  type Pr03ReplayReport,
  type StrategyContextExtension,
} from "@/src/server/profitability/pr03-types";
import type { RegimeSnapshot, StrategyInput } from "@/src/server/forensics/p4-regime-strategy-shadow";

export type Pr03MarketTick = {
  tickIndex: number;
  lifecycleId: string;
  eventAtMs: number;
  strategyInput: StrategyInput;
  regime: RegimeSnapshot;
  candles: CausalCandle[];
  trades: import("@/src/server/market-data/spine/events").MarketTradeEvent[];
  strategyContext?: StrategyContextExtension;
};

export function runPr03ReplayAnalysis(input: {
  datasetId: string;
  ticks: Pr03MarketTick[];
}): Pr03ReplayReport {
  resetBreakoutSetupStoreForTests();
  resetMomentumSetupStoreForTests();
  if (!input.ticks.length) {
    return {
      schemaVersion: PR03_SCHEMA_VERSION,
      policyVersion: PR03_POLICY_VERSION,
      datasetId: input.datasetId,
      tickCount: 0,
      momentumTriggerCount: 0,
      breakoutTriggerCount: 0,
      uniqueMomentumLifecycleTriggers: 0,
      uniqueBreakoutLifecycleTriggers: 0,
      status: "NOT_RUN",
      reason: "EMPTY_DATASET",
    };
  }

  const momentumLifecycle = new Set<string>();
  const breakoutLifecycle = new Set<string>();
  let momentumTriggerCount = 0;
  let breakoutTriggerCount = 0;

  for (const tick of input.ticks) {
    const ctx: StrategyContextExtension = {
      candles: tick.candles,
      trades: tick.trades,
      lifecycleId: tick.lifecycleId,
      nowMs: tick.eventAtMs,
      ...tick.strategyContext,
    };
    const momentum = evaluateMomentumContinuationStrategy(tick.strategyInput, tick.regime, ctx);
    const breakout = evaluateBreakoutRetestStrategy(tick.strategyInput, tick.regime, ctx);
    if (momentum.trigger.triggered) {
      momentumTriggerCount += 1;
      momentumLifecycle.add(tick.lifecycleId);
    }
    if (breakout.trigger.triggered) {
      breakoutTriggerCount += 1;
      breakoutLifecycle.add(tick.lifecycleId);
    }
  }

  return {
    schemaVersion: PR03_SCHEMA_VERSION,
    policyVersion: PR03_POLICY_VERSION,
    datasetId: input.datasetId,
    tickCount: input.ticks.length,
    momentumTriggerCount,
    breakoutTriggerCount,
    uniqueMomentumLifecycleTriggers: momentumLifecycle.size,
    uniqueBreakoutLifecycleTriggers: breakoutLifecycle.size,
    status: "COMPLETED",
    reason: null,
  };
}

export function evaluatePr03WithRouter(input: {
  strategyInput: StrategyInput;
  regime: RegimeSnapshot;
  strategyContext?: StrategyContextExtension;
}) {
  const momentum = evaluateMomentumContinuationStrategy(input.strategyInput, input.regime, input.strategyContext);
  const breakout = evaluateBreakoutRetestStrategy(input.strategyInput, input.regime, input.strategyContext);
  return { momentum, breakout };
}
