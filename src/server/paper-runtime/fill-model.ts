import { applySymbolFilters, DEFAULT_USDT_FILTERS } from "@/src/server/paper-runtime/filters";
import type { BookLevel, FillResult, OrderSide, OrderType, SymbolFilters } from "@/src/server/paper-runtime/types";

function round8(value: number) {
  return Number(value.toFixed(8));
}

export function walkBook(levels: BookLevel[], quantity: number) {
  const fills: Array<{ qty: number; price: number }> = [];
  let remaining = quantity;
  for (const level of levels) {
    if (remaining <= 0) break;
    if (level.price <= 0 || level.quantity <= 0) continue;
    const take = Math.min(remaining, level.quantity);
    fills.push({ qty: take, price: level.price });
    remaining = round8(remaining - take);
  }
  const filledQty = round8(fills.reduce((sum, row) => sum + row.qty, 0));
  const notional = fills.reduce((sum, row) => sum + row.qty * row.price, 0);
  return {
    fills,
    filledQty,
    remainingQty: round8(Math.max(0, remaining)),
    avgPrice: filledQty > 0 ? round8(notional / filledQty) : 0,
    notional: round8(notional),
  };
}

/**
 * Market BUY consumes asks. Market SELL consumes bids.
 * Fill uses execution-time book, not signal lastPrice.
 * Remaining size is NOT invented — PARTIAL or REJECT_INSUFFICIENT_LIQUIDITY.
 */
export function simulateRealisticFill(input: {
  side: OrderSide;
  orderType?: OrderType;
  quantity: number;
  signalPrice: number;
  bids: BookLevel[];
  asks: BookLevel[];
  latencyMs?: number;
  feeRate: number;
  filters?: SymbolFilters;
  limitPrice?: number;
  allowPartial?: boolean;
}): FillResult {
  const latencyMs = Math.max(0, input.latencyMs ?? 0);
  const filters = input.filters ?? DEFAULT_USDT_FILTERS;
  const sized = applySymbolFilters({ quantity: input.quantity, price: input.signalPrice, filters });
  if (!sized.ok) {
    return empty("REJECTED", input.quantity, latencyMs, sized.reasons.join(","));
  }

  if (input.orderType === "LIMIT") {
    const limit = input.limitPrice ?? input.signalPrice;
    const mid = midPrice(input.bids, input.asks, input.signalPrice);
    const conservativeFill = input.side === "BUY" ? mid < limit : mid > limit;
    if (!conservativeFill) {
      return empty("REJECTED", sized.quantity, latencyMs, "LIMIT_NOT_TRADED_THROUGH");
    }
  }

  const book = input.side === "BUY" ? input.asks : input.bids;
  if (!book.length) return empty("REJECTED", sized.quantity, latencyMs, "REJECT_INSUFFICIENT_LIQUIDITY");

  const walked = walkBook(book, sized.quantity);
  if (walked.filledQty <= 0) {
    return empty("REJECTED", sized.quantity, latencyMs, "REJECT_INSUFFICIENT_LIQUIDITY");
  }
  if (walked.remainingQty > 0 && input.allowPartial === false) {
    return empty("REJECTED", sized.quantity, latencyMs, "REJECT_INSUFFICIENT_LIQUIDITY");
  }

  const best = book[0]?.price ?? input.signalPrice;
  const spreadRef = input.side === "BUY" ? best : input.bids[0]?.price ?? best;
  const spreadCostPct =
    input.signalPrice > 0 ? ((spreadRef - input.signalPrice) / input.signalPrice) * 100 * (input.side === "BUY" ? 1 : -1) : 0;
  const slippagePct =
    input.signalPrice > 0
      ? ((walked.avgPrice - input.signalPrice) / input.signalPrice) * 100 * (input.side === "BUY" ? 1 : -1)
      : 0;
  const fee = round8(walked.notional * input.feeRate);
  const status = walked.remainingQty > 1e-12 ? "PARTIALLY_FILLED" : "FILLED";
  return {
    status,
    requestedQty: sized.quantity,
    filledQty: walked.filledQty,
    remainingQty: walked.remainingQty,
    avgPrice: walked.avgPrice,
    notional: walked.notional,
    fee,
    feeRate: input.feeRate,
    spreadCostPct: Number(spreadCostPct.toFixed(6)),
    slippagePct: Number(Math.max(0, slippagePct).toFixed(6)),
    latencyMs,
    rejectReason: null,
  };
}

function empty(status: FillResult["status"], qty: number, latencyMs: number, reason: string): FillResult {
  return {
    status,
    requestedQty: qty,
    filledQty: 0,
    remainingQty: qty,
    avgPrice: 0,
    notional: 0,
    fee: 0,
    feeRate: 0,
    spreadCostPct: 0,
    slippagePct: 0,
    latencyMs,
    rejectReason: reason,
  };
}

function midPrice(bids: BookLevel[], asks: BookLevel[], fallback: number) {
  const bid = bids[0]?.price;
  const ask = asks[0]?.price;
  if (bid && ask) return (bid + ask) / 2;
  return fallback;
}
