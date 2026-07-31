import { randomUUID } from "node:crypto";
import type { PaperFill, PaperOrderRequest, PaperSide } from "@/src/server/trading-core/paper/live-paper-types";

function round(value: number) {
  return Number(value.toFixed(8));
}

export class PaperExecutionSimulator {
  constructor(
    private readonly takerFeeRate = 0.001,
    private readonly defaultSlippageBps = 5,
  ) {}

  simulateOpen(request: PaperOrderRequest, markPrice: number): PaperFill {
    const leverage = Math.max(1, Math.min(125, Math.floor(request.leverage ?? 1)));
    const slippageBps = Math.max(0, request.slippageBps ?? this.defaultSlippageBps);
    const price = this.applySlippage(markPrice, request.side, slippageBps);
    const quantity = Math.max(0, request.quantity);
    const notional = quantity * price;
    const margin = notional / leverage;
    const fee = notional * this.takerFeeRate;

    return {
      orderId: `paper-${randomUUID()}`,
      positionId: randomUUID(),
      symbol: request.symbol.toUpperCase(),
      side: request.side,
      status: "FILLED",
      price: round(price),
      quantity: round(quantity),
      notional: round(notional),
      margin: round(margin),
      fee: round(fee),
      leverage,
      slippageBps,
      createdAt: new Date().toISOString(),
    };
  }

  fee(notional: number) {
    return round(Math.abs(notional) * this.takerFeeRate);
  }

  applySlippage(price: number, side: PaperSide, slippageBps = this.defaultSlippageBps) {
    const delta = price * (slippageBps / 10_000);
    return round(side === "BUY" ? price + delta : price - delta);
  }
}
