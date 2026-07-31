import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import type { TradingLogLevel } from "@/src/server/trading-core/observability/observability-types";

export const tradingDomainLogger = {
  signalCreated(input: { symbol: string; side: string; score: number; confidence: number; signalId?: string; context?: Record<string, unknown> }) {
    return tradingLogger.info({
      category: "SIGNAL",
      source: "trading-core.signal-engine",
      message: `Signal created for ${input.symbol}: ${input.side}`,
      status: "SUCCESS",
      symbol: input.symbol,
      signalId: input.signalId,
      metricName: "signal.confidence",
      metricValue: input.confidence,
      context: { side: input.side, score: input.score, confidence: input.confidence, ...input.context },
    });
  },

  tradeExecution(input: { symbol: string; side: string; status: string; orderId?: string; latencyMs?: number; context?: Record<string, unknown> }) {
    return tradingLogger.info({
      category: "TRADE_EXECUTION",
      source: "trading-core.execution",
      message: `Trade execution ${input.status}: ${input.symbol} ${input.side}`,
      status: input.status === "REJECTED" || input.status === "FAILED" ? "FAILED" : "SUCCESS",
      symbol: input.symbol,
      orderId: input.orderId,
      latencyMs: input.latencyMs,
      context: { side: input.side, executionStatus: input.status, ...input.context },
    });
  },

  websocketDisconnect(input: { source: string; symbols?: string[]; reason?: string }) {
    return tradingLogger.warn({
      category: "WEBSOCKET",
      source: input.source,
      message: "WebSocket disconnected",
      status: "FAILED",
      errorCode: "WEBSOCKET_DISCONNECT",
      errorDetail: input.reason,
      context: { symbols: input.symbols },
    });
  },

  apiError(input: { source: string; path: string; method: string; error: string; requestId?: string; status?: number }) {
    return tradingLogger.error({
      category: "API",
      source: input.source,
      message: `API error on ${input.method} ${input.path}`,
      status: "FAILED",
      requestId: input.requestId,
      errorCode: `HTTP_${input.status ?? 500}`,
      errorDetail: input.error,
      context: { path: input.path, method: input.method },
    });
  },

  riskReject(input: { symbol: string; level: string; score?: number; reasons: string[] }) {
    return tradingLogger.warn({
      category: "RISK",
      source: "trading-core.risk-engine",
      message: `Risk rejected ${input.symbol}: ${input.level}`,
      status: "SKIPPED",
      symbol: input.symbol,
      metricName: "risk.score",
      metricValue: input.score ?? 0,
      context: { level: input.level, score: input.score, reasons: input.reasons },
    });
  },

  pnlChange(input: { symbol: string; positionId?: string; pnl: number; pnlPercent?: number; level?: TradingLogLevel }) {
    return tradingLogger.log({
      level: input.level ?? "INFO",
      category: "PNL",
      source: "trading-core.position-manager",
      message: `PnL changed for ${input.symbol}: ${input.pnl}`,
      status: "RUNNING",
      symbol: input.symbol,
      positionId: input.positionId,
      metricName: "pnl.change",
      metricValue: input.pnl,
      context: { pnl: input.pnl, pnlPercent: input.pnlPercent },
    });
  },

  botActivation(input: { botId: string; status: string; score?: number; reason?: string }) {
    return tradingLogger.info({
      category: "BOT",
      source: "trading-core.bot-orchestrator",
      message: `Bot ${input.botId} status: ${input.status}`,
      status: "SUCCESS",
      botId: input.botId,
      metricName: "bot.score",
      metricValue: input.score ?? 0,
      context: { status: input.status, reason: input.reason },
    });
  },

  aiPrediction(input: { symbol: string; provider: string; confidence: number; decision: string; latencyMs?: number; context?: Record<string, unknown> }) {
    return tradingLogger.info({
      category: "AI",
      source: "trading-core.ai",
      message: `AI prediction ${input.provider}: ${input.symbol} ${input.decision}`,
      status: "SUCCESS",
      symbol: input.symbol,
      latencyMs: input.latencyMs,
      metricName: "ai.confidence",
      metricValue: input.confidence,
      context: { provider: input.provider, decision: input.decision, confidence: input.confidence, ...input.context },
    });
  },
};
