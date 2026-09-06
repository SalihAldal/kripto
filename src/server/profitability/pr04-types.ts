import type { InvalidationContract } from "@/src/server/profitability/pr03-types";
import type { StrategyId } from "@/src/server/forensics/p4-regime-strategy-shadow";

export const PR04_SCHEMA_VERSION = "pr04-exit-and-position-management-v1" as const;
export const PR04_POLICY_VERSION = "pr04-exit-and-position-management-v1" as const;

export type ExitPolicyId =
  | "BASELINE_FIXED_TP_SL"
  | "STRUCTURAL_STOP_TARGET"
  | "STRUCTURAL_STOP_TRAIL"
  | "STRUCTURAL_PARTIAL_TRAIL"
  | "STRUCTURAL_TIME_DECAY";

export type ExitDecisionKind =
  | "NONE"
  | "STRUCTURAL_STOP"
  | "TAKE_PROFIT"
  | "PARTIAL_TAKE_PROFIT"
  | "TRAILING_STOP"
  | "TIME_EXIT"
  | "SETUP_INVALIDATION"
  | "RISK_OVERRIDE"
  | "MANUAL_CLOSE";

export type ExitOrderState = "NONE" | "INTENT" | "SUBMITTED" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "UNKNOWN";

export type RiskReference = {
  entryPrice: number;
  initialStopPrice: number | null;
  initialRiskPerUnit: number | null;
  initialRiskNotional: number | null;
  includesFeesInBreakEven: boolean;
  computedAtMs: number;
  quality: "VALID" | "UNKNOWN" | "INSUFFICIENT_DATA";
  reasonCode: string | null;
};

export type ExitPolicySnapshot = {
  schemaVersion: typeof PR04_SCHEMA_VERSION;
  policyVersion: typeof PR04_POLICY_VERSION;
  exitPolicyId: ExitPolicyId;
  experimentalMode: boolean;
  strategyId: StrategyId;
  entryPolicyVersion: string;
  positionId: string;
  entrySignalId: string | null;
  setupId: string | null;
  boundAtMs: number;
  takeProfitPercent: number | null;
  structuralInvalidation: InvalidationContract | null;
  trailingActivationPct: number | null;
  trailingGapPct: number | null;
  partialLegs: Array<{ legId: string; targetProfitPct: number; fractionOfInitial: number }>;
  timeExitMs: number | null;
  timeReference: "FIRST_FILL" | "POSITION_OPEN";
  tickSize: number;
  stepSize: number;
  minNotional: number;
};

export type ExitFillRecord = {
  fillId: string;
  side: "SELL";
  price: number;
  quantity: number;
  fee: number;
  feeAsset: "BASE" | "QUOTE" | "UNKNOWN";
  filledAtMs: number;
  decisionKind: ExitDecisionKind;
};

export type ExitPolicyState = {
  positionId: string;
  snapshot: ExitPolicySnapshot;
  initialQuantity: number;
  remainingQuantity: number;
  reservedSellQuantity: number;
  entryFills: Array<{ price: number; quantity: number; fee: number; atMs: number }>;
  riskReference: RiskReference;
  activeStopPrice: number | null;
  trailingHighWaterMark: number | null;
  trailingArmed: boolean;
  completedPartialLegs: string[];
  timeAnchorMs: number;
  lastDataAtMs: number;
  lastDecision: ExitDecisionKind;
  lastReasonCode: string | null;
  lastEventId: string | null;
  orderState: ExitOrderState;
  exitFills: ExitFillRecord[];
  terminalStatus: "OPEN" | "REDUCING" | "CLOSED" | "CENSORED";
  version: number;
};

export type ExitTickObservation = {
  eventId: string;
  eventAtMs: number;
  availableAtMs: number;
  markPrice: number | null;
  bid: number | null;
  ask: number | null;
  high: number | null;
  low: number | null;
  closed: boolean;
  stale: boolean;
  dataGap: boolean;
};

export type ExitDecision = {
  kind: ExitDecisionKind;
  reasonCode: string;
  decisionAtMs: number;
  availableAtMs: number;
  closeQuantity: number | null;
  decisionPrice: number | null;
  stopPriceAfter: number | null;
  partialLegId: string | null;
  duplicateSuppressed: boolean;
  policyId: ExitPolicyId;
};

export type ExitEvaluationResult = {
  schemaVersion: typeof PR04_SCHEMA_VERSION;
  policyVersion: typeof PR04_POLICY_VERSION;
  positionId: string;
  state: ExitPolicyState;
  decision: ExitDecision;
  pnl: ExitPnlSnapshot;
};

export type ExitPnlSnapshot = {
  realizedGrossPnl: number;
  realizedFees: number;
  realizedNetPnl: number | null;
  unrealizedGrossPnl: number | null;
  unrealizedNetPnl: number | null;
  status: "KNOWN" | "PARTIAL" | "UNKNOWN";
  reasonCodes: string[];
};

export type MatchedEntryManifest = {
  manifestId: string;
  manifestHash: string;
  entrySignalId: string;
  strategyId: StrategyId;
  entryPolicyVersion: string;
  entryAtMs: number;
  fills: Array<{ price: number; quantity: number; fee: number; atMs: number }>;
  initialQuantity: number;
  riskReference: RiskReference;
  invalidation: InvalidationContract | null;
  featureEvidenceIds: string[];
  dataSource: string;
  replayWindow: { fromMs: number; toMs: number };
  symbol?: string | null;
  regime?: string | null;
  closedAtMs?: number | null;
};

export type Pr04ReplayReport = {
  schemaVersion: typeof PR04_SCHEMA_VERSION;
  policyVersion: typeof PR04_POLICY_VERSION;
  datasetId: string;
  manifestId: string;
  policyId: ExitPolicyId;
  tickCount: number;
  decisionCount: number;
  partialCount: number;
  fullCloseCount: number;
  censoredCount: number;
  status: "COMPLETED" | "NOT_RUN";
  reason: string | null;
};
