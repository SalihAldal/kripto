export type PositionSide = "BUY" | "SELL";
export type PositionStatus = "OPEN" | "PARTIALLY_CLOSED" | "CLOSED";
export type PositionExitReason = "TAKE_PROFIT" | "STOP_LOSS" | "TRAILING_STOP" | "MANUAL" | "BREAKEVEN";

export type PartialTakeProfitTarget = {
  id: string;
  price: number;
  quantityPercent: number;
  filled: boolean;
  filledAt?: string;
};

export type TrailingStopState = {
  enabled: boolean;
  activationPercent: number;
  distancePercent: number;
  activatedAt?: string;
  peakPrice?: number;
  troughPrice?: number;
};

export type ManagedPosition = {
  id: string;
  botId: string;
  symbol: string;
  side: PositionSide;
  status: PositionStatus;
  quantity: number;
  remainingQuantity: number;
  entryPrice: number;
  currentPrice: number;
  openedAt: string;
  updatedAt: string;
  closedAt?: string;
  stopLoss?: number;
  takeProfit?: number;
  breakevenPrice?: number;
  autoBreakevenEnabled: boolean;
  trailingStop: TrailingStopState;
  partialTakeProfits: PartialTakeProfitTarget[];
  realizedPnl: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  score: number;
  confidence: number;
  metadata?: Record<string, unknown>;
};

export type OpenPositionRequest = {
  botId?: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  score: number;
  confidence: number;
  metadata?: Record<string, unknown>;
};

export type PositionManagerConfig = {
  maxOpenPositions: number;
  allowHedge: boolean;
  allowDuplicateSymbol: boolean;
  defaultStopLossPercent: number;
  defaultTakeProfitPercent: number;
  trailingEnabled: boolean;
  trailingActivationPercent: number;
  trailingDistancePercent: number;
  autoBreakevenEnabled: boolean;
  breakevenActivationPercent: number;
  partialTakeProfitEnabled: boolean;
  partialTakeProfitPercent: number;
  partialTakeProfitQuantityPercent: number;
};

export type PositionOpenResult = {
  allowed: boolean;
  position?: ManagedPosition;
  reason?: string;
};

export type PositionUpdateResult = {
  position: ManagedPosition;
  events: string[];
  closed?: {
    reason: PositionExitReason;
    price: number;
    closedAt: string;
  };
};
