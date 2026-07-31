import { randomUUID } from "node:crypto";
import type { SimulatedFill } from "@/src/server/exchange-simulator/exchange-simulator.types";

function round8(value: number) {
  return Number(value.toFixed(8));
}

export function splitIntoPartialFills(input: {
  side: "BUY" | "SELL";
  fills: Array<{ quantity: number; price: number }>;
  referencePrice: number;
  startTimeMs?: number;
  latencyPerFillMs?: number;
}): SimulatedFill[] {
  const start = input.startTimeMs ?? Date.now();
  const perFill = input.latencyPerFillMs ?? 18;
  return input.fills.map((fill, index) => {
    const slippagePct =
      input.referencePrice > 0
        ? round8(
            input.side === "BUY"
              ? ((fill.price - input.referencePrice) / input.referencePrice) * 100
              : ((input.referencePrice - fill.price) / input.referencePrice) * 100,
          )
        : 0;
    return {
      fillIndex: index + 1,
      quantity: fill.quantity,
      price: fill.price,
      notional: round8(fill.quantity * fill.price),
      fee: 0,
      slippagePct: Math.max(0, slippagePct),
      filledAt: new Date(start + perFill * (index + 1)).toISOString(),
    };
  });
}

export function averageFillPrice(fills: SimulatedFill[]) {
  const totalQty = fills.reduce((sum, fill) => sum + fill.quantity, 0);
  if (totalQty <= 0) return 0;
  const notional = fills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0);
  return round8(notional / totalQty);
}

export function createRejectedFill(_reason: string): SimulatedFill[] {
  return [];
}

export function newSimulationOrderId(prefix = "sim") {
  return `${prefix}-${randomUUID()}`;
}
