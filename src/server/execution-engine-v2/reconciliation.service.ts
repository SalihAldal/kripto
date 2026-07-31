import { prisma } from "@/src/server/db/prisma";
import { getAccountBalances } from "@/services/binance.service";
import { persistExecutionReconciliation } from "@/src/server/execution-engine-v2/execution-engine-v2.repository";
import { emitExecutionEngineV2Event, EXECUTION_ENGINE_V2_EVENT } from "@/src/server/execution-engine-v2/execution-engine-v2.events";

function parseBaseAsset(symbol: string) {
  const upper = symbol.toUpperCase();
  if (upper.endsWith("USDT")) return upper.replace("USDT", "");
  if (upper.endsWith("TRY")) return upper.replace("TRY", "");
  return upper.slice(0, -4);
}

export async function reconcileSymbolState(symbol: string) {
  const baseAsset = parseBaseAsset(symbol);
  const openPosition = await prisma.position.findFirst({
    where: {
      status: "OPEN",
      side: "LONG",
      tradingPair: { symbol: symbol.toUpperCase() },
    },
    orderBy: { openedAt: "desc" },
    include: { tradingPair: true },
  });

  const internalQty = Number(openPosition?.quantity ?? 0);
  let exchangeQty = internalQty;
  let exchangeBalance = 0;

  try {
    const balances = await getAccountBalances();
    const base = balances.find((b) => b.asset === baseAsset);
    exchangeBalance = Number(base?.free ?? 0) + Number(base?.locked ?? 0);
    exchangeQty = Number(base?.free ?? 0);
  } catch {
    return persistExecutionReconciliation({
      symbol,
      internalQty,
      exchangeQty,
      status: "FAILED",
      mismatchReason: "Unable to fetch exchange balances",
    });
  }

  const delta = Math.abs(internalQty - exchangeQty);
  const matched = delta < Math.max(internalQty, exchangeQty) * 0.02 + 1e-8;

  const record = await persistExecutionReconciliation({
    symbol,
    side: "LONG",
    internalQty,
    exchangeQty,
    exchangeBalance,
    status: matched ? "MATCHED" : "MISMATCH",
    mismatchReason: matched ? undefined : `Qty delta ${delta.toFixed(8)}`,
    repairAction: matched ? undefined : "manual_review_required",
    metadata: { positionId: openPosition?.id },
  });

  emitExecutionEngineV2Event(EXECUTION_ENGINE_V2_EVENT.RECONCILED, {
    symbol,
    status: record.status,
    delta,
  });

  return record;
}

export async function reconcileOpenPositions(limit = 10) {
  const positions = await prisma.position.findMany({
    where: { status: "OPEN" },
    include: { tradingPair: true },
    take: limit,
    orderBy: { openedAt: "desc" },
  });
  const results = [];
  for (const pos of positions) {
    results.push(await reconcileSymbolState(pos.tradingPair.symbol));
  }
  return { reconciled: results.length, results };
}
