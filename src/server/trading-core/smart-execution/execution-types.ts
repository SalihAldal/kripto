export type SmartOrderSide = "BUY" | "SELL";
export type SmartOrderType = "MARKET" | "LIMIT";
export type SmartOrderStatus = "PLANNED" | "QUEUED" | "SUBMITTED" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "FAILED" | "STUCK";

export type ExchangeVenue = {
  name: "binance-futures" | "binance-spot" | "fallback-paper";
  enabled: boolean;
  priority: number;
  latencyMs: number;
  failureRate: number;
  takerFeeRate: number;
  makerFeeRate: number;
};

export type SmartOrderRequest = {
  symbol: string;
  side: SmartOrderSide;
  type: SmartOrderType;
  quantity: number;
  price?: number;
  maxSlippageBps: number;
  splitCount?: number;
  timeInForce?: "GTC" | "IOC" | "FOK";
  reduceOnly?: boolean;
  leverage?: number;
  clientOrderId?: string;
  metadata?: Record<string, unknown>;
};

export type SmartOrderSlice = {
  sliceId: string;
  symbol: string;
  side: SmartOrderSide;
  type: SmartOrderType;
  quantity: number;
  limitPrice?: number;
  venue: ExchangeVenue["name"];
  status: SmartOrderStatus;
};

export type SmartOrderPlan = {
  planId: string;
  request: SmartOrderRequest;
  selectedVenue: ExchangeVenue;
  slices: SmartOrderSlice[];
  expectedFee: number;
  maxSlippageBps: number;
  createdAt: string;
};

export type SmartOrderExecution = {
  planId: string;
  status: SmartOrderStatus;
  submitted: number;
  filled: number;
  canceled: number;
  failed: number;
  avgLatencyMs: number;
  reasons: string[];
  slices: SmartOrderSlice[];
  createdAt: string;
  updatedAt: string;
};
