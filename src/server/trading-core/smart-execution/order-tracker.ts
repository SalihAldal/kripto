import type { ModuleHealth, TradingModule } from "@/src/server/trading-core/core/types";
import { OrderStateStore } from "@/src/server/trading-core/smart-execution/order-state-store";

export class WebSocketOrderTracker implements TradingModule {
  readonly name = "websocket-order-tracker";
  readonly enabled = true;
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastStuckCount = 0;

  constructor(
    private readonly store: OrderStateStore,
    private readonly stuckTimeoutMs = 30_000,
  ) {}

  async start() {
    this.interval = setInterval(() => {
      this.lastStuckCount = this.store.markStuck(this.stuckTimeoutMs).length;
    }, 5_000);
  }

  async stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async health(): Promise<ModuleHealth> {
    return {
      name: this.name,
      enabled: this.enabled,
      status: "healthy",
      details: {
        trackedOrders: this.store.snapshot().length,
        lastStuckCount: this.lastStuckCount,
      },
      checkedAt: new Date().toISOString(),
    };
  }
}
