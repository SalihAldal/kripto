import type { WalkForwardResult } from "@/src/server/trading-core/optimization/optimization-types";

export class AdaptiveParameterTuner {
  buildPatch(result: WalkForwardResult) {
    return {
      global: {
        takeProfitPercent: result.params.takeProfitPercent,
        stopLossPercent: result.params.stopLossPercent,
        leverage: result.params.leverage,
      },
      strategy: {
        minScore: result.params.minScore,
        params: {
          rsiOversold: result.params.rsiOversold,
          rsiOverbought: result.params.rsiOverbought,
          volatilityThreshold: result.params.volatilityThreshold,
          entryFilterStrength: result.params.entryFilterStrength,
        },
      },
    };
  }
}
