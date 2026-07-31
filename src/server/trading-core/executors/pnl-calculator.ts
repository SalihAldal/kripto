import type { ManagedPosition, PositionSide } from "@/src/server/trading-core/executors/position-types";

export function calculatePnl(side: PositionSide, entryPrice: number, currentPrice: number, quantity: number) {
  const direction = side === "BUY" ? 1 : -1;
  return Number(((currentPrice - entryPrice) * quantity * direction).toFixed(8));
}

export function calculatePnlPercent(side: PositionSide, entryPrice: number, currentPrice: number) {
  if (entryPrice <= 0) return 0;
  const direction = side === "BUY" ? 1 : -1;
  return Number((((currentPrice - entryPrice) / entryPrice) * 100 * direction).toFixed(4));
}

export function refreshPositionPnl(position: ManagedPosition, price: number): ManagedPosition {
  return {
    ...position,
    currentPrice: price,
    unrealizedPnl: calculatePnl(position.side, position.entryPrice, price, position.remainingQuantity),
    unrealizedPnlPercent: calculatePnlPercent(position.side, position.entryPrice, price),
    updatedAt: new Date().toISOString(),
  };
}
