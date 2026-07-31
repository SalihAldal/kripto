import { listTradeEventLogs } from "@/src/server/repositories/trade-event-log.repository";
import { listSystemLogs } from "@/src/server/repositories/log.repository";

export async function getTradingTimeline(input?: { symbol?: string; positionId?: string; limit?: number }) {
  const limit = Math.max(1, Math.min(300, Number(input?.limit ?? 120)));
  const [tradeEvents, systemLogs] = await Promise.all([
    listTradeEventLogs({ symbol: input?.symbol, positionId: input?.positionId, limit }).catch(() => []),
    listSystemLogs({ symbol: input?.symbol, limit }).catch(() => []),
  ]);

  return [
    ...tradeEvents.map((row) => ({
      id: row.id,
      type: "trade_event",
      eventType: row.eventType,
      symbol: row.symbol,
      positionId: row.positionId,
      message: row.reason ?? row.eventType,
      price: row.price,
      aiConfidence: row.aiConfidence,
      createdAt: row.createdAt.toISOString(),
      context: {
        oldValue: row.oldValue,
        newValue: row.newValue,
      },
    })),
    ...systemLogs.map((row) => ({
      id: row.id,
      type: "system_log",
      eventType: String((row.context as Record<string, unknown> | null)?.actionType ?? row.source),
      symbol: String((row.context as Record<string, unknown> | null)?.symbol ?? ""),
      positionId: String((row.context as Record<string, unknown> | null)?.positionId ?? ""),
      message: row.message,
      price: null,
      aiConfidence: null,
      createdAt: row.createdAt.toISOString(),
      context: row.context,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}
