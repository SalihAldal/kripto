export type ProtectionLevel = "OK" | "WARN" | "BLOCKED" | "EMERGENCY";

export type ProtectionViolationType =
  | "MAX_DAILY_LOSS"
  | "MAX_DRAWDOWN"
  | "DUPLICATE_ORDER"
  | "API_SPAM"
  | "LIQUIDATION_RISK"
  | "WEBSOCKET_DISCONNECT"
  | "STUCK_POSITION"
  | "ABNORMAL_VOLATILITY"
  | "CLOSE_ONLY"
  | "CIRCUIT_BREAKER";

export type ProtectionViolation = {
  type: ProtectionViolationType;
  level: ProtectionLevel;
  message: string;
  symbol?: string;
  value?: number;
  threshold?: number;
  createdAt: string;
};

export type ProtectionState = {
  emergencyStop: boolean;
  closeOnlyMode: boolean;
  dailyLossPercent: number;
  maxDrawdownPercent: number;
  peakEquity: number;
  currentEquity: number;
  duplicateOrderBlocks: number;
  apiSpamBlocks: number;
  websocketDisconnects: number;
  stuckPositions: number;
  abnormalVolatilityEvents: number;
  violations: ProtectionViolation[];
  updatedAt: string;
};

export type ProtectionIntent = {
  symbol: string;
  side: "BUY" | "SELL";
  idempotencyKey: string;
  reduceOnly?: boolean;
  currentPrice?: number;
  entryPrice?: number;
  liquidationPrice?: number;
  volatilityPercent?: number;
};

export type ProtectionDecision = {
  allowed: boolean;
  level: ProtectionLevel;
  closeOnlyMode: boolean;
  reasons: string[];
  violations: ProtectionViolation[];
};
