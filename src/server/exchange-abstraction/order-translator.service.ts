import type {
  CanonicalOrderRequest,
  CanonicalOrderResponse,
  CanonicalPortfolioBalance,
} from "@/src/server/exchange-abstraction/exchange-abstraction.types";
import type { CanonicalOrderStatusEnum } from "@prisma/client";
import { toExchangeSymbol } from "@/src/server/exchange-abstraction/symbol-normalization.service";

export function toExchangeOrderInput(order: CanonicalOrderRequest): {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity?: number;
  quoteOrderQty?: number;
  price?: number;
  dryRun?: boolean;
} {
  return {
    symbol: toExchangeSymbol(order.canonicalSymbol),
    side: order.side,
    type: order.type === "LIMIT" || order.type === "STOP_LIMIT" ? "LIMIT" : "MARKET",
    quantity: order.quantity,
    quoteOrderQty: order.quoteOrderQty,
    price: order.price,
    dryRun: order.dryRun,
  };
}

export function fromExchangeOrder(
  row: {
    orderId: string;
    symbol: string;
    side: "BUY" | "SELL";
    type: "MARKET" | "LIMIT";
    status: string;
    executedQty: number;
    requestedQty?: number;
    price?: number;
    averagePrice?: number;
    dryRun?: boolean;
  },
  canonicalSymbol: string,
): CanonicalOrderResponse {
  return {
    orderId: row.orderId,
    canonicalSymbol,
    side: row.side,
    type: row.type,
    status: mapOrderStatus(row.status),
    quantity: row.requestedQty ?? row.executedQty,
    executedQty: row.executedQty,
    price: row.price,
    averagePrice: row.averagePrice,
    dryRun: row.dryRun ?? false,
  };
}

function mapOrderStatus(status: string): CanonicalOrderStatusEnum {
  const s = status.toUpperCase();
  if (s === "NEW") return "NEW";
  if (s.includes("PARTIAL")) return "PARTIALLY_FILLED";
  if (s === "FILLED") return "FILLED";
  if (s.includes("CANCEL")) return "CANCELED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "EXPIRED") return "EXPIRED";
  if (s === "SIMULATED") return "FILLED";
  return "UNKNOWN";
}

export function toCanonicalBalances(balances: Array<{ asset: string; free: number; locked: number; total: number }>): CanonicalPortfolioBalance[] {
  return balances.map((b) => ({
    asset: b.asset.toUpperCase(),
    free: b.free,
    locked: b.locked,
    total: b.total,
  }));
}
