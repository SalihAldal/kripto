import type { SymbolFilters } from "@/src/server/paper-runtime/types";

export const DEFAULT_USDT_FILTERS: SymbolFilters = {
  tickSize: 0.0001,
  stepSize: 0.01,
  minQty: 0.01,
  maxQty: 1_000_000,
  minNotional: 10,
};

export function roundToStep(value: number, step: number) {
  if (step <= 0) return value;
  const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 0;
  const rounded = Math.floor(value / step + 1e-12) * step;
  return Number(rounded.toFixed(decimals));
}

export function applySymbolFilters(input: {
  quantity: number;
  price: number;
  filters: SymbolFilters;
}): { ok: boolean; quantity: number; price: number; notional: number; reasons: string[] } {
  const reasons: string[] = [];
  const price = roundToStep(input.price, input.filters.tickSize);
  let quantity = roundToStep(input.quantity, input.filters.stepSize);
  if (quantity < input.filters.minQty) reasons.push("MIN_QTY");
  if (quantity > input.filters.maxQty) reasons.push("MAX_QTY");
  const notional = quantity * price;
  if (notional + 1e-12 < input.filters.minNotional) reasons.push("MIN_NOTIONAL");
  if (price <= 0 || quantity <= 0) reasons.push("INVALID_FILTERED_SIZE");
  return { ok: reasons.length === 0, quantity, price, notional, reasons };
}
