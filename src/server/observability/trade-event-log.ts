import { logger } from "@/lib/logger";
import { addTradeEventLog } from "@/src/server/repositories/trade-event-log.repository";

export type TradeEventType =
  | "AI_KLINE_INPUT"
  | "AI_KLINE_STALE"
  | "AI_ANALYSIS_STARTED"
  | "AI_ANALYSIS_RESULT"
  | "AI_PROVIDER_RESULT"
  | "BUY_DECISION"
  | "BUY_ORDER_SENT"
  | "BUY_COMPLETED"
  | "TARGET_SELL_CREATED"
  | "TRAILING_STOP_ACTIVE"
  | "TRAILING_LOCK_ACTIVE"
  | "ACTIVE_STOP_UPDATED"
  | "BREAKEVEN_ARMED"
  | "AI_TARGET_RAISED"
  | "OLD_ORDER_CANCELED"
  | "NEW_SELL_ORDER_CREATED"
  | "STOP_TRIGGERED"
  | "SELL_COMPLETED"
  | "PNL_CALCULATED"
  | "SETUP_OUTCOME_RECORDED"
  | "RISK_GATE_BLOCKED";

export type TradeEventPayload = {
  positionId?: string | null;
  symbol: string;
  eventType: TradeEventType;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  aiConfidence?: number | null;
  price?: number | null;
};

export async function logTradeEvent(payload: TradeEventPayload) {
  logger.info(
    {
      symbol: payload.symbol,
      eventType: payload.eventType,
      positionId: payload.positionId,
      reason: payload.reason,
      aiConfidence: payload.aiConfidence,
      price: payload.price,
      oldValue: payload.oldValue,
      newValue: payload.newValue,
    },
    "Trade event log",
  );
  try {
    await addTradeEventLog({
      positionId: payload.positionId ?? null,
      symbol: payload.symbol.toUpperCase(),
      eventType: payload.eventType,
      oldValue: payload.oldValue,
      newValue: payload.newValue,
      reason: payload.reason ?? null,
      aiConfidence: payload.aiConfidence ?? null,
      price: payload.price ?? null,
    });
  } catch {
    // logging must never break execution flow
  }
}
