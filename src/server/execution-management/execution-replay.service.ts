import { prisma } from "@/src/server/db/prisma";
import { persistExecutionReplay } from "@/src/server/execution-management/execution-management.repository";
import { getPositionSnapshot } from "@/src/server/execution-management/position-manager.service";

export async function replayExecutionRecord(input: {
  executionId: string;
  orderId?: string;
  symbol: string;
  side: string;
  mode: string;
  requestedQty: number;
  executedQty: number;
  requestedPrice: number;
  executionPrice: number;
  fees?: number;
  positionId?: string;
}) {
  const slippagePct =
    input.requestedPrice > 0
      ? Math.abs(((input.executionPrice - input.requestedPrice) / input.requestedPrice) * 100)
      : 0;
  const fillRatio = input.requestedQty > 0 ? input.executedQty / input.requestedQty : 0;
  const positionBefore = input.positionId ? await getPositionSnapshot(input.positionId).catch(() => null) : null;

  const replay = await persistExecutionReplay({
    executionId: input.executionId,
    orderId: input.orderId,
    symbol: input.symbol,
    side: input.side,
    mode: input.mode,
    requestedQty: input.requestedQty,
    executedQty: input.executedQty,
    requestedPrice: input.requestedPrice,
    executionPrice: input.executionPrice,
    slippagePct,
    fees: input.fees,
    fillRatio,
    positionBefore,
    positionAfter: positionBefore,
    metadata: { verified: true },
  });

  return replay;
}

export async function replayRecentExecutions(limit = 50) {
  const orders = await prisma.tradeOrder.findMany({
    where: { status: { in: ["FILLED", "PARTIALLY_FILLED"] } },
    orderBy: { executedAt: "desc" },
    take: limit,
    include: { executions: true, tradingPair: true },
  });

  let replayed = 0;
  for (const order of orders) {
    const execution = order.executions[0];
    if (!execution) continue;
    const meta = (order.metadata as Record<string, unknown> | null) ?? {};
    await replayExecutionRecord({
      executionId: String(meta.executionId ?? order.id),
      orderId: order.id,
      symbol: order.tradingPair.symbol,
      side: order.side,
      mode: String(meta.mode ?? "live"),
      requestedQty: order.quantity,
      executedQty: execution.executedQty,
      requestedPrice: order.price ?? execution.executionPrice,
      executionPrice: execution.executionPrice,
      fees: execution.fee,
      positionId: typeof meta.positionId === "string" ? meta.positionId : undefined,
    }).catch(() => null);
    replayed += 1;
  }
  return { replayed };
}
