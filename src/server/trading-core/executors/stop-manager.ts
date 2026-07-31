import { calculatePnl, refreshPositionPnl } from "@/src/server/trading-core/executors/pnl-calculator";
import type { ManagedPosition, PositionUpdateResult } from "@/src/server/trading-core/executors/position-types";

function reachedTakeProfit(position: ManagedPosition) {
  if (!position.takeProfit) return false;
  return position.side === "BUY" ? position.currentPrice >= position.takeProfit : position.currentPrice <= position.takeProfit;
}

function reachedStop(position: ManagedPosition) {
  if (!position.stopLoss) return false;
  return position.side === "BUY" ? position.currentPrice <= position.stopLoss : position.currentPrice >= position.stopLoss;
}

export class StopManager {
  update(position: ManagedPosition, price: number): PositionUpdateResult {
    let next = refreshPositionPnl(position, price);
    const events: string[] = [];

    next = this.updateTrailingStop(next, events);
    next = this.updateBreakeven(next, events);
    next = this.fillPartialTakeProfits(next, events);

    if (reachedTakeProfit(next)) {
      return this.close(next, "TAKE_PROFIT", events);
    }
    if (reachedStop(next)) {
      return this.close(next, next.stopLoss === next.breakevenPrice ? "BREAKEVEN" : "STOP_LOSS", events);
    }

    return { position: next, events };
  }

  private updateTrailingStop(position: ManagedPosition, events: string[]) {
    if (!position.trailingStop.enabled) return position;
    const activationHit = position.unrealizedPnlPercent >= position.trailingStop.activationPercent;
    if (!activationHit) return position;

    const current = position.currentPrice;
    const trailing = { ...position.trailingStop };
    if (!trailing.activatedAt) {
      trailing.activatedAt = new Date().toISOString();
      events.push("TRAILING_ACTIVATED");
    }

    if (position.side === "BUY") {
      trailing.peakPrice = Math.max(trailing.peakPrice ?? current, current);
      const stop = trailing.peakPrice * (1 - trailing.distancePercent / 100);
      return { ...position, trailingStop: trailing, stopLoss: Math.max(position.stopLoss ?? 0, Number(stop.toFixed(8))) };
    }

    trailing.troughPrice = Math.min(trailing.troughPrice ?? current, current);
    const stop = trailing.troughPrice * (1 + trailing.distancePercent / 100);
    const currentStop = position.stopLoss ?? Number.POSITIVE_INFINITY;
    return { ...position, trailingStop: trailing, stopLoss: Math.min(currentStop, Number(stop.toFixed(8))) };
  }

  private updateBreakeven(position: ManagedPosition, events: string[]) {
    if (!position.autoBreakevenEnabled || position.breakevenPrice) return position;
    if (position.unrealizedPnlPercent < 0.8) return position;
    events.push("BREAKEVEN_UPDATED");
    return {
      ...position,
      breakevenPrice: position.entryPrice,
      stopLoss: position.entryPrice,
    };
  }

  private fillPartialTakeProfits(position: ManagedPosition, events: string[]) {
    let next = position;
    for (const target of next.partialTakeProfits) {
      if (target.filled) continue;
      const hit = next.side === "BUY" ? next.currentPrice >= target.price : next.currentPrice <= target.price;
      if (!hit) continue;
      const closeQty = next.quantity * (target.quantityPercent / 100);
      const realized = calculatePnl(next.side, next.entryPrice, next.currentPrice, closeQty);
      next = {
        ...next,
        status: "PARTIALLY_CLOSED",
        remainingQuantity: Math.max(0, Number((next.remainingQuantity - closeQty).toFixed(8))),
        realizedPnl: Number((next.realizedPnl + realized).toFixed(8)),
        partialTakeProfits: next.partialTakeProfits.map((item) =>
          item.id === target.id ? { ...item, filled: true, filledAt: new Date().toISOString() } : item,
        ),
      };
      events.push(`PARTIAL_TP_FILLED:${target.id}`);
    }
    return next;
  }

  private close(position: ManagedPosition, reason: "TAKE_PROFIT" | "STOP_LOSS" | "TRAILING_STOP" | "BREAKEVEN", events: string[]): PositionUpdateResult {
    const closedAt = new Date().toISOString();
    const realized = calculatePnl(position.side, position.entryPrice, position.currentPrice, position.remainingQuantity);
    const closed = {
      ...position,
      status: "CLOSED" as const,
      remainingQuantity: 0,
      realizedPnl: Number((position.realizedPnl + realized).toFixed(8)),
      unrealizedPnl: 0,
      closedAt,
      updatedAt: closedAt,
    };
    events.push(`POSITION_CLOSED:${reason}`);
    return {
      position: closed,
      events,
      closed: {
        reason,
        price: position.currentPrice,
        closedAt,
      },
    };
  }
}
