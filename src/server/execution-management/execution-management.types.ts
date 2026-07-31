import type { PositionSizingMode } from "@prisma/client";

export type TradingExecutionMode = "live" | "paper" | "dry-run";

export type PositionSizingInput = {
  mode: PositionSizingMode;
  side: "BUY" | "SELL";
  quoteAsset: string;
  baseAsset: string;
  availableQuote: number;
  availableBase: number;
  estimatedPrice: number;
  requestedQuantity?: number;
  hasManualSizing?: boolean;
};

export type PositionSizingResult = {
  mode: PositionSizingMode;
  sizedQty: number;
  quoteSpend?: number;
  utilizationPct: number;
  availableQuote: number;
  availableBase: number;
  metadata?: Record<string, unknown>;
};

export type ExecutionValidationResult = {
  ok: boolean;
  reasons: string[];
  marketPrice: number;
  notional: number;
  adjustedQuantity: number;
  minNotional?: number;
  feesEstimate?: number;
  stages: Array<{ stage: string; passed: boolean; reasons: string[] }>;
};

export type UnifiedExecutionPlan = {
  ok: boolean;
  rejectReason?: string;
  quantity: number;
  quoteSpend?: number;
  validation: ExecutionValidationResult;
  sizing: PositionSizingResult;
};

export type PositionSnapshot = {
  positionId: string;
  symbol: string;
  quantity: number;
  averageEntry: number;
  realizedProfit: number;
  unrealizedProfit: number;
  currentValue: number;
  holdingDurationMin: number;
  highestPriceSinceEntry: number;
  lowestPriceSinceEntry: number;
};

export type ExecutionMgmtJobPayload =
  | { type: "EXECUTION_VALIDATE"; executionId?: string; limit?: number }
  | { type: "POSITION_SYNC"; userId?: string }
  | { type: "PORTFOLIO_SNAPSHOT"; userId?: string; mode?: string }
  | { type: "EXECUTION_REPLAY"; executionId?: string; limit?: number }
  | { type: "STATISTICS_AGGREGATE"; periodHours?: number };

export const ACTIVE_SIZING_MODE: PositionSizingMode = "ALL_IN";
export const FEE_DUST_RESERVE_PCT = 0.001;
