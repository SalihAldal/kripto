import type { OrderBookLevel } from "@/src/types/exchange";
import type { OrderBookWalkInput, OrderBookWalkResult } from "@/src/server/exchange-simulator/exchange-simulator.types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round8(value: number) {
  return Number(value.toFixed(8));
}

export function walkOrderBook(input: OrderBookWalkInput): OrderBookWalkResult {
  const levels = input.levels.filter((level) => level.price > 0 && level.quantity > 0);
  const fills: Array<{ quantity: number; price: number }> = [];
  let remaining = Math.max(0, input.quantity);
  let bestPrice = input.referencePrice;
  let worstPrice = input.referencePrice;

  for (const level of levels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, level.quantity);
    if (take <= 0) continue;
    fills.push({ quantity: round8(take), price: level.price });
    remaining = round8(remaining - take);
    bestPrice = fills.length === 1 ? level.price : bestPrice;
    worstPrice = level.price;
  }

  const executedQty = round8(fills.reduce((sum, fill) => sum + fill.quantity, 0));
  const notional = fills.reduce((sum, fill) => sum + fill.quantity * fill.price, 0);
  const avgFillPrice = executedQty > 0 ? round8(notional / executedQty) : input.referencePrice;

  return {
    fills,
    executedQty,
    remainingQty: round8(Math.max(0, input.quantity - executedQty)),
    avgFillPrice,
    bestPrice: fills.length > 0 ? fills[0]!.price : input.referencePrice,
    worstPrice: fills.length > 0 ? worstPrice : input.referencePrice,
  };
}

export function computeDynamicSlippageBps(input: {
  side: "BUY" | "SELL";
  referencePrice: number;
  quantity: number;
  spreadPercent?: number;
  bidDepth?: number;
  askDepth?: number;
  atr?: number;
  volatilityPercent?: number;
  volumeQuote?: number;
  aggressiveBuyPct?: number;
  aggressiveSellPct?: number;
}) {
  const spreadBps = Math.max(0, (input.spreadPercent ?? 0.05) * 100);
  const depth = input.side === "BUY" ? input.askDepth ?? 0 : input.bidDepth ?? 0;
  const notional = input.referencePrice * input.quantity;
  const depthRatio = depth > 0 ? notional / depth : 1;
  const depthImpactBps = clamp(depthRatio * 12, 0, 80);
  const atrImpactBps = input.atr && input.referencePrice > 0 ? clamp((input.atr / input.referencePrice) * 10_000 * 0.15, 0, 35) : 0;
  const volImpactBps = clamp((input.volatilityPercent ?? 0) * 2.5, 0, 25);
  const aggression =
    input.side === "BUY"
      ? clamp((input.aggressiveBuyPct ?? 50) / 100, 0, 1)
      : clamp((input.aggressiveSellPct ?? 50) / 100, 0, 1);
  const aggressionBps = aggression * 6;
  return clamp(2 + spreadBps + depthImpactBps + atrImpactBps + volImpactBps + aggressionBps, 2, 120);
}

export function applyFallbackSlippage(price: number, side: "BUY" | "SELL", slippageBps: number) {
  const delta = price * (slippageBps / 10_000);
  return round8(side === "BUY" ? price + delta : price - delta);
}

export function buildSyntheticLevels(referencePrice: number, side: "BUY" | "SELL", quantity: number): OrderBookLevel[] {
  const step = referencePrice * 0.0003;
  const levels: OrderBookLevel[] = [];
  for (let i = 0; i < 8; i += 1) {
    const price = side === "BUY" ? referencePrice + step * i : referencePrice - step * i;
    levels.push({ price: round8(price), quantity: round8(quantity / 4) });
  }
  return levels;
}

export function computeSlippagePct(referencePrice: number, executedPrice: number, side: "BUY" | "SELL") {
  if (referencePrice <= 0) return 0;
  const raw = ((executedPrice - referencePrice) / referencePrice) * 100;
  return round8(side === "BUY" ? Math.max(0, raw) : Math.max(0, -raw));
}

export function computeSpreadPct(bid: number, ask: number) {
  if (bid <= 0 || ask <= 0) return 0;
  const mid = (bid + ask) / 2;
  return mid > 0 ? round8(((ask - bid) / mid) * 100) : 0;
}
