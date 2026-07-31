import type { SafetyValidationStage, SafetyDecisionOutcome, EmergencyActionType, ExecutionSafetyJobType } from "@prisma/client";

export type TradingSafetyMode = "live" | "paper" | "dry-run";

export type SafetyValidationStageResult = {
  stage: SafetyValidationStage;
  passed: boolean;
  reasons: string[];
  metadata?: Record<string, unknown>;
};

export type PreTradeSafetyInput = {
  executionId: string;
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  mode: TradingSafetyMode;
  quantity: number;
  priceHint: number;
  quoteAsset: string;
  baseAsset: string;
  quoteSpend?: number;
  openPositionCount: number;
  allowMultipleOpenPositions: boolean;
  orderType?: string;
  idempotencyKey?: string;
  spreadPercent?: number;
  volatilityPercent?: number;
  atr?: number;
  bidDepth?: number;
  askDepth?: number;
};

export type PreTradeSafetyResult = {
  passed: boolean;
  rejectReason?: string;
  safetyId: string;
  safetyScore: number;
  exchangeHealthScore: number;
  orderConfidence: number;
  validationQuality: number;
  executionReadiness: number;
  stages: SafetyValidationStageResult[];
  blockedBy?: string;
  metadata?: Record<string, unknown>;
};

export type SafetyScores = {
  safetyScore: number;
  exchangeHealthScore: number;
  orderConfidence: number;
  validationQuality: number;
  executionReadiness: number;
};

export type RecoveryAction = "RETRY" | "RESUME" | "ROLLBACK" | "CANCEL" | "STATE_RECOVERY" | "ORDER_RECOVERY" | "POSITION_RECOVERY";

export type ExecutionSafetyJobPayload =
  | { type: "EXECUTION_VALIDATE"; limit?: number }
  | { type: "EXCHANGE_HEALTH_MONITOR" }
  | { type: "API_HEALTH_CHECK" }
  | { type: "RECOVERY_PROCESS"; executionId?: string }
  | { type: "EMERGENCY_MONITOR" }
  | { type: "DUPLICATE_DETECT"; windowMinutes?: number };

export type EmergencyScope = "GLOBAL" | "EXCHANGE" | "SYMBOL" | "USER";

export type EmergencyState = {
  globalKillSwitch: boolean;
  exchangeKillSwitch: boolean;
  symbolKillSwitch: boolean;
  autoPause: boolean;
  manualPause: boolean;
  reason?: string;
};

export const SAFETY_EVENT = {
  PASSED: "SafetyPassed",
  REJECTED: "SafetyRejected",
  EMERGENCY: "EmergencyTriggered",
  RECOVERY_STARTED: "RecoveryStarted",
  RECOVERY_COMPLETED: "RecoveryCompleted",
  EXCHANGE_RECOVERED: "ExchangeRecovered",
  BLOCKED: "ExecutionBlocked",
} as const;

export type { SafetyValidationStage, SafetyDecisionOutcome, EmergencyActionType, ExecutionSafetyJobType };

export const MAX_PRICE_DRIFT_PCT = 1.5;
export const MAX_API_LATENCY_MS = 2500;
export const DUPLICATE_WINDOW_MS = 120_000;
export const PRICE_CACHE_TTL_MS = 5_000;
