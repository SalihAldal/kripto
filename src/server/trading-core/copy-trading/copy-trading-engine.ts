import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { CopyRiskPolicy } from "@/src/server/trading-core/copy-trading/copy-risk-policy";
import { CopySizingEngine } from "@/src/server/trading-core/copy-trading/copy-sizing";
import { copyTradingRegistry } from "@/src/server/trading-core/copy-trading/copy-trading-registry";
import type { CopyTradeResult, MasterTradeSignal } from "@/src/server/trading-core/copy-trading/copy-trading-types";
import { getSmartExecutionService } from "@/src/server/trading-core/smart-execution/singleton";
import type { SmartOrderRequest } from "@/src/server/trading-core/smart-execution/execution-types";

export class CopyTradingEngine {
  private readonly risk = new CopyRiskPolicy();
  private readonly sizing = new CopySizingEngine();
  private readonly results: CopyTradeResult[] = [];

  async copy(signal: MasterTradeSignal): Promise<CopyTradeResult[]> {
    const master = copyTradingRegistry.master(signal.masterId);
    if (!master || master.status !== "ACTIVE") {
      return [this.skipped(signal, "master", "Master trader is not active")];
    }
    const followers = copyTradingRegistry.followersFor(signal.masterId);
    const results = await Promise.all(followers.map((follower) => this.copyForFollower(follower.followerId, signal)));
    this.results.unshift(...results);
    if (this.results.length > 500) this.results.length = 500;
    return results;
  }

  async copyForFollower(followerId: string, signal: MasterTradeSignal): Promise<CopyTradeResult> {
    const follower = copyTradingRegistry.snapshot().followers.find((row) => row.followerId === followerId);
    if (!follower || follower.status !== "ACTIVE") return this.skipped(signal, followerId, "Follower is not active");
    const risk = this.risk.validate(follower, signal);
    if (!risk.allowed) return this.skipped(signal, followerId, risk.reason, risk.latencyMs, follower.userId);
    const intent = this.sizing.buildIntent(follower, signal);
    if (intent.quantity <= 0) return this.skipped(signal, followerId, "Calculated copy quantity is zero", risk.latencyMs, follower.userId);

    const request: SmartOrderRequest = {
      symbol: intent.symbol,
      side: intent.side,
      type: intent.type,
      quantity: intent.quantity,
      price: intent.price,
      maxSlippageBps: intent.maxSlippageBps,
      leverage: intent.leverage,
      reduceOnly: intent.reduceOnly,
      clientOrderId: `copy-${signal.signalId}-${follower.followerId}`.slice(0, 36),
      metadata: {
        copyTrade: true,
        masterId: signal.masterId,
        followerId: follower.followerId,
        userId: follower.userId,
        accountId: follower.accountId,
      },
    };
    const service = getSmartExecutionService();
    await service.start();
    const plan = await service.enqueue(request, intent.price);
    const result: CopyTradeResult = {
      followerId: follower.followerId,
      userId: follower.userId,
      copied: true,
      intent,
      plan,
      latencyMs: risk.latencyMs,
      createdAt: new Date().toISOString(),
    };
    tradingLogger.info({
      category: "TRADE_EXECUTION",
      source: "trading-core.copy-trading",
      message: "Copy trade order queued",
      status: "SUCCESS",
      userId: follower.userId,
      symbol: intent.symbol,
      context: { masterId: signal.masterId, followerId: follower.followerId, quantity: intent.quantity, leverage: intent.leverage },
    });
    return result;
  }

  snapshot() {
    return {
      registry: copyTradingRegistry.snapshot(),
      recentResults: this.results.slice(0, 100),
      updatedAt: new Date().toISOString(),
    };
  }

  private skipped(signal: MasterTradeSignal, followerId: string, reason: string, latencyMs = 0, userId = ""): CopyTradeResult {
    return {
      followerId,
      userId,
      copied: false,
      skippedReason: reason,
      latencyMs,
      createdAt: new Date().toISOString(),
    };
  }
}

const globalEngine = globalThis as typeof globalThis & { __copyTradingEngine?: CopyTradingEngine };
export const copyTradingEngine = globalEngine.__copyTradingEngine ?? new CopyTradingEngine();
globalEngine.__copyTradingEngine = copyTradingEngine;
