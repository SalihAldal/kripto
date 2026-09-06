import { getOrderStatus, getOrderStatusByClientOrderId } from "@/services/binance.service";
import { prisma } from "@/src/server/db/prisma";
import { applyCanonicalPartialSettlementFill } from "@/src/server/execution/canonical-settlement-fill.service";
import { buildCanonicalSettlementFillId } from "@/src/server/execution/canonical-fill-identity";
import { buildClientOrderIdFromExitIntent } from "@/src/server/execution/exit-intent-identity";
import type { ExitDecisionKind, ExitPolicyState } from "@/src/server/profitability/pr04-types";
import { updateOrderStatus } from "@/src/server/repositories/execution.repository";
import { Prisma } from "@prisma/client";

const ACTIONABLE_DECISIONS: ExitDecisionKind[] = [
  "STRUCTURAL_STOP",
  "TAKE_PROFIT",
  "PARTIAL_TAKE_PROFIT",
  "TRAILING_STOP",
  "TIME_EXIT",
  "SETUP_INVALIDATION",
  "RISK_OVERRIDE",
  "MANUAL_CLOSE",
];

function asDecisionKind(value: unknown): ExitDecisionKind {
  const str = String(value ?? "").toUpperCase();
  const mapped = ACTIONABLE_DECISIONS.find((d) => d === str);
  return mapped ?? "MANUAL_CLOSE";
}

function mapOrderStatus(raw: string): "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" {
  const upper = raw.toUpperCase();
  if (upper.includes("PARTIALLY")) return "PARTIALLY_FILLED";
  if (upper.includes("FILLED") || upper.includes("SIMULATED")) return "FILLED";
  if (upper.includes("CANCELED")) return "CANCELED";
  if (upper.includes("EXPIRED")) return "EXPIRED";
  if (upper.includes("REJECT")) return "REJECTED";
  return "NEW";
}

type ReconcileOrderRow = Prisma.TradeOrderGetPayload<{
  include: {
    tradingPair: true;
    position: true;
    executions: true;
  };
}>;

type ReconcileFillCandidate = {
  settlementFillId: string;
  executedQty: number;
  fillPrice: number;
  fee: number;
  feeAsset: "BASE" | "QUOTE" | "UNKNOWN";
  fillAtMs: number;
  executionRef: string;
  exchangeTradeId: string;
};

async function resolveLatestOrderState(order: ReconcileOrderRow | null) {
  if (!order) return null;
  const side = order.side;
  const mode = String(((order.position?.metadata as Record<string, unknown> | null) ?? {}).mode ?? "paper");
  if (mode === "live" && order.exchangeOrderId && (order.status === "NEW" || order.status === "PARTIALLY_FILLED")) {
    try {
      const statusRow = await getOrderStatus(order.tradingPair.symbol, order.exchangeOrderId);
      const nextStatus = mapOrderStatus(String((statusRow as Record<string, unknown>).status ?? ""));
      const avgPrice = Number((statusRow as Record<string, unknown>).price ?? order.avgExecutionPrice ?? order.price ?? 0);
      const executedQty = Number((statusRow as Record<string, unknown>).executedQty ?? 0);
      const fee = Number((statusRow as Record<string, unknown>).fee ?? order.fee ?? 0);
      await updateOrderStatus({
        orderId: order.id,
        status: nextStatus,
        executedAt: nextStatus === "FILLED" ? new Date() : undefined,
        avgExecutionPrice: Number.isFinite(avgPrice) && avgPrice > 0 ? avgPrice : undefined,
        fee: Number.isFinite(fee) ? fee : undefined,
      });
      return {
        ...order,
        side,
        status: nextStatus,
        avgExecutionPrice: Number.isFinite(avgPrice) && avgPrice > 0 ? avgPrice : order.avgExecutionPrice,
        fee: Number.isFinite(fee) ? fee : order.fee,
        quantity: Number.isFinite(executedQty) && executedQty > 0 ? executedQty : order.quantity,
      };
    } catch {
      return order;
    }
  }
  return order;
}

async function recoverOrderByIntentClientOrderId(input: {
  activeIntentId: string;
  symbol: string;
  positionId: string;
  userId: string;
  exchangeConnectionId: string;
  tradingPairId: string;
  closeSide: "BUY" | "SELL";
}): Promise<ReconcileOrderRow | null> {
  const clientOrderId = buildClientOrderIdFromExitIntent(input.activeIntentId);
  if (!clientOrderId) return null;
  const remote = await getOrderStatusByClientOrderId(input.symbol, clientOrderId).catch(() => null);
  if (!remote) return null;
  const exchangeOrderId = String(remote.orderId ?? "").trim();
  const mappedStatus = mapOrderStatus(String(remote.status ?? "NEW"));
  const avgExecutionPrice = Number(remote.price ?? 0);
  const executedQty = Number(remote.executedQty ?? 0);
  const existing = await prisma.tradeOrder.findFirst({
    where: {
      positionId: input.positionId,
      side: input.closeSide,
      OR: [{ exchangeOrderId }, { clientOrderId }],
    },
  });
  const order = existing
    ? await prisma.tradeOrder.update({
        where: { id: existing.id },
        data: {
          status: mappedStatus,
          exchangeOrderId: exchangeOrderId || existing.exchangeOrderId,
          avgExecutionPrice: Number.isFinite(avgExecutionPrice) && avgExecutionPrice > 0 ? avgExecutionPrice : undefined,
          quantity: Number.isFinite(executedQty) && executedQty > 0 ? executedQty : existing.quantity,
          metadata: {
            ...(((existing.metadata as Record<string, unknown> | null) ?? {}) as Prisma.InputJsonObject),
            exitIntentId: input.activeIntentId,
            discoveredBy: "clientOrderId",
          } as Prisma.InputJsonValue,
        },
      })
    : await prisma.tradeOrder.create({
        data: {
          userId: input.userId,
          exchangeConnectionId: input.exchangeConnectionId,
          tradingPairId: input.tradingPairId,
          positionId: input.positionId,
          side: input.closeSide,
          type: "MARKET",
          quantity: Number.isFinite(executedQty) && executedQty > 0 ? executedQty : 0,
          price: Number.isFinite(avgExecutionPrice) && avgExecutionPrice > 0 ? avgExecutionPrice : 0,
          status: mappedStatus,
          clientOrderId,
          exchangeOrderId: exchangeOrderId || undefined,
          submittedAt: new Date(),
          metadata: {
            exitIntentId: input.activeIntentId,
            discoveredBy: "clientOrderId",
            closeReason: "MANUAL_CLOSE",
          } as Prisma.InputJsonValue,
        },
      });
  const raw = (remote.raw as Record<string, unknown> | undefined) ?? {};
  const recoveredFills = Array.isArray(raw.fills) ? raw.fills : [];
  for (const fill of recoveredFills) {
    if (!fill || typeof fill !== "object") continue;
    const row = fill as Record<string, unknown>;
    const tradeId = String(row.tradeId ?? row.id ?? row.fillId ?? "").trim();
    const qty = Number(row.executedQty ?? row.qty ?? row.quantity ?? 0);
    const price = Number(row.price ?? 0);
    const fee = Number(row.fee ?? 0);
    const fillAtMs = Number(row.filledAtMs ?? row.time ?? Date.now());
    if (!tradeId || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price <= 0) continue;
    const existingExec = await prisma.tradeExecution.findFirst({
      where: {
        tradeOrderId: order.id,
        status: "SUCCESS",
        OR: [
          { metadata: { path: ["exchangeTradeId"], equals: tradeId } },
          { executionRef: tradeId },
        ],
      },
    });
    if (existingExec) continue;
    await prisma.tradeExecution.create({
      data: {
        tradeOrderId: order.id,
        status: "SUCCESS",
        executionPrice: price,
        executedQty: qty,
        quoteQty: Number((qty * price).toFixed(8)),
        fee: Number.isFinite(fee) ? fee : 0,
        executionRef: tradeId,
        executedAt: new Date(fillAtMs),
        metadata: {
          exchangeTradeId: tradeId,
          discoveredBy: "clientOrderId",
        } as Prisma.InputJsonValue,
      },
    });
  }
  return prisma.tradeOrder.findUnique({
    where: { id: order.id },
    include: {
      tradingPair: true,
      position: true,
      executions: { orderBy: { executedAt: Prisma.SortOrder.asc } },
    },
  });
}

function buildFillCandidateFromExecution(input: {
  venue: string;
  exchangeConnectionId: string;
  symbol: string;
  exchangeOrderId: string;
  execution: ReconcileOrderRow["executions"][number];
}): ReconcileFillCandidate | null {
  const metadata = (input.execution.metadata as Record<string, unknown> | null) ?? {};
  const existingSettlementId = String(metadata.settlementFillId ?? "").trim();
  const exchangeTradeId = String(
    metadata.exchangeTradeId ??
      metadata.fillId ??
      metadata.tradeId,
  ).trim();
  if (!exchangeTradeId) return null;
  const canonicalSettlementId = buildCanonicalSettlementFillId({
    venue: input.venue,
    exchangeConnectionId: input.exchangeConnectionId,
    symbol: input.symbol,
    exchangeOrderId: input.exchangeOrderId,
    exchangeTradeId,
  });
  if (existingSettlementId && existingSettlementId !== canonicalSettlementId) {
    return null;
  }
  const settlementFillId = existingSettlementId || canonicalSettlementId;
  const feeAssetRaw = String(metadata.feeAsset ?? "UNKNOWN").toUpperCase();
  const feeAsset: "BASE" | "QUOTE" | "UNKNOWN" =
    feeAssetRaw === "BASE" || feeAssetRaw === "QUOTE" ? feeAssetRaw : "UNKNOWN";
  const fillAtMs = input.execution.executedAt.getTime();
  if (!Number.isFinite(fillAtMs)) return null;
  return {
    settlementFillId,
    executedQty: input.execution.executedQty,
    fillPrice: input.execution.executionPrice,
    fee: Number(input.execution.fee ?? 0),
    feeAsset,
    fillAtMs,
    executionRef: input.execution.executionRef ?? input.exchangeOrderId,
    exchangeTradeId,
  };
}

function buildFillCandidateFromOrderCumulative(input: {
  venue: string;
  exchangeConnectionId: string;
  symbol: string;
  order: ReconcileOrderRow;
}): ReconcileFillCandidate | null {
  const metadata = (input.order.metadata as Record<string, unknown> | null) ?? {};
  const exchangeOrderId = String(input.order.exchangeOrderId ?? "").trim();
  const exchangeTradeId = String(metadata.exchangeTradeId ?? metadata.tradeId ?? metadata.fillId ?? "").trim();
  if (!exchangeOrderId || !exchangeTradeId) {
    return null;
  }
  const settlementFillId = buildCanonicalSettlementFillId({
    venue: input.venue,
    exchangeConnectionId: input.exchangeConnectionId,
    symbol: input.symbol,
    exchangeOrderId,
    exchangeTradeId,
  });
  const feeAssetRaw = String(metadata.feeAsset ?? "UNKNOWN").toUpperCase();
  const feeAsset: "BASE" | "QUOTE" | "UNKNOWN" =
    feeAssetRaw === "BASE" || feeAssetRaw === "QUOTE" ? feeAssetRaw : "UNKNOWN";
  const fillAtMs = Number(metadata.filledAtMs ?? metadata.executedAtMs ?? input.order.executedAt?.getTime?.() ?? 0);
  if (!Number.isFinite(fillAtMs) || fillAtMs <= 0) {
    return null;
  }
  return {
    settlementFillId,
    executedQty: Number(input.order.quantity),
    fillPrice: Number(input.order.avgExecutionPrice ?? input.order.price ?? 0),
    fee: Number(input.order.fee ?? 0),
    feeAsset,
    fillAtMs,
    executionRef: exchangeOrderId,
    exchangeTradeId,
  };
}

function resolveReconcileOpenFee(position: ReconcileOrderRow["position"]) {
  const metadata = (position?.metadata as Record<string, unknown> | null) ?? {};
  const openFee = Number(metadata.buyFee ?? metadata.openFee ?? 0);
  return Number.isFinite(openFee) && openFee > 0 ? openFee : 0;
}

export async function reconcileFix02ExitBundles(limit = 20) {
  const rows = await prisma.positionExitPersistedState.findMany({
    where: { reconciliationStatus: "RECONCILE_REQUIRED" },
    include: {
      position: {
        include: {
          tradingPair: true,
          tradeOrders: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      },
    },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });
  let recovered = 0;
  let stillPending = 0;
  let unresolvedIdentity = 0;
  let unresolvedIntent = 0;
  for (const row of rows) {
    const position = row.position;
    if (!position) {
      stillPending += 1;
      continue;
    }
    const closeSide: "BUY" | "SELL" = position.side === "LONG" ? "SELL" : "BUY";
    const activeIntentId = row.activeExitIntentId;
    const intentMatchedOrder =
      activeIntentId
        ? await prisma.tradeOrder.findFirst({
            where: {
              positionId: position.id,
              side: closeSide,
              metadata: { path: ["exitIntentId"], equals: activeIntentId },
            },
            include: {
              tradingPair: true,
              position: true,
              executions: { orderBy: { executedAt: Prisma.SortOrder.asc } },
            },
            orderBy: { createdAt: Prisma.SortOrder.desc },
          })
        : null;
    const recoveredIntentOrder =
      activeIntentId && !intentMatchedOrder
        ? await recoverOrderByIntentClientOrderId({
            activeIntentId,
            symbol: position.tradingPair.symbol,
            positionId: position.id,
            userId: position.userId,
            exchangeConnectionId: position.exchangeConnectionId,
            tradingPairId: position.tradingPairId,
            closeSide,
          })
        : null;
    if (activeIntentId && !intentMatchedOrder && !recoveredIntentOrder) {
      unresolvedIntent += 1;
      stillPending += 1;
      continue;
    }
    const latestOrder = await resolveLatestOrderState(
      recoveredIntentOrder ??
        intentMatchedOrder ??
        await prisma.tradeOrder.findFirst({
          where: {
            positionId: position.id,
            side: closeSide,
          },
          include: {
            tradingPair: true,
            position: true,
            executions: { orderBy: { executedAt: Prisma.SortOrder.asc } },
          },
          orderBy: { createdAt: Prisma.SortOrder.desc },
        }),
    );
    if (!latestOrder) {
      stillPending += 1;
      continue;
    }

    const successExecutions = latestOrder.executions.filter((e: ReconcileOrderRow["executions"][number]) => e.status === "SUCCESS" && e.executedQty > 0);
    const fillRows = successExecutions.length
      ? successExecutions
          .map((exec) =>
            buildFillCandidateFromExecution({
              venue: String((position.metadata as Record<string, unknown> | null)?.executionVenue ?? "BINANCE_TR"),
              exchangeConnectionId: position.exchangeConnectionId,
              symbol: position.tradingPair.symbol,
              exchangeOrderId: String(latestOrder.exchangeOrderId ?? latestOrder.clientOrderId ?? ""),
              execution: exec,
            }),
          )
          .filter((row): row is ReconcileFillCandidate => row != null)
      : latestOrder.status === "FILLED" && Number(latestOrder.quantity) > 0
        ? (() => {
            const candidate = buildFillCandidateFromOrderCumulative({
              venue: String((position.metadata as Record<string, unknown> | null)?.executionVenue ?? "BINANCE_TR"),
              exchangeConnectionId: position.exchangeConnectionId,
              symbol: position.tradingPair.symbol,
              order: latestOrder,
            });
            return candidate ? [candidate] : [];
          })()
        : [];
    if (!fillRows.length && latestOrder.status === "FILLED") {
      unresolvedIdentity += 1;
      stillPending += 1;
      continue;
    }

    let appliedAny = false;
    let allSuccessful = true;
    let executedRunning = 0;
    for (const fill of fillRows.sort((a, b) => a.fillAtMs - b.fillAtMs)) {
      if (!Number.isFinite(fill.executedQty) || fill.executedQty <= 0) continue;
      if (!Number.isFinite(fill.fillPrice) || fill.fillPrice <= 0) continue;
      const currentBundle = await prisma.positionExitPersistedState.findUnique({
        where: { positionId: row.positionId },
      });
      if (!currentBundle) break;
      const currentState = currentBundle.state as ExitPolicyState;
      const decisionKind = asDecisionKind(
        (latestOrder.metadata as Record<string, unknown> | null)?.pr04DecisionKind ?? currentState.lastDecision,
      );
      const partialLegId =
        String(
          (latestOrder.metadata as Record<string, unknown> | null)?.pr04PartialLegId ??
            currentState.activeExitOrder?.partialLegId ??
            "",
        ) || null;
      const orderQty = Number(latestOrder.quantity);
      const remainingOrderQty = Number.isFinite(orderQty) ? Math.max(0, orderQty - (executedRunning + fill.executedQty)) : 0;
      const result = await applyCanonicalPartialSettlementFill({
        // Current position is re-read for open-fee apportioning under concurrent reconcile steps.
        // This avoids unconditional openFeePortion=0 accounting.
        openFeePortion: (() => {
          const openFee = resolveReconcileOpenFee(latestOrder.position);
          const denominator = Math.max(latestOrder.position?.quantity ?? fill.executedQty, fill.executedQty);
          return denominator > 0 ? openFee * (fill.executedQty / denominator) : 0;
        })(),
        positionId: position.id,
        settlementFillId: fill.settlementFillId,
        userId: position.userId,
        exchangeConnectionId: position.exchangeConnectionId,
        tradingPairId: position.tradingPairId,
        quoteAsset: position.tradingPair.quoteAsset,
        positionSide: position.side,
        closeSide,
        fillPrice: fill.fillPrice,
        filledQuantity: fill.executedQty,
        closeFee: fill.fee,
        feeAsset: fill.feeAsset,
        feeCurrency: position.tradingPair.quoteAsset,
        clientOrderId: latestOrder.clientOrderId ?? `client-${position.id}`,
        exchangeOrderId: latestOrder.exchangeOrderId ?? `ex-${position.id}`,
        closeReason: String((latestOrder.metadata as Record<string, unknown> | null)?.closeReason ?? "MANUAL_CLOSE"),
        mode: String((position.metadata as Record<string, unknown> | null)?.mode ?? "paper"),
        orderTerminal: latestOrder.status === "FILLED",
        orderRemainingQuantity: latestOrder.status === "FILLED" ? 0 : remainingOrderQty,
        fillAtMs: fill.fillAtMs,
        exitStateUpdate: {
          expectedStateVersion: currentBundle.stateVersion,
          decisionKind,
          partialLegId,
          reconciliationStatus: "RECONCILE_REQUIRED",
        },
        metadata: {
          reconciled: true,
          reconcileSource: "execution-engine-v2",
          exitIntentId: (latestOrder.metadata as Record<string, unknown> | null)?.exitIntentId ?? null,
          exchangeTradeId: fill.exchangeTradeId,
        },
      });
      if (result.status === "APPLIED" || result.status === "ALREADY_APPLIED") {
        appliedAny = true;
        executedRunning += fill.executedQty;
      } else {
        allSuccessful = false;
      }
    }

    if (appliedAny && allSuccessful && latestOrder.status === "FILLED") {
      await prisma.positionExitPersistedState.updateMany({
        where: { positionId: row.positionId },
        data: { reconciliationStatus: "OK", activeExitIntentId: null },
      });
      recovered += 1;
      continue;
    }
    if (appliedAny) {
      stillPending += 1;
      continue;
    }

    if (latestOrder.status === "CANCELED" || latestOrder.status === "REJECTED" || latestOrder.status === "EXPIRED") {
      const currentBundle = await prisma.positionExitPersistedState.findUnique({
        where: { positionId: row.positionId },
      });
      if (!currentBundle) {
        stillPending += 1;
        continue;
      }
      const currentState = currentBundle.state as ExitPolicyState;
      const nextState = {
        ...currentState,
        reservedSellQuantity: 0,
        orderState: "CANCELED" as const,
        activeExitOrder: null,
        version: currentState.version + 1,
      };
      await prisma.positionExitPersistedState.updateMany({
        where: { positionId: row.positionId, stateVersion: currentBundle.stateVersion },
        data: {
          state: nextState as Prisma.InputJsonValue,
          stateVersion: nextState.version,
          terminalStatus: nextState.terminalStatus,
          activeExitIntentId: null,
          reconciliationStatus: "OK",
        },
      });
      recovered += 1;
      continue;
    }

    stillPending += 1;
  }
  return { scanned: rows.length, recovered, stillPending, unresolvedIdentity, unresolvedIntent };
}

