import type { SimulatedOrderType } from "@prisma/client";
import type { OrderBookLevel } from "@/src/types/exchange";

export type SupportedExchange = "BINANCE_TR" | "BINANCE" | "BYBIT" | "OKX" | "KUCOIN" | "GATE" | "MEXC";

export type ActiveOrderType = "MARKET";
export type FutureOrderType = "LIMIT" | "STOP_LIMIT" | "STOP_MARKET";

export type SimulatedFill = {
  fillIndex: number;
  quantity: number;
  price: number;
  notional: number;
  fee: number;
  slippagePct: number;
  filledAt: string;
};

export type LatencyBreakdown = {
  networkMs: number;
  exchangeMs: number;
  queueMs: number;
  matchingMs: number;
  totalMs: number;
};

export type ExecutionQualityBreakdown = {
  overallScore: number;
  slippageScore: number;
  liquidityScore: number;
  spreadScore: number;
  fillScore: number;
  latencyScore: number;
};

export type SlippageBreakdown = {
  slippagePct: number;
  slippageBps: number;
  bestPrice: number;
  worstPrice: number;
  midPrice: number;
  spreadPct: number;
  impactPct: number;
};

export type ExecutionComparisonResult = {
  requestedPrice: number;
  executedPrice: number;
  bestPossiblePrice: number;
  worstPossiblePrice: number;
  slippagePct: number;
  fees: number;
  executionTimeMs: number;
  improvementBps: number;
};

export type MarketSimulationInput = {
  executionId?: string;
  executionIntentId?: string;
  userId?: string;
  candidateId?: string;
  symbol: string;
  lane?: string;
  side: "BUY" | "SELL";
  quantity: number;
  quoteOrderQty?: number;
  priceHint: number;
  decisionAt?: string;
  riskAllowedAt?: string;
  executionVenue?: string;
  marketDataVenue?: string;
  orderType?: ActiveOrderType | FutureOrderType;
  exchange?: SupportedExchange;
  quoteAsset: string;
  baseAsset: string;
  bidDepth?: number;
  askDepth?: number;
  spreadPercent?: number;
  atr?: number;
  volatilityPercent?: number;
  volumeQuote?: number;
  aggressiveBuyPct?: number;
  aggressiveSellPct?: number;
};

export type MarketSimulationResult = {
  ok: boolean;
  rejectReason?: string;
  simulationId: string;
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: SimulatedOrderType;
  requestedQty: number;
  executedQty: number;
  remainingQty: number;
  requestedPrice: number;
  avgFillPrice: number;
  fillCount: number;
  fills: SimulatedFill[];
  totalFees: number;
  totalSlippagePct: number;
  executionDurationMs: number;
  latency: LatencyBreakdown;
  quality: ExecutionQualityBreakdown;
  slippage: SlippageBreakdown;
  comparison: ExecutionComparisonResult;
  status: "FILLED" | "PARTIALLY_FILLED" | "REJECTED";
  metadata?: Record<string, unknown>;
};

export type ExchangeSimulatorJobPayload =
  | { type: "EXECUTION_SIMULATE"; limit?: number }
  | { type: "EXECUTION_REPLAY"; simulationId?: string; limit?: number }
  | { type: "SLIPPAGE_CALCULATE"; periodHours?: number }
  | { type: "LATENCY_ANALYZE"; periodHours?: number }
  | { type: "FEE_CALCULATE"; periodHours?: number };

export type ExchangeSimulatorMetrics = {
  avgSlippagePct: number;
  worstSlippagePct: number;
  bestSlippagePct: number;
  avgFee: number;
  avgExecutionDelayMs: number;
  avgFillCount: number;
  executionSuccess: number;
  executionFailure: number;
};

export type OrderBookWalkInput = {
  side: "BUY" | "SELL";
  quantity: number;
  levels: OrderBookLevel[];
  referencePrice: number;
  impactSlippageBpsPerLevel?: number;
};

export type OrderBookWalkResult = {
  fills: Array<{ quantity: number; price: number }>;
  executedQty: number;
  remainingQty: number;
  avgFillPrice: number;
  bestPrice: number;
  worstPrice: number;
};

export const ACTIVE_ORDER_TYPE: ActiveOrderType = "MARKET";
export const DEFAULT_EXCHANGE: SupportedExchange = "BINANCE_TR";
