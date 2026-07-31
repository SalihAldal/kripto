import type { CopyTradeFollower, MasterTradeSignal } from "@/src/server/trading-core/copy-trading/copy-trading-types";

export class CopyRiskPolicy {
  validate(follower: CopyTradeFollower, signal: MasterTradeSignal) {
    const sourceTime = Date.parse(signal.sourceCreatedAt);
    const latencyMs = Date.now() - (Number.isFinite(sourceTime) ? sourceTime : Date.now());
    const filledPercent = signal.filledQuantity === undefined ? 100 : (signal.filledQuantity / Math.max(signal.quantity, 1e-8)) * 100;
    if (latencyMs > follower.maxDelayMs) {
      return { allowed: false, latencyMs, reason: `Delay protection blocked copy: ${latencyMs}ms > ${follower.maxDelayMs}ms` };
    }
    if (filledPercent < follower.partialCopyMinPercent) {
      return { allowed: false, latencyMs, reason: `Partial copy below threshold: ${filledPercent.toFixed(2)}%` };
    }
    if (signal.reduceOnly && !follower.copyReduceOnly) {
      return { allowed: false, latencyMs, reason: "Reduce-only copy disabled for follower" };
    }
    return { allowed: true, latencyMs, reason: "Copy risk checks passed" };
  }
}
