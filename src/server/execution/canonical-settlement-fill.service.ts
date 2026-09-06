import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import type { SettlementFillResult } from "@/src/server/execution/settlement-fill-result";
import { calculateRealizedPnl } from "@/src/server/execution/pnl-calculator";

type Tx = Prisma.TransactionClient;

export type SettlementFillTransactionHook = "afterDedupClaim" | "afterPositionUpdate" | "afterPnlRecord";

const transactionHooks: Partial<Record<SettlementFillTransactionHook, () => void>> = {};

export function setSettlementFillTransactionHook(
  hook: SettlementFillTransactionHook,
  fn: (() => void) | undefined,
) {
  if (fn) transactionHooks[hook] = fn;
  else delete transactionHooks[hook];
}

export function resetSettlementFillTransactionHooksForTests() {
  for (const key of Object.keys(transactionHooks) as SettlementFillTransactionHook[]) {
    delete transactionHooks[key];
  }
}

function alreadyAppliedResult(input: {
  positionId: string;
  settlementFillId: string;
  positionQuantity: number;
  positionStatus: string;
}): SettlementFillResult {
  return {
    status: "ALREADY_APPLIED",
    positionId: input.positionId,
    settlementFillId: input.settlementFillId,
    executedQuantity: null,
    fillPrice: null,
    fillFee: null,
    feeAsset: null,
    orderTerminal: true,
    orderRemainingQuantity: 0,
    positionRemainingQuantity: input.positionStatus === "OPEN" ? input.positionQuantity : 0,
    positionClosed: input.positionStatus === "CLOSED",
    partial: input.positionStatus === "OPEN",
    reason: "Duplicate settlement fill suppressed",
  };
}

export async function applyCanonicalPartialSettlementFill(input: {
  positionId: string;
  settlementFillId: string;
  userId: string;
  exchangeConnectionId: string;
  tradingPairId: string;
  quoteAsset: string;
  positionSide: "LONG" | "SHORT";
  closeSide: "BUY" | "SELL";
  fillPrice: number;
  filledQuantity: number;
  closeFee: number;
  feeAsset: "BASE" | "QUOTE" | "UNKNOWN";
  openFeePortion: number;
  clientOrderId: string;
  exchangeOrderId: string;
  closeReason: string;
  mode: string;
  metadata?: Record<string, unknown>;
}): Promise<SettlementFillResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const position = await tx.position.findUnique({ where: { id: input.positionId } });
      if (!position || position.status !== "OPEN") {
        return {
          status: "FAILED",
          positionId: input.positionId,
          settlementFillId: input.settlementFillId,
          executedQuantity: null,
          fillPrice: null,
          fillFee: null,
          feeAsset: null,
          orderTerminal: false,
          orderRemainingQuantity: 0,
          positionRemainingQuantity: null,
          positionClosed: false,
          partial: false,
          reason: "Position not open",
        };
      }

      try {
        await tx.positionSettlementFill.create({
          data: {
            positionId: input.positionId,
            settlementFillId: input.settlementFillId,
            executedQty: input.filledQuantity,
            fillPrice: input.fillPrice,
            fee: input.closeFee,
            feeAsset: input.feeAsset,
          },
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === "P2002") {
          return alreadyAppliedResult({
            positionId: input.positionId,
            settlementFillId: input.settlementFillId,
            positionQuantity: position.quantity,
            positionStatus: position.status,
          });
        }
        throw error;
      }

      transactionHooks.afterDedupClaim?.();

      const pnl = calculateRealizedPnl({
        side: input.positionSide,
        entryPrice: position.entryPrice,
        exitPrice: input.fillPrice,
        quantity: input.filledQuantity,
        openFee: input.openFeePortion,
        closeFee: input.closeFee,
        slippageCost: 0,
      });

      const createdCloseOrder = await tx.tradeOrder.create({
        data: {
          userId: input.userId,
          exchangeConnectionId: input.exchangeConnectionId,
          tradingPairId: input.tradingPairId,
          positionId: input.positionId,
          side: input.closeSide,
          type: "MARKET",
          quantity: input.filledQuantity,
          price: input.fillPrice,
          status: "FILLED",
          clientOrderId: input.clientOrderId,
          exchangeOrderId: input.exchangeOrderId,
          submittedAt: new Date(),
          executedAt: new Date(),
          avgExecutionPrice: input.fillPrice,
          fee: input.closeFee,
          feeCurrency: input.quoteAsset,
          metadata: {
            closeReason: input.closeReason,
            mode: input.mode,
            settlementFillId: input.settlementFillId,
            ...(input.metadata ?? {}),
          } as Prisma.InputJsonValue,
        },
      });

      await tx.tradeExecution.create({
        data: {
          tradeOrderId: createdCloseOrder.id,
          status: "SUCCESS",
          executionPrice: input.fillPrice,
          executedQty: input.filledQuantity,
          quoteQty: Number((input.filledQuantity * input.fillPrice).toFixed(8)),
          fee: input.closeFee,
          executionRef: input.exchangeOrderId,
          metadata: {
            mode: input.mode,
            reason: input.closeReason,
            settlementFillId: input.settlementFillId,
            ...(input.metadata ?? {}),
          } as Prisma.InputJsonValue,
        },
      });

      const existingMeta = (position.metadata as Record<string, unknown> | null) ?? {};
      const nextQuantity = Math.max(0, Number((position.quantity - input.filledQuantity).toFixed(8)));
      const nextRealized = Number((position.realizedPnl + pnl.realizedPnl).toFixed(8));
      const nextFeeTotal = Number(((position.feeTotal ?? 0) + input.closeFee).toFixed(8));
      const updatedPosition = await tx.position.update({
        where: { id: input.positionId },
        data: {
          status: nextQuantity > 0 ? "OPEN" : "CLOSED",
          quantity: nextQuantity,
          closePrice: nextQuantity > 0 ? position.closePrice : input.fillPrice,
          realizedPnl: nextRealized,
          feeTotal: nextFeeTotal,
          closedAt: nextQuantity > 0 ? null : new Date(),
          metadata: {
            ...existingMeta,
            partialCloseFills: [
              ...(Array.isArray(existingMeta.partialCloseFills) ? existingMeta.partialCloseFills : []),
              {
                fillId: input.settlementFillId,
                quantity: input.filledQuantity,
                price: input.fillPrice,
                realizedPnlDelta: pnl.realizedPnl,
                at: new Date().toISOString(),
              },
            ],
            ...(input.metadata ?? {}),
          } as Prisma.InputJsonValue,
        },
      });

      transactionHooks.afterPositionUpdate?.();

      await tx.profitLossRecord.create({
        data: {
          userId: input.userId,
          tradingPairId: input.tradingPairId,
          positionId: input.positionId,
          tradeOrderId: createdCloseOrder.id,
          realizedPnl: pnl.realizedPnl,
          unrealizedPnl: 0,
          grossPnl: pnl.grossPnl,
          netPnl: pnl.netPnl,
          feeTotal: pnl.feeTotal,
          slippageCost: pnl.slippageCost,
          roePercent: pnl.roePercent,
          notes: `Partial position close: ${input.closeReason}`,
          metadata: {
            mode: input.mode,
            settlementFillId: input.settlementFillId,
            ...(input.metadata ?? {}),
          } as Prisma.InputJsonValue,
        },
      });

      transactionHooks.afterPnlRecord?.();

      return {
        status: "APPLIED",
        positionId: input.positionId,
        settlementFillId: input.settlementFillId,
        tradeOrderId: createdCloseOrder.id,
        executionRef: input.exchangeOrderId,
        executedQuantity: input.filledQuantity,
        fillPrice: input.fillPrice,
        fillFee: input.closeFee,
        feeAsset: input.feeAsset,
        orderTerminal: true,
        orderRemainingQuantity: 0,
        positionRemainingQuantity: updatedPosition.quantity,
        positionClosed: updatedPosition.status === "CLOSED",
        partial: updatedPosition.status === "OPEN",
      };
    });
  } catch (error) {
    return {
      status: "FAILED",
      positionId: input.positionId,
      settlementFillId: input.settlementFillId,
      executedQuantity: null,
      fillPrice: null,
      fillFee: null,
      feeAsset: null,
      orderTerminal: false,
      orderRemainingQuantity: 0,
      positionRemainingQuantity: null,
      positionClosed: false,
      partial: false,
      reason: (error as Error).message,
    };
  }
}
