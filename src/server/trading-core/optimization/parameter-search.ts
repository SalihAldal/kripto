import { randomUUID } from "node:crypto";
import type { StrategyOptimizationCandidate, StrategyOptimizationParams } from "@/src/server/trading-core/optimization/optimization-types";

const defaultGrid: StrategyOptimizationParams[] = [
  { rsiOversold: 28, rsiOverbought: 72, takeProfitPercent: 0.8, stopLossPercent: 0.6, leverage: 1, minScore: 58, volatilityThreshold: 1.5, entryFilterStrength: 0.4 },
  { rsiOversold: 30, rsiOverbought: 70, takeProfitPercent: 1.0, stopLossPercent: 0.7, leverage: 2, minScore: 62, volatilityThreshold: 2.0, entryFilterStrength: 0.55 },
  { rsiOversold: 32, rsiOverbought: 68, takeProfitPercent: 1.2, stopLossPercent: 0.8, leverage: 3, minScore: 66, volatilityThreshold: 2.5, entryFilterStrength: 0.65 },
  { rsiOversold: 34, rsiOverbought: 66, takeProfitPercent: 1.6, stopLossPercent: 1.0, leverage: 2, minScore: 70, volatilityThreshold: 3.0, entryFilterStrength: 0.75 },
  { rsiOversold: 35, rsiOverbought: 65, takeProfitPercent: 2.0, stopLossPercent: 1.2, leverage: 1, minScore: 74, volatilityThreshold: 3.5, entryFilterStrength: 0.85 },
];

export class StrategyParameterSearch {
  buildCandidates(strategy: string, maxCandidates = 12): StrategyOptimizationCandidate[] {
    const expanded = defaultGrid.flatMap((params) => [
      params,
      {
        ...params,
        takeProfitPercent: Number((params.takeProfitPercent * 1.15).toFixed(3)),
        stopLossPercent: Number((params.stopLossPercent * 0.9).toFixed(3)),
      },
      {
        ...params,
        leverage: Math.min(10, params.leverage + 1),
        minScore: Math.min(85, params.minScore + 4),
      },
    ]);
    return expanded.slice(0, Math.max(1, maxCandidates)).map((params) => ({
      id: randomUUID(),
      strategy,
      params,
    }));
  }
}
