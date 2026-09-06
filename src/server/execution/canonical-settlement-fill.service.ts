import { Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import type { SettlementFillResult } from "@/src/server/execution/settlement-fill-result";
import { calculateRealizedPnl } from "@/src/server/execution/pnl-calculator";
import type { ExitDecisionKind, ExitPolicyState } from "@/src/server/profitability/pr04-types";

type Tx = Prisma.TransactionClient;

export type SettlementFillTransactionHook = "afterDedupClaim" | "afterPositionUpdate" | "afterPnlRecord";

const transactionHooks: Partial<Record<SettlementFillTransactionHook, () => void>> = {};
let postCommitHook: (() => void) | undefined;

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
  postCommitHook = undefined;
}

export function setSettlementFillPostCommitHookForTests(fn: (() => void) | undefined) {
  postCommitHook = fn;
}

function toRounded(value: number) {
  return Number(value.toFixed(8));
}

function isRetryableTransactionError(error: unknown) {
  const code = (error as { code?: string }).code;
  return code === "P2034";
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveOrderStatus(input: { terminal: boolean; remaining: number }) {
  if (input.terminal && input.remaining <= 0) return "FILLED" as const;
  if (input.remaining > 0) return "PARTIALLY_FILLED" as const;
  return "NEW" as const;
}

function nearlyEqual(a: number, b: number, epsilon = 1e-8) {
  return Math.abs(a - b) <= epsilon;
}

function mutateExitStateFromFill(input: {
  state: ExitPolicyState;
  settlementFillId: string;
  fillPrice: number;
  filledQuantity: number;
  closeFee: number;
  feeAsset: "BASE" | "QUOTE" | "UNKNOWN";
  fillAtMs: number;
  decisionKind: ExitDecisionKind;
  partialLegId?: string | null;
  orderRemainingQuantity: number;
}) {
  const next = JSON.parse(JSON.stringify(input.state)) as ExitPolicyState;
  if (!Number.isFinite(input.filledQuantity) || input.filledQuantity <= 0) {
    throw new Error("SETTLEMENT_INVALID_FILLED_QUANTITY");
  }
  if (input.filledQuantity - next.remainingQuantity > 1e-8) {
    throw new Error("SETTLEMENT_FILL_EXCEEDS_EXIT_STATE_REMAINING");
  }
  next.remainingQuantity = toRounded(next.remainingQuantity - input.filledQuantity);
  next.exitFills.push({
    fillId: input.settlementFillId,
    side: "SELL",
    price: input.fillPrice,
    quantity: input.filledQuantity,
    fee: input.closeFee,
    feeAsset: input.feeAsset,
    filledAtMs: input.fillAtMs,
    decisionKind: input.decisionKind,
  });
  if (input.partialLegId && !next.completedPartialLegs.includes(input.partialLegId)) {
    next.completedPartialLegs.push(input.partialLegId);
  }
  if (input.orderRemainingQuantity > 0) {
    next.reservedSellQuantity = toRounded(input.orderRemainingQuantity);
    next.orderState = "PARTIALLY_FILLED";
    if (next.activeExitOrder) {
      next.activeExitOrder.executedQuantity = toRounded(next.activeExitOrder.executedQuantity + input.filledQuantity);
      next.activeExitOrder.openQuantity = toRounded(input.orderRemainingQuantity);
      next.activeExitOrder.terminal = false;
    }
  } else {
    const nextReserved = toRounded(next.reservedSellQuantity - input.filledQuantity);
    if (nextReserved < -1e-8 && next.activeExitOrder) throw new Error("SETTLEMENT_EXIT_RESERVATION_UNDERFLOW");
    if (nextReserved < -1e-8) {
      next.lastReasonCode = "RESERVATION_RECONCILED_FROM_DB";
      next.reservedSellQuantity = 0;
    } else {
      next.reservedSellQuantity = Math.max(0, nextReserved);
    }
    next.orderState = next.remainingQuantity <= 0 ? "FILLED" : "NONE";
    next.activeExitOrder = null;
  }
  next.terminalStatus = next.remainingQuantity <= 0 ? "CLOSED" : "REDUCING";
  next.lastDecision = input.decisionKind;
  next.version += 1;
  return next;
}

function alreadyAppliedResult(input: {
  positionId: string;
  settlementFillId: string;
  tradeOrderId?: string | null;
  executedQuantity: number;
  fillPrice: number;
  fillFee: number;
  feeAsset: "BASE" | "QUOTE" | "UNKNOWN";
  positionQuantity: number;
  positionStatus: string;
}): SettlementFillResult {
  return {
    status: "ALREADY_APPLIED",
    positionId: input.positionId,
    settlementFillId: input.settlementFillId,
    tradeOrderId: input.tradeOrderId ?? undefined,
    executedQuantity: input.executedQuantity,
    fillPrice: input.fillPrice,
    fillFee: input.fillFee,
    feeAsset: input.feeAsset,
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
  orderTerminal?: boolean;
  orderRemainingQuantity?: number;
  fillAtMs?: number;
  feeCurrency?: string | null;
  exitStateUpdate?: {
    expectedStateVersion: number;
    decisionKind: ExitDecisionKind;
    partialLegId?: string | null;
    reconciliationStatus?: "OK" | "RECONCILE_REQUIRED";
  };
  metadata?: Record<string, unknown>;
}): Promise<SettlementFillResult> {
  if (!Number.isFinite(input.filledQuantity) || input.filledQuantity <= 0) {
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
      reason: "Invalid fill quantity",
    };
  }
  if (!Number.isFinite(input.fillPrice) || input.fillPrice <= 0) {
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
      reason: "Invalid fill price",
    };
  }
  if (!Number.isFinite(input.closeFee) || input.closeFee < 0) {
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
      reason: "Invalid close fee",
    };
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const txResult = await prisma.$transaction<SettlementFillResult>(async (tx) => {
        const dedupExisting = await tx.positionSettlementFill.findUnique({
          where: {
            positionId_settlementFillId: {
              positionId: input.positionId,
              settlementFillId: input.settlementFillId,
            },
          },
        });
        if (dedupExisting) {
          const dedupPosition = await tx.position.findUnique({ where: { id: input.positionId } });
          return alreadyAppliedResult({
            positionId: input.positionId,
            settlementFillId: input.settlementFillId,
            tradeOrderId: dedupExisting.tradeOrderId,
            executedQuantity: dedupExisting.executedQty,
            fillPrice: dedupExisting.fillPrice,
            fillFee: dedupExisting.fee,
            feeAsset: (dedupExisting.feeAsset as "BASE" | "QUOTE" | "UNKNOWN" | null) ?? "UNKNOWN",
            positionQuantity: dedupPosition?.quantity ?? 0,
            positionStatus: dedupPosition?.status ?? "CLOSED",
          });
        }

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
      if (input.filledQuantity - position.quantity > 1e-8) {
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
          positionRemainingQuantity: position.quantity,
          positionClosed: false,
          partial: false,
          reason: "Fill quantity exceeds remaining position quantity",
        };
      }

      const dedup = await tx.positionSettlementFill.create({
        data: {
          positionId: input.positionId,
          settlementFillId: input.settlementFillId,
          executedQty: input.filledQuantity,
          fillPrice: input.fillPrice,
          fee: input.closeFee,
          feeAsset: input.feeAsset,
        },
      });

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

      const orderRemainingQuantity = Number.isFinite(input.orderRemainingQuantity)
        ? Math.max(0, Number(input.orderRemainingQuantity))
        : 0;
      const terminal = input.orderTerminal ?? orderRemainingQuantity <= 0;
      const orderStatus = deriveOrderStatus({ terminal, remaining: orderRemainingQuantity });
      const exchangeTradeId = String((input.metadata as Record<string, unknown> | undefined)?.exchangeTradeId ?? "").trim();
      const existingOrder = await tx.tradeOrder.findFirst({
        where: {
          positionId: input.positionId,
          OR: [
            { exchangeOrderId: input.exchangeOrderId },
            { clientOrderId: input.clientOrderId },
          ],
        },
        orderBy: { createdAt: "desc" },
      });
      const matchedExecution = existingOrder
        ? await tx.tradeExecution.findFirst({
            where: {
              tradeOrderId: existingOrder.id,
              status: "SUCCESS",
              OR: [
                { metadata: { path: ["settlementFillId"], equals: input.settlementFillId } },
                ...(exchangeTradeId
                  ? [
                      { metadata: { path: ["exchangeTradeId"], equals: exchangeTradeId } },
                      { executionRef: exchangeTradeId },
                    ]
                  : []),
              ],
            },
            orderBy: { executedAt: "desc" },
          })
        : null;
      if (matchedExecution) {
        if (
          !nearlyEqual(matchedExecution.executedQty, input.filledQuantity) ||
          !nearlyEqual(matchedExecution.executionPrice, input.fillPrice) ||
          !nearlyEqual(Number(matchedExecution.fee ?? 0), input.closeFee)
        ) {
          throw new Error("SETTLEMENT_EXECUTION_IDENTITY_CONFLICT");
        }
      }
      const priorExecAgg = existingOrder
        ? await tx.tradeExecution.aggregate({
            where: { tradeOrderId: existingOrder.id, status: "SUCCESS" },
            _sum: { executedQty: true, quoteQty: true, fee: true },
          })
        : null;
      const prevQty = Number(priorExecAgg?._sum.executedQty ?? 0);
      const prevQuote = Number(priorExecAgg?._sum.quoteQty ?? 0);
      const prevFeeFromExecutions = Number(priorExecAgg?._sum.fee ?? 0);
      const shouldCreateExecution = !matchedExecution;
      const totalExecutedQty = toRounded(prevQty + (shouldCreateExecution ? input.filledQuantity : 0));
      const totalQuote = toRounded(prevQuote + (shouldCreateExecution ? input.filledQuantity * input.fillPrice : 0));
      const nextAvg = totalExecutedQty > 0 ? toRounded(totalQuote / totalExecutedQty) : input.fillPrice;
      const totalRequestedQty = toRounded(Math.max(existingOrder?.quantity ?? 0, totalExecutedQty + orderRemainingQuantity));
      const totalFee = toRounded(prevFeeFromExecutions + (shouldCreateExecution ? input.closeFee : 0));
      const createdCloseOrder = existingOrder
        ? await tx.tradeOrder.update({
            where: { id: existingOrder.id },
            data: {
              status: orderStatus,
              quantity: totalRequestedQty,
              avgExecutionPrice: nextAvg,
              fee: totalFee,
              feeCurrency: input.feeCurrency ?? input.quoteAsset,
              executedAt: terminal ? new Date(input.fillAtMs ?? Date.now()) : null,
              metadata: {
                ...(((existingOrder.metadata as Record<string, unknown> | null) ?? {}) as Prisma.InputJsonObject),
                closeReason: input.closeReason,
                mode: input.mode,
                settlementFillId: input.settlementFillId,
                ...(input.metadata ?? {}),
              } as Prisma.InputJsonValue,
            },
          })
        : await tx.tradeOrder.create({
            data: {
              userId: input.userId,
              exchangeConnectionId: input.exchangeConnectionId,
              tradingPairId: input.tradingPairId,
              positionId: input.positionId,
              side: input.closeSide,
              type: "MARKET",
              quantity: totalRequestedQty,
              price: input.fillPrice,
              status: orderStatus,
              clientOrderId: input.clientOrderId,
              exchangeOrderId: input.exchangeOrderId,
              submittedAt: new Date(input.fillAtMs ?? Date.now()),
              executedAt: terminal ? new Date(input.fillAtMs ?? Date.now()) : null,
              avgExecutionPrice: nextAvg,
              fee: totalFee,
              feeCurrency: input.feeCurrency ?? input.quoteAsset,
              metadata: {
                closeReason: input.closeReason,
                mode: input.mode,
                settlementFillId: input.settlementFillId,
                ...(input.metadata ?? {}),
              } as Prisma.InputJsonValue,
            },
          });
      await tx.positionSettlementFill.update({
        where: { id: dedup.id },
        data: { tradeOrderId: createdCloseOrder.id },
      });

      if (shouldCreateExecution) {
        await tx.tradeExecution.create({
          data: {
            tradeOrderId: createdCloseOrder.id,
            status: "SUCCESS",
            executionPrice: input.fillPrice,
            executedQty: input.filledQuantity,
            quoteQty: Number((input.filledQuantity * input.fillPrice).toFixed(8)),
            fee: input.closeFee,
            executionRef: exchangeTradeId || input.exchangeOrderId,
            executedAt: new Date(input.fillAtMs ?? Date.now()),
            metadata: {
              mode: input.mode,
              reason: input.closeReason,
              settlementFillId: input.settlementFillId,
              ...(input.metadata ?? {}),
            } as Prisma.InputJsonValue,
          },
        });
      } else {
        const execMeta = (matchedExecution.metadata as Record<string, unknown> | null) ?? {};
        await tx.tradeExecution.update({
          where: { id: matchedExecution.id },
          data: {
            metadata: {
              ...execMeta,
              settlementFillId: input.settlementFillId,
              ...(input.metadata ?? {}),
            } as Prisma.InputJsonValue,
          },
        });
      }

      const existingMeta = (position.metadata as Record<string, unknown> | null) ?? {};
      const nextQuantityRaw = toRounded(position.quantity - input.filledQuantity);
      if (nextQuantityRaw < -1e-8) {
        throw new Error("SETTLEMENT_POSITION_QUANTITY_UNDERFLOW");
      }
      const nextQuantity = Math.max(0, nextQuantityRaw);
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

      if (input.exitStateUpdate) {
        const exitRow = await tx.positionExitPersistedState.findUnique({
          where: { positionId: input.positionId },
        });
        if (!exitRow) {
          throw new Error(`EXIT_STATE_MISSING:${input.positionId}`);
        }
        const nextState = mutateExitStateFromFill({
          state: exitRow.state as ExitPolicyState,
          settlementFillId: input.settlementFillId,
          fillPrice: input.fillPrice,
          filledQuantity: input.filledQuantity,
          closeFee: input.closeFee,
          feeAsset: input.feeAsset,
          fillAtMs: input.fillAtMs ?? Date.now(),
          decisionKind: input.exitStateUpdate.decisionKind,
          partialLegId: input.exitStateUpdate.partialLegId ?? null,
          orderRemainingQuantity,
        });
        const nextProcessed = Array.isArray(exitRow.processedFillIds)
          ? [...new Set([...(exitRow.processedFillIds as string[]), input.settlementFillId])]
          : [input.settlementFillId];
        const updated = await tx.positionExitPersistedState.updateMany({
          where: {
            positionId: input.positionId,
            stateVersion: input.exitStateUpdate.expectedStateVersion,
          },
          data: {
            state: nextState as Prisma.InputJsonValue,
            stateVersion: nextState.version,
            terminalStatus: nextState.terminalStatus,
            processedFillIds: nextProcessed as Prisma.InputJsonValue,
            activeExitIntentId: null,
            reconciliationStatus: input.exitStateUpdate.reconciliationStatus ?? "OK",
          },
        });
        if (updated.count !== 1) {
          throw new Error(`EXIT_STATE_VERSION_CONFLICT:${input.positionId}`);
        }
      }

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
        orderTerminal: terminal,
        orderRemainingQuantity,
        positionRemainingQuantity: updatedPosition.quantity,
        positionClosed: updatedPosition.status === "CLOSED",
        partial: updatedPosition.status === "OPEN",
      };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      postCommitHook?.();
      return txResult;
    } catch (error) {
      if (isRetryableTransactionError(error) && attempt < 5) {
        await sleep(15 * (attempt + 1));
        continue;
      }
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
    reason: "SETTLEMENT_RETRY_EXHAUSTED",
  };
}
