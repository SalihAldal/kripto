import { addSystemLog } from "@/src/server/repositories/log.repository";
import { logger } from "@/lib/logger";

export type ActionType =
  | "analysis_started"
  | "shortlist_created"
  | "coin_selected"
  | "buy_order_placed"
  | "buy_completed"
  | "sell_order_created"
  | "sell_completed"
  | "stop_loss_triggered"
  | "round_completed"
  | "api_error"
  | "retry_triggered"
  | "manual_cancel"
  | "recovery_after_restart"
  | "settings_updated"
  | "manual_trade_triggered"
  | "manual_trade_close"
  | "manual_round_start"
  | "manual_round_stop";

export type StructuredLogStatus = "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";

export type StructuredLogInput = {
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  source: string;
  message: string;
  actionType: ActionType;
  status: StructuredLogStatus;
  requestId?: string;
  userId?: string;
  sessionId?: string;
  orderId?: string;
  transactionId?: string;
  symbol?: string;
  errorCode?: string;
  errorDetail?: string;
  context?: Record<string, unknown>;
};

function sanitizeError(value?: string) {
  if (!value) return undefined;
  return value.slice(0, 1200);
}

export async function writeStructuredLog(input: StructuredLogInput) {
  const payload = {
    requestId: input.requestId ?? null,
    userId: input.userId ?? null,
    sessionId: input.sessionId ?? null,
    orderId: input.orderId ?? null,
    transactionId: input.transactionId ?? null,
    symbol: input.symbol ?? null,
    actionType: input.actionType,
    timestamp: new Date().toISOString(),
    status: input.status,
    errorCode: input.errorCode ?? null,
    errorDetail: sanitizeError(input.errorDetail) ?? null,
    ...(input.context ?? {}),
  };

  logger[input.level.toLowerCase() as "debug" | "info" | "warn" | "error"](
    {
      source: input.source,
      ...payload,
    },
    input.message,
  );

  await addSystemLog({
    level: input.level,
    source: input.source,
    message: input.message,
    context: payload,
  }).catch(() => null);
}
