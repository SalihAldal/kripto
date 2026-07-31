import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { tradingPerformanceMetrics } from "@/src/server/trading-core/observability/performance-metrics";

export async function getTradingObservabilitySnapshot() {
  const memory = tradingLogger.memory({ limit: 250 });
  const metrics = tradingPerformanceMetrics.snapshot();
  const critical = memory.filter((event) => event.level === "CRITICAL");
  const errors = memory.filter((event) => event.level === "ERROR" || event.level === "CRITICAL");
  const warnings = memory.filter((event) => event.level === "WARN");
  const byCategory = memory.reduce<Record<string, number>>((acc, event) => {
    acc[event.category] = (acc[event.category] ?? 0) + 1;
    return acc;
  }, {});

  return {
    status: critical.length > 0 ? "CRITICAL" : errors.length > 0 ? "DEGRADED" : "HEALTHY",
    totals: {
      logsInMemory: memory.length,
      warnings: warnings.length,
      errors: errors.length,
      critical: critical.length,
      metrics: metrics.length,
    },
    byCategory,
    recentErrors: errors.slice(0, 20),
    metrics,
    updatedAt: new Date().toISOString(),
  };
}
