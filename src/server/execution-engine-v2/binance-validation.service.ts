import { validateSymbolFilters, calculateValidQuantity } from "@/services/binance.service";

export type BinanceValidationResult = {
  ok: boolean;
  quantity: number;
  price?: number;
  notional: number;
  rejectReasons: string[];
  filters: Record<string, unknown>;
};

export async function validateBinanceSpotOrder(input: {
  symbol: string;
  side: "BUY" | "SELL";
  quantity?: number;
  quoteOrderQty?: number;
  price?: number;
}) {
  const rejectReasons: string[] = [];
  const rawQty =
    input.quantity ??
    (input.quoteOrderQty && input.price && input.price > 0 ? input.quoteOrderQty / input.price : 0);

  const validation = await validateSymbolFilters(input.symbol, rawQty, input.price);

  if (!validation.ok) {
    rejectReasons.push(...(validation.reasons ?? []));
    return {
      ok: false,
      quantity: 0,
      notional: 0,
      rejectReasons,
      filters: {},
    } satisfies BinanceValidationResult;
  }

  const qty = await calculateValidQuantity(input.symbol, validation.adjustedQuantity ?? rawQty);

  if (qty <= 0) rejectReasons.push("Quantity below MIN_QTY after STEP_SIZE rounding");

  const effectivePrice = input.price ?? validation.adjustedPrice ?? 0;
  const notional = input.quoteOrderQty ?? qty * effectivePrice;
  const minNotional = validation.minNotional ?? 0;
  if (minNotional > 0 && notional < minNotional) {
    rejectReasons.push("Below MIN_NOTIONAL");
  }

  return {
    ok: rejectReasons.length === 0,
    quantity: qty,
    price: effectivePrice,
    notional,
    rejectReasons,
    filters: {
      minNotional: validation.minNotional,
      adjustedQuantity: validation.adjustedQuantity,
      adjustedPrice: validation.adjustedPrice,
    },
  } satisfies BinanceValidationResult;
}
