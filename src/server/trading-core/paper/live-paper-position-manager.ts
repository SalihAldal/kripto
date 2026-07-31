import { tradingConfig } from "@/src/server/trading-core/config";
import type { MarketTick } from "@/src/server/trading-core/core/types";
import type { PaperCloseReason, PaperClosedPosition, PaperFill, PaperOrderRequest, PaperPosition, PaperPositionUpdate } from "@/src/server/trading-core/paper/live-paper-types";
import { PaperExecutionSimulator } from "@/src/server/trading-core/paper/paper-execution-simulator";

function round(value: number) {
  return Number(value.toFixed(8));
}

function sideDirection(side: "BUY" | "SELL") {
  return side === "BUY" ? 1 : -1;
}

export class LivePaperPositionManager {
  private readonly positions = new Map<string, PaperPosition>();

  constructor(
    private readonly simulator: PaperExecutionSimulator,
    private readonly defaultTakeProfitPercent = tradingConfig.getGlobal("takeProfitPercent"),
    private readonly defaultStopLossPercent = tradingConfig.getGlobal("stopLossPercent"),
  ) {}

  open(fill: PaperFill, request: PaperOrderRequest) {
    const direction = sideDirection(fill.side);
    const takeProfitPercent = request.takeProfitPercent ?? this.defaultTakeProfitPercent;
    const stopLossPercent = request.stopLossPercent ?? this.defaultStopLossPercent;
    const position: PaperPosition = {
      id: fill.positionId,
      symbol: fill.symbol,
      side: fill.side,
      quantity: fill.quantity,
      entryPrice: fill.price,
      markPrice: fill.price,
      notional: fill.notional,
      margin: fill.margin,
      leverage: fill.leverage,
      feePaid: fill.fee,
      takeProfitPrice: round(fill.price * (1 + direction * (takeProfitPercent / 100))),
      stopLossPrice: round(fill.price * (1 - direction * (stopLossPercent / 100))),
      liquidationPrice: round(fill.price * (1 - direction * (1 / fill.leverage) * 0.9)),
      unrealizedPnl: 0,
      unrealizedPnlPercent: 0,
      openedAt: fill.createdAt,
      metadata: request.metadata,
    };
    this.positions.set(position.id, position);
    return position;
  }

  updateTick(tick: MarketTick): PaperPositionUpdate[] {
    const updates: PaperPositionUpdate[] = [];
    for (const position of this.snapshot().filter((item) => item.symbol === tick.symbol.toUpperCase())) {
      const next = this.mark(position, tick.price);
      const reason = this.resolveCloseReason(next);
      if (reason) {
        const closed = this.close(next.id, tick.price, reason);
        if (closed) updates.push({ position: next, tick, closed });
      } else {
        this.positions.set(next.id, next);
        updates.push({ position: next, tick });
      }
    }
    return updates;
  }

  close(positionId: string, markPrice: number, reason: PaperCloseReason = "MANUAL"): PaperClosedPosition | null {
    const position = this.positions.get(positionId);
    if (!position) return null;
    const marked = this.mark(position, markPrice);
    const exitPrice = this.simulator.applySlippage(markPrice, marked.side === "BUY" ? "SELL" : "BUY");
    const direction = sideDirection(marked.side);
    const grossPnl = (exitPrice - marked.entryPrice) * marked.quantity * direction;
    const closeFee = this.simulator.fee(exitPrice * marked.quantity);
    const closed: PaperClosedPosition = {
      ...marked,
      exitPrice,
      realizedPnl: round(grossPnl - marked.feePaid - closeFee),
      closeFee,
      closedAt: new Date().toISOString(),
      reason,
    };
    this.positions.delete(positionId);
    return closed;
  }

  snapshot() {
    return Array.from(this.positions.values());
  }

  reset() {
    this.positions.clear();
  }

  private mark(position: PaperPosition, markPrice: number): PaperPosition {
    const direction = sideDirection(position.side);
    const unrealizedPnl = (markPrice - position.entryPrice) * position.quantity * direction;
    return {
      ...position,
      markPrice: round(markPrice),
      unrealizedPnl: round(unrealizedPnl),
      unrealizedPnlPercent: round((unrealizedPnl / Math.max(position.margin, 1e-8)) * 100),
    };
  }

  private resolveCloseReason(position: PaperPosition): PaperCloseReason | null {
    if (position.side === "BUY") {
      if (position.takeProfitPrice && position.markPrice >= position.takeProfitPrice) return "TAKE_PROFIT";
      if (position.stopLossPrice && position.markPrice <= position.stopLossPrice) return "STOP_LOSS";
      if (position.liquidationPrice && position.markPrice <= position.liquidationPrice) return "LIQUIDATION";
      return null;
    }
    if (position.takeProfitPrice && position.markPrice <= position.takeProfitPrice) return "TAKE_PROFIT";
    if (position.stopLossPrice && position.markPrice >= position.stopLossPrice) return "STOP_LOSS";
    if (position.liquidationPrice && position.markPrice >= position.liquidationPrice) return "LIQUIDATION";
    return null;
  }
}
