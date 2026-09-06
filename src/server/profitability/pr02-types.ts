import type { MarketTradeEvent } from "@/src/server/market-data/spine/events";
import type { BookTickerState } from "@/src/server/market-data/spine/events";
import type { StrategyEvaluation, RegimeSnapshot, StrategyInput } from "@/src/server/forensics/p4-regime-strategy-shadow";
import type { TradeEconomicsRecord } from "@/src/server/profitability/pr01-types";

export const PR02_SCHEMA_VERSION = "pr02-early-acceleration-v1" as const;
export const PR02_POLICY_VERSION = "pr02-early-acceleration-v1" as const;

export type EarlySetupState =
  | "WARMUP"
  | "OBSERVING"
  | "ARMED"
  | "TRIGGERED"
  | "INVALIDATED"
  | "EXPIRED";

export type EarlyFeatureQuality = "VALID" | "MISSING" | "STALE" | "INVALID" | "INSUFFICIENT_DATA";

export type EarlyFeatureSpec = {
  key: string;
  value: number | null;
  unit: string;
  windowMs: number | null;
  baseline: string | null;
  availableAt: string | null;
  quality: EarlyFeatureQuality;
  reasonCode: string | null;
  transformVersion: string;
};

export type EarlyFeatureSet = {
  schemaVersion: typeof PR02_SCHEMA_VERSION;
  policyVersion: typeof PR02_POLICY_VERSION;
  symbol: string;
  candidateId: string;
  lifecycleId: string;
  marketEventAt: string;
  observedAt: string;
  coverage: {
    tradeCount: number;
    historyMs: number;
    bookFresh: boolean;
    warmupComplete: boolean;
  };
  features: Record<string, EarlyFeatureSpec>;
  missingRequired: string[];
  missingOptional: string[];
  invalidFeatures: string[];
  staleFeatures: string[];
};

export type EarlySetupTransition = {
  candidateId: string;
  lifecycleId: string;
  strategyId: "EARLY_ACCELERATION";
  policyVersion: typeof PR02_POLICY_VERSION;
  eventAt: string;
  availableAt: string;
  previousState: EarlySetupState;
  newState: EarlySetupState;
  reasonCode: string;
  snapshotReference: string | null;
  signalId: string | null;
  triggerGeneration: number;
};

export type EarlyTriggerResult = {
  triggered: boolean;
  signalId: string | null;
  triggerAt: string | null;
  validUntil: string | null;
  reasonCodes: string[];
  setupQualified: boolean;
  entryTriggerMet: boolean;
  rankingScore: number;
};

export type EarlyExhaustionAssessment = {
  exhausted: boolean;
  reasonCodes: string[];
  extensionFromBaselinePct: number | null;
  flowWeakening: boolean;
  spreadDepthDeteriorating: boolean;
  spikeReversal: boolean;
};

export type EarlyEvaluationResult = {
  schemaVersion: typeof PR02_SCHEMA_VERSION;
  policyVersion: typeof PR02_POLICY_VERSION;
  candidateId: string;
  lifecycleId: string;
  strategyId: "EARLY_ACCELERATION";
  featureSnapshotId: string | null;
  sourceType: StrategyInput["sourceType"];
  marketEventAt: string;
  evaluatedAt: string;
  setupState: EarlySetupState;
  dataValidity: "VALID" | "WARMUP" | "INSUFFICIENT_DATA" | "STALE" | "INVALID";
  universeEligible: boolean;
  setupQualified: boolean;
  trigger: EarlyTriggerResult;
  exhaustion: EarlyExhaustionAssessment;
  features: EarlyFeatureSet;
  transition: EarlySetupTransition | null;
  economics: TradeEconomicsRecord | null;
  economicsStatus: "KNOWN" | "UNKNOWN" | "INSUFFICIENT_EVIDENCE";
  invalidation: import("@/src/server/profitability/pr03-types").InvalidationContract | null;
  setupId: string;
  strategyEvaluation: StrategyEvaluation;
};

export type EarlyContextExtension = {
  trades?: MarketTradeEvent[];
  book?: BookTickerState | null;
  baselinePrice?: number;
  firstDetectionPrice?: number;
  intendedNotional?: number;
  featureSnapshotId?: string;
  lifecycleId?: string;
  replayTickIndex?: number;
  nowMs?: number;
};

export type EarlyMarketTick = {
  tickIndex: number;
  eventAtMs: number;
  availableAtMs: number;
  symbol: string;
  candidateId: string;
  lifecycleId: string;
  price: number;
  baselinePrice: number;
  firstDetectionPrice: number;
  trades: MarketTradeEvent[];
  book: BookTickerState | null;
  intendedNotional: number;
  sourceType: StrategyInput["sourceType"];
  regime: RegimeSnapshot;
  strategyInput: StrategyInput;
};

export type EarlyReplayReport = {
  schemaVersion: typeof PR02_SCHEMA_VERSION;
  policyVersion: typeof PR02_POLICY_VERSION;
  datasetId: string;
  tickCount: number;
  warmupCount: number;
  insufficientDataCount: number;
  setupQualifiedCount: number;
  triggerCount: number;
  uniqueLifecycleTriggerCount: number;
  expiredCount: number;
  invalidatedCount: number;
  duplicateSuppressedCount: number;
  costEvidenceKnownCount: number;
  costEvidenceUnknownCount: number;
  status: "COMPLETED" | "NOT_RUN";
  reason: string | null;
};
