import type { PositionSizingMode } from "@prisma/client";
import {
  ACTIVE_SIZING_MODE,
  FEE_DUST_RESERVE_PCT,
  type PositionSizingInput,
  type PositionSizingResult,
} from "@/src/server/execution-management/execution-management.types";

function clampQty(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(8));
}

export function resolvePositionSizing(input: PositionSizingInput): PositionSizingResult {
  const mode = input.mode ?? ACTIVE_SIZING_MODE;
  const price = Math.max(input.estimatedPrice, 0);

  if (input.hasManualSizing && input.requestedQuantity && input.requestedQuantity > 0) {
    return {
      mode,
      sizedQty: clampQty(input.requestedQuantity),
      utilizationPct: 0,
      availableQuote: input.availableQuote,
      availableBase: input.availableBase,
      metadata: { manual: true },
    };
  }

  if (mode === "ALL_IN") {
    if (input.side === "BUY") {
      const reserve = 1 - FEE_DUST_RESERVE_PCT;
      const quoteSpend = clampQty(input.availableQuote * reserve);
      const sizedQty = price > 0 ? clampQty(quoteSpend / price) : 0;
      return {
        mode,
        sizedQty,
        quoteSpend,
        utilizationPct: 100,
        availableQuote: input.availableQuote,
        availableBase: input.availableBase,
        metadata: { allInBuy: true, reservePct: FEE_DUST_RESERVE_PCT * 100 },
      };
    }
    const reserve = 1 - FEE_DUST_RESERVE_PCT;
    const sizedQty = clampQty(input.availableBase * reserve);
    return {
      mode,
      sizedQty,
      utilizationPct: 100,
      availableQuote: input.availableQuote,
      availableBase: input.availableBase,
      metadata: { allOutSell: true, reservePct: FEE_DUST_RESERVE_PCT * 100 },
    };
  }

  return {
    mode,
    sizedQty: clampQty(input.requestedQuantity ?? 0),
    utilizationPct: 0,
    availableQuote: input.availableQuote,
    availableBase: input.availableBase,
    metadata: { inactiveMode: mode },
  };
}

export function supportedSizingModes(): PositionSizingMode[] {
  return ["ALL_IN", "FIXED_AMOUNT", "FIXED_PERCENT", "VOLATILITY_BASED", "RISK_BASED", "KELLY", "EQUAL_WEIGHT"];
}
