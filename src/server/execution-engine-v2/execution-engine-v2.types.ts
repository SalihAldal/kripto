import type { EntryVerdict, WaitDuration, ExecutionEngineV2JobType } from "@prisma/client";
import type { SpotEntryType } from "@prisma/client";

export type EntryDecision =
  | "BUY_NOW"
  | "WAIT_5_MIN"
  | "WAIT_15_MIN"
  | "WAIT_30_MIN"
  | "REJECT";

export type ExitDecision = "SELL_NOW" | "HOLD" | "EMERGENCY_EXIT";

export type ExecutionOrderType = "MARKET" | "LIMIT" | "IOC" | "FOK";

export type ExecutionEngineV2JobPayload =
  | { type: "ENTRY_EVALUATE"; symbol: string; decisionId: string; decisionConfidence: number; price?: number }
  | { type: "EXIT_EVALUATE"; positionId: string; symbol?: string }
  | { type: "EXECUTE_ORDER"; executionId: string; userId: string; symbol: string; side: "BUY" | "SELL"; riskApproved: boolean }
  | { type: "VERIFY_ORDER"; logKey: string }
  | { type: "RECONCILE"; symbol?: string }
  | { type: "RECOVERY"; executionId?: string }
  | { type: "WAIT_REEVALUATE" }
  | { type: "HOLD_REEVALUATE" };

export type EntryEvaluationResult = {
  decision: EntryDecision;
  entryScore: number;
  entryConfidence: number;
  expectedEntryPrice: number;
  expectedRr: number;
  expectedHoldMinutes: number;
  expectedVolatility: number;
  entryType: SpotEntryType | null;
  analysisId: string;
  reevaluateAt?: string;
  reasons: string[];
  optimalEntryPrice?: number;
  entryQualityScore?: number;
};

export type ExitEvaluationResult = {
  decision: ExitDecision;
  exitConfidence: number;
  expectedRemainingUpside: number;
  expectedDownside: number;
  profitProtectionScore: number;
  analysisId: string;
  reevaluateAt?: string;
  reasons: string[];
  maximumUnrealizedProfit?: number;
  currentProfit?: number;
  profitGiveback?: number;
};

export type ExecutionFlowResult = {
  executionId: string;
  logKey: string;
  status: string;
  filledQuantity: number;
  averageFillPrice: number;
  fee: number;
  slippagePct: number;
  latencyMs: number;
  orderType: ExecutionOrderType;
  rejected?: boolean;
  rejectReason?: string;
};

export function mapEntryVerdictToDecision(verdict: EntryVerdict, waitDuration?: WaitDuration | null): EntryDecision {
  if (verdict === "REJECT") return "REJECT";
  if (verdict === "BUY") return "BUY_NOW";
  if (waitDuration === "MINUTES_5") return "WAIT_5_MIN";
  if (waitDuration === "MINUTES_30") return "WAIT_30_MIN";
  return "WAIT_15_MIN";
}

export function mapExitVerdictToDecision(
  verdict: "SELL" | "HOLD",
  input: { emergency?: boolean; lossPct?: number; riskScore?: number },
): ExitDecision {
  if (input.emergency || (input.lossPct ?? 0) > 5 || (input.riskScore ?? 0) > 75) return "EMERGENCY_EXIT";
  if (verdict === "SELL") return "SELL_NOW";
  return "HOLD";
}

export type { ExecutionEngineV2JobType, EntryVerdict, WaitDuration };
