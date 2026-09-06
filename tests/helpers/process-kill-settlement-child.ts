import { prisma } from "@/src/server/db/prisma";
import { applyCanonicalPartialSettlementFill, setSettlementFillTransactionHook } from "@/src/server/execution/canonical-settlement-fill.service";

type Mode = "PRE_COMMIT_KILL" | "POST_COMMIT_KILL";

async function main() {
  const mode = String(process.env.CRASH_MODE ?? "") as Mode;
  const positionId = String(process.env.CRASH_POSITION_ID ?? "");
  const userId = String(process.env.CRASH_USER_ID ?? "");
  const exchangeConnectionId = String(process.env.CRASH_CONN_ID ?? "");
  const tradingPairId = String(process.env.CRASH_PAIR_ID ?? "");
  const settlementFillId = String(process.env.CRASH_FILL_ID ?? "");
  const exchangeOrderId = String(process.env.CRASH_ORDER_ID ?? "");
  const exchangeTradeId = String(process.env.CRASH_TRADE_ID ?? "");
  if (!mode || !positionId || !userId || !exchangeConnectionId || !tradingPairId || !settlementFillId) {
    throw new Error("CRASH_CHILD_MISSING_ENV");
  }

  if (mode === "PRE_COMMIT_KILL") {
    setSettlementFillTransactionHook("afterPositionUpdate", () => {
      process.abort();
    });
  }
  const result = await applyCanonicalPartialSettlementFill({
    positionId,
    settlementFillId,
    userId,
    exchangeConnectionId,
    tradingPairId,
    quoteAsset: "TRY",
    positionSide: "LONG",
    closeSide: "SELL",
    fillPrice: 110,
    filledQuantity: 0.4,
    closeFee: 0.1,
    feeAsset: "QUOTE",
    openFeePortion: 0.04,
    clientOrderId: `client-${exchangeTradeId}`,
    exchangeOrderId,
    closeReason: "TAKE_PROFIT",
    mode: "paper",
    orderTerminal: false,
    orderRemainingQuantity: 0.6,
    fillAtMs: Date.now(),
    metadata: { exchangeTradeId },
  });
  if (mode === "POST_COMMIT_KILL" && result.status === "APPLIED") {
    await prisma.position.findUnique({ where: { id: positionId } });
    process.abort();
  }
}

main()
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error((error as Error).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => null);
  });

