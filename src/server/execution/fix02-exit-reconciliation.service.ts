import { getOrderStatus } from "@/services/binance.service";
import { prisma } from "@/src/server/db/prisma";
import { applyCanonicalPartialSettlementFill } from "@/src/server/execution/canonical-settlement-fill.service";
import type { ExitDecisionKind, ExitPolicyState } from "@/src/server/profitability/pr04-types";
import { updateOrderStatus } from "@/src/server/repositories/execution.repository";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";

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

function buildSyntheticFillId(input: {
  exchangeConnectionId: string;
  symbol: string;
  exchangeOrderId?: string | null;
  clientOrderId?: string | null;
  executedQty: number;
  avgPrice: number;
  fee: number;
}) {
  return createHash("sha256")
    .update(
      [
        "reconcile-fill-v1",
        input.exchangeConnectionId,
        input.symbol,
        input.exchangeOrderId ?? "",
        input.clientOrderId ?? "",
        input.executedQty.toFixed(8),
        input.avgPrice.toFixed(8),
        input.fee.toFixed(8),
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 32);
}

type ReconcileOrderRow = Prisma.TradeOrderGetPayload<{
  include: {
    tradingPair: true;
    position: true;
    executions: true;
  };
}>;

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
  for (const row of rows) {
    const state = row.state as ExitPolicyState;
    const position = row.position;
    if (!position) {
      stillPending += 1;
      continue;
    }
    const closeSide = position.side === "LONG" ? "SELL" : "BUY";
    const latestOrder = await resolveLatestOrderState(
      await prisma.tradeOrder.findFirst({
        where: {
          positionId: position.id,
          side: closeSide,
        },
        include: {
          tradingPair: true,
          position: true,
          executions: { orderBy: { executedAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
    if (!latestOrder) {
      stillPending += 1;
      continue;
    }

    const successExecutions = latestOrder.executions.filter((e: ReconcileOrderRow["executions"][number]) => e.status === "SUCCESS" && e.executedQty > 0);
    const fillRows = successExecutions.length
      ? successExecutions.map((exec) => ({
          settlementFillId: `reconcile:${exec.id}`,
          executedQty: exec.executedQty,
          fillPrice: exec.executionPrice,
          fee: Number(exec.fee ?? 0),
        }))
      : latestOrder.status === "FILLED" && Number(latestOrder.quantity) > 0
        ? [{
            settlementFillId: buildSyntheticFillId({
              exchangeConnectionId: position.exchangeConnectionId,
              symbol: position.tradingPair.symbol,
              exchangeOrderId: latestOrder.exchangeOrderId,
              clientOrderId: latestOrder.clientOrderId,
              executedQty: Number(latestOrder.quantity),
              avgPrice: Number(latestOrder.avgExecutionPrice ?? latestOrder.price ?? 0),
              fee: Number(latestOrder.fee ?? 0),
            }),
            executedQty: Number(latestOrder.quantity),
            fillPrice: Number(latestOrder.avgExecutionPrice ?? latestOrder.price ?? 0),
            fee: Number(latestOrder.fee ?? 0),
          }]
        : [];

    let appliedAny = false;
    for (const fill of fillRows) {
      if (!Number.isFinite(fill.executedQty) || fill.executedQty <= 0) continue;
      if (!Number.isFinite(fill.fillPrice) || fill.fillPrice <= 0) continue;
      const result = await applyCanonicalPartialSettlementFill({
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
        feeAsset: "QUOTE",
        feeCurrency: position.tradingPair.quoteAsset,
        openFeePortion: 0,
        clientOrderId: latestOrder.clientOrderId ?? `client-${position.id}`,
        exchangeOrderId: latestOrder.exchangeOrderId ?? `ex-${position.id}`,
        closeReason: String((latestOrder.metadata as Record<string, unknown> | null)?.closeReason ?? "MANUAL_CLOSE"),
        mode: String((position.metadata as Record<string, unknown> | null)?.mode ?? "paper"),
        orderTerminal: latestOrder.status === "FILLED",
        orderRemainingQuantity: latestOrder.status === "FILLED"
          ? 0
          : Math.max(0, Number(latestOrder.quantity) - fill.executedQty),
        fillAtMs: Date.now(),
        exitStateUpdate: {
          expectedStateVersion: row.stateVersion,
          decisionKind: asDecisionKind(
            (latestOrder.metadata as Record<string, unknown> | null)?.pr04DecisionKind ?? state.lastDecision,
          ),
          partialLegId: String(
            (latestOrder.metadata as Record<string, unknown> | null)?.pr04PartialLegId ??
              state.activeExitOrder?.partialLegId ??
              "",
          ) || null,
        },
        metadata: {
          reconciled: true,
          reconcileSource: "execution-engine-v2",
          exitIntentId: (latestOrder.metadata as Record<string, unknown> | null)?.exitIntentId ?? null,
        },
      });
      if (result.status === "APPLIED" || result.status === "ALREADY_APPLIED") {
        appliedAny = true;
      }
    }

    if (appliedAny) {
      recovered += 1;
      continue;
    }

    if (latestOrder.status === "CANCELED" || latestOrder.status === "REJECTED" || latestOrder.status === "EXPIRED") {
      const nextState = {
        ...state,
        reservedSellQuantity: 0,
        orderState: "CANCELED" as const,
        activeExitOrder: null,
        version: state.version + 1,
      };
      await prisma.positionExitPersistedState.updateMany({
        where: { positionId: row.positionId, stateVersion: row.stateVersion },
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
  return { scanned: rows.length, recovered, stillPending };
}

