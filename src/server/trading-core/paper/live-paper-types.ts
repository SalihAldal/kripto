import type { MarketTick } from "@/src/server/trading-core/core/types";

export type PaperMode = "test" | "live-market";
export type PaperSide = "BUY" | "SELL";
export type PaperCloseReason = "TAKE_PROFIT" | "STOP_LOSS" | "MANUAL" | "LIQUIDATION";

export type PaperBalances = Record<string, number>;

export type PaperOrderRequest = {
  symbol: string;
  side: PaperSide;
  quantity: number;
  markPrice?: number;
  leverage?: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
  slippageBps?: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type PaperFill = {
  orderId: string;
  positionId: string;
  symbol: string;
  side: PaperSide;
  status: "FILLED" | "REJECTED";
  price: number;
  quantity: number;
  notional: number;
  margin: number;
  fee: number;
  leverage: number;
  slippageBps: number;
  createdAt: string;
};

export type PaperPosition = {
  id: string;
  symbol: string;
  side: PaperSide;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  notional: number;
  margin: number;
  leverage: number;
  feePaid: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  liquidationPrice?: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  openedAt: string;
  metadata?: Record<string, unknown>;
};

export type PaperClosedPosition = PaperPosition & {
  exitPrice: number;
  realizedPnl: number;
  closeFee: number;
  closedAt: string;
  reason: PaperCloseReason;
};

export type PaperAccountState = {
  balances: PaperBalances;
  equity: number;
  realizedPnl: number;
  updatedAt: string;
};

export type PaperPositionUpdate = {
  position: PaperPosition;
  tick: MarketTick;
  closed?: PaperClosedPosition;
};

export type LivePaperEngineOptions = {
  mode?: PaperMode;
  symbols?: string[];
  initialBalances?: PaperBalances;
  takerFeeRate?: number;
  makerFeeRate?: number;
  slippageBps?: number;
  defaultTakeProfitPercent?: number;
  defaultStopLossPercent?: number;
};
