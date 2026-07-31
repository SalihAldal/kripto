import type { PerformanceMetric } from "@/src/server/trading-core/observability/observability-types";

export class PerformanceMetricsCollector {
  private readonly metrics = new Map<string, PerformanceMetric>();

  record(name: string, value: number) {
    const now = new Date().toISOString();
    const current = this.metrics.get(name);
    if (!current) {
      const metric = { name, count: 1, lastValue: value, min: value, max: value, avg: value, updatedAt: now };
      this.metrics.set(name, metric);
      return metric;
    }
    const count = current.count + 1;
    const avg = current.avg + (value - current.avg) / count;
    const next = {
      name,
      count,
      lastValue: value,
      min: Math.min(current.min, value),
      max: Math.max(current.max, value),
      avg: Number(avg.toFixed(4)),
      updatedAt: now,
    };
    this.metrics.set(name, next);
    return next;
  }

  snapshot() {
    return Array.from(this.metrics.values()).sort((a, b) => a.name.localeCompare(b.name));
  }
}

export const tradingPerformanceMetrics = new PerformanceMetricsCollector();
