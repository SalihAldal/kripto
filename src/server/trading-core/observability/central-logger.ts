import { randomUUID } from "node:crypto";
import type { LogLevel } from "@prisma/client";
import { logger } from "@/lib/logger";
import { addSystemLog, listSystemLogs } from "@/src/server/repositories/log.repository";
import { tradingPerformanceMetrics } from "@/src/server/trading-core/observability/performance-metrics";
import type { TradingLogEvent } from "@/src/server/trading-core/observability/observability-types";

const memoryLogs: TradingLogEvent[] = [];
const MAX_MEMORY_LOGS = 1000;

function toPinoLevel(level: TradingLogEvent["level"]) {
  if (level === "CRITICAL") return "error";
  return level.toLowerCase() as "info" | "warn" | "error";
}

function toPrismaLevel(level: TradingLogEvent["level"]): LogLevel {
  return level as LogLevel;
}

function remember(event: TradingLogEvent) {
  memoryLogs.unshift(event);
  if (memoryLogs.length > MAX_MEMORY_LOGS) memoryLogs.length = MAX_MEMORY_LOGS;
}

export class TradingCentralLogger {
  log(input: Omit<TradingLogEvent, "id" | "timestamp">) {
    const event: TradingLogEvent = {
      ...input,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    remember(event);
    logger[toPinoLevel(event.level)](
      {
        category: event.category,
        source: event.source,
        status: event.status,
        requestId: event.requestId,
        traceId: event.traceId,
        spanId: event.spanId,
        symbol: event.symbol,
        botId: event.botId,
        orderId: event.orderId,
        positionId: event.positionId,
        signalId: event.signalId,
        latencyMs: event.latencyMs,
        errorCode: event.errorCode,
        errorDetail: event.errorDetail,
        context: event.context,
      },
      event.message,
    );
    if (typeof event.latencyMs === "number") tradingPerformanceMetrics.record(`${event.category.toLowerCase()}.latency_ms`, event.latencyMs);
    if (event.metricName && typeof event.metricValue === "number") tradingPerformanceMetrics.record(event.metricName, event.metricValue);

    void addSystemLog({
      level: toPrismaLevel(event.level),
      source: event.source,
      message: event.message,
      context: {
        ...event,
        actionType: `trading_core_${event.category.toLowerCase()}`,
      },
    }).catch(() => null);
    return event;
  }

  info(input: Omit<TradingLogEvent, "id" | "timestamp" | "level">) {
    return this.log({ ...input, level: "INFO" });
  }

  warn(input: Omit<TradingLogEvent, "id" | "timestamp" | "level">) {
    return this.log({ ...input, level: "WARN" });
  }

  error(input: Omit<TradingLogEvent, "id" | "timestamp" | "level">) {
    return this.log({ ...input, level: "ERROR" });
  }

  critical(input: Omit<TradingLogEvent, "id" | "timestamp" | "level">) {
    return this.log({ ...input, level: "CRITICAL" });
  }

  memory(input?: { level?: TradingLogEvent["level"]; category?: TradingLogEvent["category"]; limit?: number }) {
    return memoryLogs
      .filter((event) => (input?.level ? event.level === input.level : true))
      .filter((event) => (input?.category ? event.category === input.category : true))
      .slice(0, Math.max(1, Math.min(500, input?.limit ?? 200)));
  }

  async persisted(input?: { limit?: number; hasError?: boolean }) {
    return listSystemLogs({
      limit: input?.limit ?? 200,
      actionType: undefined,
      hasError: input?.hasError,
    });
  }
}

export const tradingLogger = new TradingCentralLogger();
