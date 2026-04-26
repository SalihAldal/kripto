import type { OrderType } from "@/src/types/exchange";
import type { AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";

export type TradingMode = "dry-run" | "paper" | "live";

export type ExecuteTradeInput = {
  requestedSymbol?: string;
  requestedQuantity?: number;
  requestedQuoteAmountTry?: number;
  requestedQuoteAmountUsdt?: number;
  requestedMaxCoins?: number;
  leverageMultiplier?: number;
  requestedOrderType?: OrderType;
  requestedLimitPrice?: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
  maxDurationSec?: number;
  allowShort?: boolean;
  userId?: string;
};

export type SelectedTradeOpportunity = {
  candidate: ScannerCandidate;
  ai: AIConsensusResult;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  entryType: OrderType;
  entryPrice?: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  maxDurationSec: number;
};

export type ExecutionStepStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";

export type ExecutionStatusEvent = {
  executionId: string;
  symbol?: string;
  stage: string;
  status: ExecutionStepStatus;
  message: string;
  level?: "INFO" | "WARN" | "ERROR" | "TRADE" | "SIGNAL";
  context?: Record<string, unknown>;
  createdAt: string;
};

export type ExecutionResult = {
  executionId: string;
  mode: TradingMode;
  opened: boolean;
  rejected: boolean;
  rejectReason?: string;
  symbol?: string;
  decision?: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
  orderId?: string;
  positionId?: string;
  tradeSignalId?: string;
  scannerResultId?: string;
  monitorActive?: boolean;
  details?: Record<string, unknown>;
};

export type PositionCloseReason =
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "TIMEOUT"
  | "EARLY_PROFIT_PROTECT"
  | "TRAILING_PROFIT_LOCK"
  | "MOMENTUM_FADE"
  | "REVERSE_SIGNAL"
  | "MANUAL_CLOSE"
  | "EMERGENCY_STOP"
  | "RISK_BREAKER"
  | "CANCELED";
