import type { ExchangeWeightSnapshot } from "@/src/server/trading-core/exchange-protection/exchange-protection.types";

const WINDOW_MS = 60_000;

type WeightEvent = {
  weight: number;
  orderCount: number;
  at: number;
};

export class ApiWeightTracker {
  private readonly events: WeightEvent[] = [];
  private blockedUntil = 0;
  private adaptiveDelayMs = 0;

  constructor(
    private readonly maxWeight1m = Number(process.env.TRADING_EXCHANGE_MAX_WEIGHT_1M ?? 1200),
    private readonly maxOrderCount1m = Number(process.env.TRADING_EXCHANGE_MAX_ORDERS_1M ?? 100),
  ) {}

  canConsume(weight: number, orderCount = 0) {
    this.cleanup();
    if (this.blockedUntil > Date.now()) return false;
    const current = this.current();
    return current.usedWeight1m + weight <= this.maxWeight1m && current.usedOrderCount1m + orderCount <= this.maxOrderCount1m;
  }

  record(weight: number, orderCount = 0) {
    this.events.push({ weight, orderCount, at: Date.now() });
    this.recalculateAdaptiveDelay();
  }

  block(ms: number) {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + ms);
    this.adaptiveDelayMs = Math.max(this.adaptiveDelayMs, Math.min(ms, 10_000));
  }

  delayFor(weight: number) {
    this.cleanup();
    if (this.blockedUntil > Date.now()) return this.blockedUntil - Date.now();
    if (this.canConsume(weight)) return this.adaptiveDelayMs;
    return Math.max(250, this.adaptiveDelayMs + 1000);
  }

  snapshot(): ExchangeWeightSnapshot {
    const current = this.current();
    return {
      ...current,
      maxWeight1m: this.maxWeight1m,
      maxOrderCount1m: this.maxOrderCount1m,
      adaptiveDelayMs: this.adaptiveDelayMs,
      blockedUntil: this.blockedUntil > Date.now() ? new Date(this.blockedUntil).toISOString() : null,
      updatedAt: new Date().toISOString(),
    };
  }

  private current() {
    this.cleanup();
    return this.events.reduce(
      (acc, event) => ({
        usedWeight1m: acc.usedWeight1m + event.weight,
        usedOrderCount1m: acc.usedOrderCount1m + event.orderCount,
      }),
      { usedWeight1m: 0, usedOrderCount1m: 0 },
    );
  }

  private cleanup() {
    const min = Date.now() - WINDOW_MS;
    while (this.events[0] && this.events[0].at < min) this.events.shift();
  }

  private recalculateAdaptiveDelay() {
    const current = this.current();
    const weightUsage = current.usedWeight1m / Math.max(1, this.maxWeight1m);
    const orderUsage = current.usedOrderCount1m / Math.max(1, this.maxOrderCount1m);
    const usage = Math.max(weightUsage, orderUsage);
    this.adaptiveDelayMs = usage > 0.9 ? 1500 : usage > 0.75 ? 750 : usage > 0.55 ? 250 : 0;
  }
}
