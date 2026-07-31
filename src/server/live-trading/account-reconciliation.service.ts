import { prisma } from "@/src/server/db/prisma";
import { getAccountBalances } from "@/services/binance.service";
import { reconcileSymbolState } from "@/src/server/execution-engine-v2/reconciliation.service";
import { tripCircuitBreaker } from "@/src/server/live-trading/circuit-breaker.service";
import { dispatchLiveAlert } from "@/src/server/live-trading/alert-dispatcher.service";

export async function reconcileUserAccount(userId: string) {
  const openPositions = await prisma.position.findMany({
    where: { userId, status: "OPEN" },
    include: { tradingPair: true },
  });

  const results = [];
  for (const pos of openPositions) {
    const result = await reconcileSymbolState(pos.tradingPair.symbol);
    results.push(result);

    if (result.status === "MISMATCH") {
      await dispatchLiveAlert({
        userId,
        eventType: "RECONCILIATION_MISMATCH",
        severity: "ERROR",
        title: `Reconciliation mismatch: ${pos.tradingPair.symbol}`,
        message: result.mismatchReason ?? "Balance/position mismatch detected",
      });

      const repaired = await attemptAutoRepair(userId, pos.tradingPair.symbol, result);
      if (!repaired) {
        await tripCircuitBreaker({
          userId,
          reason: "PORTFOLIO_MISMATCH",
          message: `Unrepaired mismatch on ${pos.tradingPair.symbol}`,
          evidence: result as unknown as Record<string, unknown>,
          activateKillSwitch: false,
        });
      }
    }
  }

  let exchangeBalances: Record<string, number> = {};
  try {
    const balances = await getAccountBalances();
    exchangeBalances = Object.fromEntries(balances.map((b) => [b.asset, Number(b.free ?? 0) + Number(b.locked ?? 0)]));
  } catch {
    return { userId, results, exchangeBalances, error: "exchange_unreachable" };
  }

  return { userId, results, exchangeBalances, mismatches: results.filter((r) => r.status === "MISMATCH").length };
}

export async function reconcileAllSymbols(userId: string) {
  return reconcileUserAccount(userId);
}

async function attemptAutoRepair(
  userId: string,
  symbol: string,
  result: { internalQty: number | null; exchangeQty: number | null; status: string },
) {
  const internalQty = result.internalQty ?? 0;
  const exchangeQty = result.exchangeQty ?? 0;
  const delta = Math.abs(internalQty - exchangeQty);
  const tolerance = Math.max(internalQty, exchangeQty) * 0.02 + 1e-8;
  if (delta <= tolerance) return true;

  const position = await prisma.position.findFirst({
    where: { userId, status: "OPEN", tradingPair: { symbol } },
    include: { tradingPair: true },
  });

  if (position && exchangeQty < internalQty * 0.5) {
    await prisma.position.update({
      where: { id: position.id },
      data: {
        quantity: exchangeQty,
        metadata: {
          ...((position.metadata as Record<string, unknown> | null) ?? {}),
          reconciledAt: new Date().toISOString(),
          previousQty: internalQty,
        },
      },
    });
    return true;
  }

  return false;
}
