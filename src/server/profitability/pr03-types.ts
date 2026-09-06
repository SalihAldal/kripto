import type { MarketTradeEvent } from "@/src/server/market-data/spine/events";
import type { BookTickerState } from "@/src/server/market-data/spine/events";
import type { StrategyEvaluation, RegimeSnapshot, StrategyInput } from "@/src/server/forensics/p4-regime-strategy-shadow";
import type { TradeEconomicsRecord } from "@/src/server/profitability/pr01-types";

export const PR03_SCHEMA_VERSION = "pr03-momentum-and-retest-v1" as const;
export const PR03_POLICY_VERSION = "pr03-momentum-and-retest-v1" as const;

export type CausalCandle = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
  availableAt: number;
};

export type FeatureQuality = "VALID" | "MISSING" | "STALE" | "INVALID" | "INSUFFICIENT_DATA";

export type ReferenceLevel = {
  level: number | null;
  levelVersion: string;
  source: "CONFIRMED_PIVOT_HIGH";
  pivotAtMs: number;
  availableAtMs: number;
  windowMs: number;
  toleranceBps: number;
  quality: FeatureQuality;
  reasonCode: string | null;
};

export type BreakoutSetupState =
  | "WARMUP"
  | "LEVEL_READY"
  | "BREAKOUT_CONFIRMED"
  | "RETEST_PENDING"
  | "RETEST_OBSERVED"
  | "HOLD_CONFIRMED"
  | "TRIGGERED"
  | "INVALIDATED"
  | "EXPIRED";

export type MomentumSetupState =
  | "WARMUP"
  | "OBSERVING"
  | "IMPULSE_CONFIRMED"
  | "PAUSE_OBSERVED"
  | "RESUMPTION_ARMED"
  | "TRIGGERED"
  | "INVALIDATED"
  | "EXPIRED";

export type StrategyContextExtension = {
  trades?: MarketTradeEvent[];
  book?: BookTickerState | null;
  candles?: CausalCandle[];
  lifecycleId?: string;
  featureSnapshotId?: string;
  nowMs?: number;
  tickSize?: number;
  replayTickIndex?: number;
  venue?: string;
  symbol?: string;
};

export type InvalidationContract = {
  referenceLevel: number | null;
  invalidationThreshold: number | null;
  reasonCode: string;
  computedAtMs: number;
  availableAtMs: number;
  validUntilMs: number | null;
  sourceObservations: string[];
};

export type StrategyTriggerResult = {
  triggered: boolean;
  signalId: string | null;
  triggerAt: string | null;
  validUntil: string | null;
  reasonCodes: string[];
  setupQualified: boolean;
  entryTriggerMet: boolean;
  rankingScore: number;
};

export type StrategySetupTransition<TState extends string> = {
  candidateId: string;
  lifecycleId: string;
  strategyId: "MOMENTUM_CONTINUATION" | "BREAKOUT_RETEST";
  policyVersion: typeof PR03_POLICY_VERSION;
  eventAt: string;
  availableAt: string;
  previousState: TState;
  newState: TState;
  reasonCode: string;
  snapshotReference: string | null;
  signalId: string | null;
  triggerGeneration: number;
  setupId: string;
};

export type BreakoutEvaluationResult = {
  schemaVersion: typeof PR03_SCHEMA_VERSION;
  policyVersion: typeof PR03_POLICY_VERSION;
  candidateId: string;
  lifecycleId: string;
  setupId: string;
  strategyId: "BREAKOUT_RETEST";
  featureSnapshotId: string | null;
  sourceType: StrategyInput["sourceType"];
  marketEventAt: string;
  evaluatedAt: string;
  setupState: BreakoutSetupState;
  referenceLevel: ReferenceLevel | null;
  invalidation: InvalidationContract | null;
  trigger: StrategyTriggerResult;
  transition: StrategySetupTransition<BreakoutSetupState> | null;
  economics: TradeEconomicsRecord | null;
  economicsStatus: "KNOWN" | "UNKNOWN" | "INSUFFICIENT_EVIDENCE";
  strategyEvaluation: StrategyEvaluation;
};

export type MomentumEvaluationResult = {
  schemaVersion: typeof PR03_SCHEMA_VERSION;
  policyVersion: typeof PR03_POLICY_VERSION;
  candidateId: string;
  lifecycleId: string;
  setupId: string;
  strategyId: "MOMENTUM_CONTINUATION";
  featureSnapshotId: string | null;
  sourceType: StrategyInput["sourceType"];
  marketEventAt: string;
  evaluatedAt: string;
  setupState: MomentumSetupState;
  impulseReferencePrice: number | null;
  invalidation: InvalidationContract | null;
  trigger: StrategyTriggerResult;
  transition: StrategySetupTransition<MomentumSetupState> | null;
  economics: TradeEconomicsRecord | null;
  economicsStatus: "KNOWN" | "UNKNOWN" | "INSUFFICIENT_EVIDENCE";
  strategyEvaluation: StrategyEvaluation;
};

export type Pr03ReplayReport = {
  schemaVersion: typeof PR03_SCHEMA_VERSION;
  policyVersion: typeof PR03_POLICY_VERSION;
  datasetId: string;
  tickCount: number;
  momentumTriggerCount: number;
  breakoutTriggerCount: number;
  uniqueMomentumLifecycleTriggers: number;
  uniqueBreakoutLifecycleTriggers: number;
  status: "COMPLETED" | "NOT_RUN";
  reason: string | null;
};
