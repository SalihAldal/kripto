import { randomUUID } from "node:crypto";
import type { ModuleHealth, TradingModule } from "@/src/server/trading-core/core/types";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { retry } from "@/src/server/trading-core/utils/retry";
import { BinanceFuturesAdapter } from "@/src/server/trading-core/smart-execution/binance-futures-adapter";
import { protectedExchangeClient } from "@/src/server/trading-core/exchange-protection";
import { tradingFailsafeGuard } from "@/src/server/trading-core/protection/failsafe-guard";
import type { SmartOrderExecution, SmartOrderPlan, SmartOrderRequest } from "@/src/server/trading-core/smart-execution/execution-types";
import { LatencyMonitor } from "@/src/server/trading-core/smart-execution/latency-monitor";
import { OrderStateStore } from "@/src/server/trading-core/smart-execution/order-state-store";
import { SlippageProtection } from "@/src/server/trading-core/smart-execution/slippage-protection";
import { SmartOrderRouter } from "@/src/server/trading-core/smart-execution/smart-order-router";
import { SplitOrderPlanner } from "@/src/server/trading-core/smart-execution/split-order-planner";
import { WebSocketOrderTracker } from "@/src/server/trading-core/smart-execution/order-tracker";

export class SmartExecutionService implements TradingModule {
  readonly name = "smart-execution-service";
  readonly enabled = true;
  private readonly latency = new LatencyMonitor();
  private readonly router = new SmartOrderRouter(this.latency);
  private readonly planner = new SplitOrderPlanner();
  private readonly slippage = new SlippageProtection();
  private readonly store = new OrderStateStore();
  private readonly adapter = new BinanceFuturesAdapter();
  private readonly queue = new TradingJobQueue("smart-execution", 2, false);
  private readonly tracker = new WebSocketOrderTracker(this.store);
  private lastExecution: SmartOrderExecution | null = null;

  constructor() {
    this.queue.register<SmartOrderPlan>("smart-order.submit", async (job) => {
      this.lastExecution = await this.submitPlan(job.payload);
    });
  }

  async start() {
    await this.queue.start();
    await this.tracker.start?.();
  }

  async stop() {
    this.queue.stop();
    await this.tracker.stop?.();
  }

  async plan(request: SmartOrderRequest, referencePrice = request.price ?? 1) {
    const idempotencyKey = request.clientOrderId ?? `${request.symbol}:${request.side}:${request.quantity}:${request.price ?? "MKT"}`;
    const failsafe = tradingFailsafeGuard.evaluateOrder({
      symbol: request.symbol,
      side: request.side,
      idempotencyKey,
      reduceOnly: request.reduceOnly,
      currentPrice: referencePrice,
    });
    if (!failsafe.allowed) throw new Error(failsafe.reasons.join("; "));
    if (this.store.hasDuplicate(idempotencyKey)) {
      throw new Error("Duplicate order prevention blocked request");
    }
    const slip = this.slippage.validate(request, referencePrice);
    if (!slip.ok) throw new Error(slip.reason);
    const venue = this.router.selectVenue(request);
    const plan = this.planner.plan({ ...request, clientOrderId: idempotencyKey }, venue);
    this.store.remember(idempotencyKey);
    return plan;
  }

  async enqueue(request: SmartOrderRequest, referencePrice?: number) {
    const plan = await this.plan(request, referencePrice);
    this.store.create(plan.planId, plan.slices);
    await this.queue.push("smart-order.submit", plan);
    return plan;
  }

  async submitPlan(plan: SmartOrderPlan): Promise<SmartOrderExecution> {
    const execution = this.store.create(plan.planId, plan.slices);
    for (const slice of plan.slices) {
      const startedAt = Date.now();
      try {
        await retry(
          async () => {
            const clientOrderId = `${plan.request.clientOrderId ?? randomUUID()}-${slice.sliceId.slice(0, 8)}`;
            await this.adapter.submit(slice, clientOrderId);
            this.store.updateSlice(plan.planId, slice.sliceId, "FILLED");
          },
          { retries: 2, minDelayMs: 250, maxDelayMs: 1500, jitter: true },
        );
      } catch {
        const failoverVenue = this.router.failover(plan.selectedVenue);
        const nextSlice = { ...slice, venue: failoverVenue.name };
        try {
          await this.adapter.submit(nextSlice, `${plan.request.clientOrderId ?? randomUUID()}-fo-${slice.sliceId.slice(0, 6)}`);
          this.store.updateSlice(plan.planId, slice.sliceId, "FILLED");
        } catch {
          this.store.updateSlice(plan.planId, slice.sliceId, "FAILED");
        }
      } finally {
        this.latency.record(plan.selectedVenue.name, Date.now() - startedAt);
      }
    }
    return this.store.snapshot().find((item) => item.planId === execution.planId) ?? execution;
  }

  async emergencyCancel(symbol?: string) {
    if (symbol) await this.adapter.cancelAll(symbol.toUpperCase()).catch(() => null);
    return this.store.cancelAll(symbol ? `Emergency cancel for ${symbol}` : "Emergency cancel all");
  }

  async health(): Promise<ModuleHealth> {
    return {
      name: this.name,
      enabled: this.enabled,
      status: "healthy",
      details: {
        lastExecution: this.lastExecution,
        queue: this.queue.stats(),
        exchangeProtection: protectedExchangeClient.snapshot(),
        latency: this.latency.snapshot(),
        orders: this.store.snapshot().slice(-20),
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
