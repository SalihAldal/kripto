import { findLatestPendingCloseOrder } from "@/src/server/repositories/execution.repository";
import { publishExecutionEvent } from "@/src/server/execution/execution-event-bus";

export async function ensureSingleActiveExitOrder(input: {
  executionId: string;
  positionId: string;
  symbol: string;
  side: "BUY" | "SELL";
}) {
  const pending = await findLatestPendingCloseOrder({ positionId: input.positionId, side: input.side });
  if (!pending) return { allowed: true as const, pending: null };
  publishExecutionEvent({
    executionId: input.executionId,
    symbol: input.symbol,
    stage: "order-manager",
    status: "SKIPPED",
    message: `${input.symbol} icin aktif kapanis emri var, yeni emir acilmadi`,
    level: "WARN",
    context: {
      positionId: input.positionId,
      pendingOrderId: pending.id,
      exchangeOrderId: pending.exchangeOrderId,
      orderStatus: pending.status,
    },
  });
  return { allowed: false as const, pending };
}
