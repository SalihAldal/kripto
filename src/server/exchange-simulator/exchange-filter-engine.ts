import { validateSymbolFilters } from "@/services/binance.service";
import type { MarketSimulationInput } from "@/src/server/exchange-simulator/exchange-simulator.types";

export type FilterValidationResult = {
  ok: boolean;
  reasons: string[];
  adjustedQuantity: number;
  adjustedPrice: number;
  minNotional?: number;
};

export async function applyExchangeFilters(input: {
  symbol: string;
  quantity: number;
  price: number;
}): Promise<FilterValidationResult> {
  const result = await validateSymbolFilters(input.symbol, input.quantity, input.price);
  return {
    ok: result.ok,
    reasons: result.reasons,
    adjustedQuantity: result.adjustedQuantity ?? input.quantity,
    adjustedPrice: result.adjustedPrice ?? input.price,
    minNotional: result.minNotional,
  };
}

export async function validateSimulationFilters(input: MarketSimulationInput, price: number) {
  const filter = await applyExchangeFilters({
    symbol: input.symbol,
    quantity: input.quantity,
    price,
  });
  if (!filter.ok) {
    return { ok: false as const, rejectReason: filter.reasons.join(", "), filter };
  }
  if (filter.minNotional && filter.adjustedQuantity * price < filter.minNotional) {
    return { ok: false as const, rejectReason: "Notional below minimum", filter };
  }
  return { ok: true as const, filter };
}
