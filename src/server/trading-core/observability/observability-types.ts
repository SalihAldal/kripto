export type TradingLogLevel = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export type TradingLogCategory =
  | "SIGNAL"
  | "TRADE_EXECUTION"
  | "WEBSOCKET"
  | "API"
  | "RISK"
  | "PNL"
  | "BOT"
  | "AI"
  | "SYSTEM";

export type TradingLogStatus = "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";

export type TradingLogEvent = {
  id: string;
  level: TradingLogLevel;
  category: TradingLogCategory;
  source: string;
  message: string;
  status: TradingLogStatus;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  botId?: string;
  symbol?: string;
  orderId?: string;
  positionId?: string;
  signalId?: string;
  errorCode?: string;
  errorDetail?: string;
  latencyMs?: number;
  metricName?: string;
  metricValue?: number;
  context?: Record<string, unknown>;
  timestamp: string;
};

export type PerformanceMetric = {
  name: string;
  count: number;
  lastValue: number;
  min: number;
  max: number;
  avg: number;
  updatedAt: string;
};

export type TraceContext = {
  requestId: string;
  traceId: string;
  spanId: string;
  startedAt: number;
};
