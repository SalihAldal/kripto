import { tenantConfigEngine } from "@/src/server/trading-core/tenant";
import type { CopyTradeFollower, CopyTradeIntent, MasterTradeSignal } from "@/src/server/trading-core/copy-trading/copy-trading-types";

export class CopySizingEngine {
  buildIntent(follower: CopyTradeFollower, signal: MasterTradeSignal): CopyTradeIntent {
    const config = tenantConfigEngine.getEffectiveConfig(follower.userId);
    const baseQuantity = signal.filledQuantity && signal.filledQuantity > 0 ? signal.filledQuantity : signal.quantity;
    const riskLevelMultiplier = config.riskLevel === "LOW" ? 0.5 : config.riskLevel === "HIGH" ? 1.25 : 1;
    const quantity = baseQuantity * (follower.allocationPercent / 100) * follower.riskMultiplier * riskLevelMultiplier;
    const leverage = Math.max(1, Math.min(follower.maxLeverage, signal.leverage ?? config.leverage));
    return {
      followerId: follower.followerId,
      userId: follower.userId,
      masterSignalId: signal.signalId,
      symbol: signal.symbol.toUpperCase(),
      side: signal.side,
      type: signal.type,
      quantity: Number(Math.max(0, quantity).toFixed(8)),
      price: signal.price,
      leverage,
      maxSlippageBps: follower.maxSlippageBps,
      reduceOnly: signal.reduceOnly,
      reason: `Copied ${follower.allocationPercent}% with ${follower.riskMultiplier}x follower risk and ${riskLevelMultiplier}x user risk scaling`,
    };
  }
}
