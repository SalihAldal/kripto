import { randomUUID } from "node:crypto";
import type { BacktestCostModel, BacktestTrade } from "@/src/server/trading-core/backtest/backtest-types";
import type { MarketCandle, TradeSide } from "@/src/server/trading-core/core/types";

type OpenSimPosition = {
  id: string;
  strategy: string;
  symbol: string;
  side: Exclude<TradeSide, "HOLD">;
  entryTime: number;
  entryPrice: number;
  quantity: number;
  notional: number;
  entryFee: number;
  entrySlippage: number;
};

export class ExecutionSimulator {
  private readonly open = new Map<string, OpenSimPosition>();

  constructor(
    private readonly costs: BacktestCostModel,
    private readonly takeProfitPercent: number,
    private readonly stopLossPercent: number,
  ) {}

  onSignal(input: {
    strategy: string;
    symbol: string;
    side: TradeSide;
    candle: MarketCandle;
    balance: number;
    leverage: number;
    positionSizePercent: number;
    allowShort: boolean;
  }): BacktestTrade[] {
    const key = this.key(input.strategy, input.symbol);
    const current = this.open.get(key);
    const trades: BacktestTrade[] = [];
    if (current) {
      const oppositeSide =
        (current.side === "BUY" && input.side === "SELL") ||
        (current.side === "SELL" && input.side === "BUY");
      const exit = this.tryExit(current, input.candle, oppositeSide ? "reverse" : "same");
      if (exit) {
        trades.push(exit);
        this.open.delete(key);
      }
    }
    if (!this.open.has(key) && (input.side === "BUY" || (input.allowShort && input.side === "SELL"))) {
      this.open.set(
        key,
        this.openPosition({
          strategy: input.strategy,
          symbol: input.symbol,
          side: input.side,
          candle: input.candle,
          balance: input.balance,
          leverage: input.leverage,
          positionSizePercent: input.positionSizePercent,
        }),
      );
    }
    return trades;
  }

  closeAll(candleBySymbol: Map<string, MarketCandle>) {
    const trades: BacktestTrade[] = [];
    for (const [key, position] of this.open.entries()) {
      const candle = candleBySymbol.get(position.symbol);
      if (!candle) continue;
      trades.push(this.close(position, candle.close, candle.closeTime, "END_OF_DATA"));
      this.open.delete(key);
    }
    return trades;
  }

  private openPosition(input: {
    strategy: string;
    symbol: string;
    side: Exclude<TradeSide, "HOLD">;
    candle: MarketCandle;
    balance: number;
    leverage: number;
    positionSizePercent: number;
  }): OpenSimPosition {
    const notional = input.balance * (input.positionSizePercent / 100) * input.leverage;
    const rawEntry = input.candle.close;
    const slippage = this.slippage(rawEntry, input.side);
    const entryPrice = rawEntry + slippage;
    const quantity = notional / entryPrice;
    return {
      id: randomUUID(),
      strategy: input.strategy,
      symbol: input.symbol,
      side: input.side,
      entryTime: input.candle.closeTime + this.costs.latencyMs,
      entryPrice,
      quantity,
      notional,
      entryFee: notional * this.costs.takerFeeRate,
      entrySlippage: Math.abs(slippage * quantity),
    };
  }

  private tryExit(position: OpenSimPosition, candle: MarketCandle, mode: "same" | "reverse") {
    const direction = position.side === "BUY" ? 1 : -1;
    const highReturn = ((candle.high - position.entryPrice) / position.entryPrice) * 100 * direction;
    const lowReturn = ((candle.low - position.entryPrice) / position.entryPrice) * 100 * direction;
    if (highReturn >= this.takeProfitPercent) {
      const price = position.entryPrice * (1 + (this.takeProfitPercent / 100) * direction);
      return this.close(position, price, candle.closeTime, "TAKE_PROFIT");
    }
    if (lowReturn <= -this.stopLossPercent) {
      const price = position.entryPrice * (1 - (this.stopLossPercent / 100) * direction);
      return this.close(position, price, candle.closeTime, "STOP_LOSS");
    }
    if (mode === "reverse") return this.close(position, candle.close, candle.closeTime, "REVERSE_SIGNAL");
    return null;
  }

  private close(position: OpenSimPosition, rawExitPrice: number, exitTime: number, exitReason: BacktestTrade["exitReason"]): BacktestTrade {
    const exitSlippage = this.slippage(rawExitPrice, position.side === "BUY" ? "SELL" : "BUY");
    const exitPrice = rawExitPrice + exitSlippage;
    const direction = position.side === "BUY" ? 1 : -1;
    const grossPnl = (exitPrice - position.entryPrice) * position.quantity * direction;
    const exitFee = Math.abs(exitPrice * position.quantity) * this.costs.takerFeeRate;
    const slippageCost = position.entrySlippage + Math.abs(exitSlippage * position.quantity);
    const fee = position.entryFee + exitFee;
    // Slippage is already embedded in entry/exit prices; subtracting it again would understate PnL.
    const netPnl = grossPnl - fee;
    return {
      id: position.id,
      strategy: position.strategy,
      symbol: position.symbol,
      side: position.side,
      entryTime: position.entryTime,
      exitTime: exitTime + this.costs.latencyMs,
      entryPrice: Number(position.entryPrice.toFixed(8)),
      exitPrice: Number(exitPrice.toFixed(8)),
      quantity: Number(position.quantity.toFixed(8)),
      notional: Number(position.notional.toFixed(8)),
      fee: Number(fee.toFixed(8)),
      slippage: Number(slippageCost.toFixed(8)),
      grossPnl: Number(grossPnl.toFixed(8)),
      netPnl: Number(netPnl.toFixed(8)),
      returnPercent: Number(((netPnl / position.notional) * 100).toFixed(4)),
      exitReason,
    };
  }

  private slippage(price: number, side: Exclude<TradeSide, "HOLD">) {
    const amount = price * (this.costs.slippageBps / 10_000);
    return side === "BUY" ? amount : -amount;
  }

  private key(strategy: string, symbol: string) {
    return `${strategy}:${symbol}`;
  }
}
