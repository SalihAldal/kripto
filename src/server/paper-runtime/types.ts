export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT";
export type OrderState =
  | "CREATED"
  | "SUBMITTED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "REJECTED"
  | "EXPIRED"
  | "PENDING"
  | "UNKNOWN";
export type PositionState = "PLANNED" | "OPENING" | "OPEN" | "REDUCING" | "CLOSING" | "CLOSED" | "ERROR";
export type ExitReason =
  | "EMERGENCY"
  | "HARD_STOP"
  | "RISK_EXIT"
  | "TAKE_PROFIT"
  | "PARTIAL_TP"
  | "MOMENTUM_EXIT"
  | "TRAILING"
  | "TIME_EXIT";
export type KillSwitch =
  | "STALE_DATA"
  | "WS_DEGRADED"
  | "REDIS_DOWN"
  | "DB_DOWN"
  | "BTC_SHOCK"
  | "DAILY_LOSS"
  | "DRAWDOWN"
  | "CONSECUTIVE_LOSS"
  | "RATE_LIMIT_429"
  | "IP_BAN_418";

export type BookLevel = { price: number; quantity: number };

export type SymbolFilters = {
  tickSize: number;
  stepSize: number;
  minQty: number;
  maxQty: number;
  minNotional: number;
};

export type FillResult = {
  status: OrderState;
  requestedQty: number;
  filledQty: number;
  remainingQty: number;
  avgPrice: number;
  notional: number;
  fee: number;
  feeRate: number;
  spreadCostPct: number;
  slippagePct: number;
  latencyMs: number;
  rejectReason: string | null;
};

export type PaperIntent = {
  intentId: string;
  executionIntentId: string;
  candidateId: string;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  quoteNotional?: number;
  limitPrice?: number;
  signalPrice: number;
  signalAt: number;
  lane: string;
  score: number;
  rank?: number | null;
  stopPct: number;
  takeProfitPct: number;
};

export type PaperPosition = {
  positionId: string;
  candidateId: string;
  executionIntentId: string;
  executionReference: string;
  symbol: string;
  lane: string;
  score: number;
  state: PositionState;
  qty: number;
  avgEntry: number;
  entryFee: number;
  entrySpreadPct: number;
  entrySlippagePct: number;
  openedAt: number;
  stopPrice: number;
  takeProfitPrice: number;
  trailPct: number;
  highSinceEntry: number;
  remainingQty: number;
  realizedGross: number;
  realizedFees: number;
  realizedNet: number;
  exitReason: ExitReason | null;
  closedAt: number | null;
  exitLock: boolean;
};

export type HealthSnapshot = {
  wsStatus: "UP" | "DEGRADED" | "FAILED";
  redisOk: boolean;
  dbOk: boolean;
  dataAgeMs: number;
  btcReturn1m: number;
  rateLimit429: boolean;
  ipBan418: boolean;
};
