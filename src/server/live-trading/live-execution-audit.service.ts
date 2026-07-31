import { recordLiveExecution, upsertLiveTrade } from "@/src/server/live-trading/live-trading.repository";
import { recordExecutionFailure } from "@/src/server/live-trading/circuit-breaker.service";
import { dispatchLiveAlert } from "@/src/server/live-trading/alert-dispatcher.service";

export async function auditLiveExecution(input: {
  userId: string;
  executionId: string;
  logKey?: string;
  symbol: string;
  side: "BUY" | "SELL";
  requestedQty?: number;
  executedQty: number;
  requestedPrice?: number;
  fillPrice: number;
  commission?: number;
  slippagePct?: number;
  latencyMs?: number;
  executionConfidence?: number;
  executionResult?: string;
  orderRequest?: Record<string, unknown>;
  exchangeResponse?: Record<string, unknown>;
  decisionId?: string;
  positionId?: string;
  modelVersion?: string;
}) {
  const executionKey = `live_${input.executionId}_${input.side}`;

  let liveTradeId: string | undefined;
  if (input.side === "BUY") {
    const trade = await upsertLiveTrade({
      tradeKey: `live_${input.userId}_${input.symbol}_${input.executionId}`,
      userId: input.userId,
      symbol: input.symbol,
      side: input.side,
      status: "OPEN",
      entryPrice: input.fillPrice,
      quantity: input.executedQty,
      fees: input.commission ?? 0,
      slippagePct: input.slippagePct ?? 0,
      decisionId: input.decisionId,
      executionId: input.executionId,
      positionId: input.positionId,
      modelVersion: input.modelVersion,
      metadata: { source: "live-execution-audit" },
    });
    liveTradeId = trade.id;

    await dispatchLiveAlert({
      userId: input.userId,
      eventType: "TRADE_OPEN",
      severity: "INFO",
      title: `Live BUY ${input.symbol}`,
      message: `Filled ${input.executedQty} @ ${input.fillPrice} (latency ${input.latencyMs ?? 0}ms)`,
    });
  } else {
    const openTrade = await import("@/src/server/db/prisma").then((m) =>
      m.prisma.liveTrade.findFirst({
        where: { userId: input.userId, symbol: input.symbol, status: "OPEN" },
        orderBy: { openedAt: "desc" },
      }),
    );
    if (openTrade) {
      const pnl = (input.fillPrice - openTrade.entryPrice) * input.executedQty - (input.commission ?? 0) - openTrade.fees;
      const returnPct = openTrade.entryPrice > 0 ? ((input.fillPrice - openTrade.entryPrice) / openTrade.entryPrice) * 100 : 0;
      const holdSec = Math.floor((Date.now() - openTrade.openedAt.getTime()) / 1000);
      await upsertLiveTrade({
        tradeKey: openTrade.tradeKey,
        userId: input.userId,
        symbol: input.symbol,
        side: "BUY",
        status: "CLOSED",
        entryPrice: openTrade.entryPrice,
        exitPrice: input.fillPrice,
        quantity: openTrade.quantity,
        realizedPnl: pnl,
        returnPct,
        fees: openTrade.fees + (input.commission ?? 0),
        holdSec,
        closedAt: new Date(),
      });
      liveTradeId = openTrade.id;

      const { recordLiveTradeOutcome } = await import("@/src/server/live-trading/capital-protection.service");
      await recordLiveTradeOutcome({ userId: input.userId, returnPct, realizedPnl: pnl });

      await dispatchLiveAlert({
        userId: input.userId,
        eventType: "TRADE_CLOSE",
        severity: returnPct >= 0 ? "INFO" : "WARN",
        title: `Live SELL ${input.symbol}`,
        message: `PnL ${pnl.toFixed(2)} (${returnPct.toFixed(2)}%)`,
      });
    }
  }

  const execution = await recordLiveExecution({
    executionKey,
    userId: input.userId,
    liveTradeId,
    executionId: input.executionId,
    logKey: input.logKey,
    symbol: input.symbol,
    side: input.side,
    orderRequest: input.orderRequest,
    exchangeResponse: input.exchangeResponse,
    requestedQty: input.requestedQty,
    executedQty: input.executedQty,
    requestedPrice: input.requestedPrice,
    fillPrice: input.fillPrice,
    commission: input.commission,
    slippagePct: input.slippagePct,
    latencyMs: input.latencyMs,
    executionConfidence: input.executionConfidence,
    executionResult: input.executionResult ?? "FILLED",
  });

  if (input.executionResult === "FAILED") {
    await recordExecutionFailure(input.userId);
  }

  return execution;
}

export async function auditRecentExecutions(userId?: string, limit = 50) {
  const { prisma } = await import("@/src/server/db/prisma");
  const logs = await prisma.executionLog.findMany({
    where: { mode: "live", ...(userId ? { userId } : {}) },
    orderBy: { submittedAt: "desc" },
    take: limit,
  });

  let audited = 0;
  for (const log of logs) {
    const existing = await prisma.liveExecution.findFirst({ where: { logKey: log.logKey } });
    if (existing) continue;
    if (log.status !== "VERIFIED" || !log.averageFillPrice || !log.userId) continue;

    await auditLiveExecution({
      userId: log.userId,
      executionId: log.executionId,
      logKey: log.logKey,
      symbol: log.symbol,
      side: log.side as "BUY" | "SELL",
      executedQty: log.filledQuantity ?? 0,
      requestedPrice: log.requestedPrice ?? undefined,
      fillPrice: log.averageFillPrice,
      commission: log.fee ?? 0,
      slippagePct: log.slippagePct ?? 0,
      executionResult: log.status,
    });
    audited++;
  }

  return { audited, scanned: logs.length };
}
