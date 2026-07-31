import type { WalkForwardResult } from "@/src/server/trading-core/optimization/optimization-types";

export class OverfittingGuard {
  isSafe(result: WalkForwardResult) {
    if (result.testMetrics.tradeCount < 3) return { safe: false, reason: "Not enough out-of-sample trades" };
    if (result.overfittingScore > 45) return { safe: false, reason: "Train/test performance gap too high" };
    if (result.stabilityScore < 45) return { safe: false, reason: "Walk-forward stability too low" };
    if (result.testMetrics.maxDrawdown > 18) return { safe: false, reason: "Out-of-sample drawdown too high" };
    if (result.testMetrics.profitFactor > 0 && result.testMetrics.profitFactor < 1) return { safe: false, reason: "Out-of-sample profit factor below 1" };
    return { safe: true, reason: "Optimization passed overfitting guard" };
  }
}
