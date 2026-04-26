import { EventEmitter } from "node:events";
import { logger } from "@/lib/logger";
import type { ExecutionStatusEvent } from "@/src/server/execution/types";
import { addTradeLifecycleEvent, listTradeLifecycleEvents } from "@/src/server/repositories/trade-lifecycle.repository";
import type { ActionType, StructuredLogStatus } from "@/src/server/observability/structured-log";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import { persistLastEvent } from "@/src/server/recovery/failsafe-recovery.service";

const emitter = new EventEmitter();
const EVENT_NAME = "execution-status";
const history: ExecutionStatusEvent[] = [];

function resolveActionType(event: ExecutionStatusEvent): ActionType | null {
  const stage = event.stage.toLowerCase();
  const message = event.message.toLowerCase();
  const context = event.context ?? {};
  if (stage === "start") return "analysis_started";
  if (stage === "scanner") return "shortlist_created";
  if (stage === "selection") return "coin_selected";
  if (stage === "buy-order" || stage === "order-submit") {
    if (message.includes("alim") || message.includes("buy")) return "buy_order_placed";
  }
  if (stage === "buy-order" && event.status === "SUCCESS") return "buy_completed";
  if (stage === "sell-target" || message.includes("satis")) return "sell_order_created";
  if (stage === "settlement" && event.status === "SUCCESS") return "sell_completed";
  if (String((context as Record<string, unknown>).closeReason ?? "") === "STOP_LOSS") return "stop_loss_triggered";
  if (stage === "round-engine" && message.includes("tamamlandi")) return "round_completed";
  if (stage === "failed") return "api_error";
  if (stage === "cancel") return "manual_cancel";
  if (stage === "position-monitor" && String((context as Record<string, unknown>).source ?? "") === "RECOVERY") {
    return "recovery_after_restart";
  }
  if (message.includes("retry") || message.includes("tekrar")) return "retry_triggered";
  return null;
}

function resolveStructuredStatus(status: ExecutionStatusEvent["status"]): StructuredLogStatus {
  if (status === "SUCCESS") return "SUCCESS";
  if (status === "FAILED") return "FAILED";
  if (status === "SKIPPED") return "SKIPPED";
  return "RUNNING";
}

export function publishExecutionEvent(event: Omit<ExecutionStatusEvent, "createdAt">) {
  const payload: ExecutionStatusEvent = {
    ...event,
    createdAt: new Date().toISOString(),
  };
  history.unshift(payload);
  if (history.length > 500) history.pop();
  emitter.emit(EVENT_NAME, payload);
  // SELL-FLOW FIX: Eventleri kalici saklayip sayfa yenilense de gecmis timeline'i koru.
  void addTradeLifecycleEvent(payload).catch((error) => {
    logger.warn(
      { error: (error as Error).message, stage: payload.stage, executionId: payload.executionId },
      "Trade lifecycle event persistence skipped",
    );
  });
  const actionType = resolveActionType(payload);
  const shouldPersist =
    payload.status === "FAILED" ||
    payload.level === "ERROR" ||
    payload.level === "WARN" ||
    actionType !== null;
  if (shouldPersist) {
    void writeStructuredLog({
      level:
        payload.level === "ERROR"
          ? "ERROR"
          : payload.level === "WARN"
            ? "WARN"
            : payload.level === "INFO" || payload.level === "TRADE" || payload.level === "SIGNAL"
              ? "INFO"
              : "DEBUG",
      source: "execution-event",
      message: payload.message,
      actionType: actionType ?? "api_error",
      status: resolveStructuredStatus(payload.status),
      transactionId: payload.executionId,
      orderId: typeof payload.context?.orderId === "string" ? payload.context.orderId : undefined,
      symbol: payload.symbol,
      errorCode: payload.status === "FAILED" ? "EXECUTION_EVENT_FAILED" : undefined,
      errorDetail: payload.status === "FAILED" ? payload.message : undefined,
      context: {
        stage: payload.stage,
        level: payload.level,
        ...payload.context,
      },
    });
  }
  void persistLastEvent({
    executionId: payload.executionId,
    symbol: payload.symbol,
    stage: payload.stage,
    status: payload.status,
    message: payload.message,
  }).catch(() => null);
  return payload;
}

export function listExecutionEvents(limit = 200) {
  return history.slice(0, limit);
}

export async function listPersistedExecutionEvents(input?: {
  limit?: number;
  executionId?: string;
  symbol?: string;
  orderId?: string;
}) {
  return listTradeLifecycleEvents(input);
}

export function subscribeExecutionEvents(listener: (event: ExecutionStatusEvent) => void) {
  emitter.on(EVENT_NAME, listener);
  return () => {
    emitter.off(EVENT_NAME, listener);
  };
}
