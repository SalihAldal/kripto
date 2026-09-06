import type { StrategyId } from "@/src/server/forensics/p4-regime-strategy-shadow";
import type { ExitPolicyId, ExitPnlSnapshot, MatchedEntryManifest } from "@/src/server/profitability/pr04-types";
import type { Pr04ExitReplayTick } from "@/src/server/profitability/pr04-replay";

export const PR05_SCHEMA_VERSION = "pr05-offline-comparison-v1" as const;
export const PR05_POLICY_VERSION = "pr05-offline-comparison-v1" as const;
export const PR05_EXPERIMENT_ID = "pr05-offline-comparison-v1" as const;

export type DataSourceClass =
  | "RECORDED_MARKET"
  | "SYNTHETIC_FIXTURE"
  | "MISSING"
  | "RETROSPECTIVE_METADATA"
  | "PRIOR_DEVELOPMENT_TOUCHED";

export type DataInventoryEntry = {
  sourceId: string;
  path: string;
  sourceClass: DataSourceClass;
  venue: string | null;
  quoteCurrency: string | null;
  timeRange: { fromMs: number | null; toMs: number | null };
  hasEventAt: boolean;
  hasAvailableAt: boolean;
  resolution: string;
  gapsKnown: boolean;
  feeMetadata: boolean;
  entryFillData: boolean;
  historicalUniverse: boolean;
  priorUsage: string;
  fitnessForMarketExperiment: "FIT" | "NOT_FIT" | "UNKNOWN";
  fitnessForEngineeringReplay?: "FIT" | "NOT_FIT" | "UNKNOWN";
  reason: string;
};

export type Pr05DataInventoryReport = {
  schemaVersion: typeof PR05_SCHEMA_VERSION;
  generatedAtMs: number;
  recordedMarketDatasetAvailable: boolean;
  holdoutProvenance: "INDEPENDENT" | "HOLDOUT_PROVENANCE_UNKNOWN" | "NOT_APPLICABLE";
  entries: DataInventoryEntry[];
  blockers: string[];
};

export type Pr05ExperimentManifest = {
  schemaVersion: typeof PR05_SCHEMA_VERSION;
  experimentId: typeof PR05_EXPERIMENT_ID;
  version: typeof PR05_POLICY_VERSION;
  manifestHash: string;
  lockedAtMs: number;
  codeFingerprint: {
    headCommit: string;
    pr02PolicyVersion: string;
    pr03PolicyVersion: string;
    pr04PolicyVersion: string;
  };
  dataFingerprint: {
    recordedMarketAvailable: boolean;
    syntheticFixtureAllowed: boolean;
    priorDevelopmentRangesTouched: boolean;
  };
  strategies: StrategyId[];
  exitPolicyIds: ExitPolicyId[];
  baselinePolicyId: ExitPolicyId;
  primaryMetric: "NET_EXPECTANCY_PER_CLOSED_TRADE";
  secondaryMetrics: string[];
  costAssumptions: string[];
  fillAssumptions: string[];
  startingCapital: number;
  riskLimits: string[];
  splitRatios: { train: number; validation: number; test: number };
  embargoMs: number;
  purgeRule: "LABEL_END_PLUS_EMBARGO";
  minClosedTradesPerSplit: number;
  minIndependentLifecycleGroups: number;
  negativeControl: {
    method: "CAUSAL_ENTRY_TIME_SHIFT" | "SIGNAL_BLOCK_SHIFT" | "PNL_PERMUTATION_NON_CAUSAL";
    seed: number;
    iterations: number;
    breaks: string[];
    preserves: string[];
  };
  uncertaintyMethod: "BLOCK_BOOTSTRAP_BY_LIFECYCLE";
  candidateRules: string[];
  costStressScenarios: string[];
  resourceLimits: string[];
};

export type Pr05SplitManifest = {
  schemaVersion: typeof PR05_SCHEMA_VERSION;
  experimentManifestHash: string;
  splitManifestHash: string;
  embargoMs: number;
  trainManifestIds: string[];
  validationManifestIds: string[];
  testManifestIds: string[];
  holdoutUsable: boolean;
  holdoutReason: string;
  leakageChecks: {
    lifecycleCrossSplit: boolean;
    labelPurgeApplied: boolean;
    warmupUsesPastPricesOnly: boolean;
  };
};

export type Pr05TradeOutcome = {
  manifestId: string;
  lifecycleId: string;
  strategyId: StrategyId;
  exitPolicyId: ExitPolicyId;
  split: "TRAIN" | "VALIDATION" | "TEST" | "UNASSIGNED";
  entryAtMs: number;
  closed: boolean;
  censored: boolean;
  grossPnl: number | null;
  netPnl: number | null;
  fees: number;
  rMultiple: number | null;
  holdingMs: number | null;
  symbol: string | null;
  regime: string | null;
  pnlStatus: ExitPnlSnapshot["status"];
  equalRiskComparable: boolean;
};

export type Pr05VariantAggregate = {
  variantKey: string;
  strategyId: StrategyId | "PORTFOLIO";
  exitPolicyId: ExitPolicyId | null;
  comparisonType: "MATCHED_EXIT" | "PORTFOLIO_REPLAY";
  observedCount: number;
  closedTradeCount: number;
  censoredCount: number;
  netExpectancy: number | null;
  netExpectancyStatus: "KNOWN" | "INSUFFICIENT_DATA" | "UNKNOWN";
  winRate: number | null;
  profitFactor: number | null;
  maxDrawdown: number | null;
  largestWinnerShare: number | null;
  topSymbolShare: number | null;
  costStressSurvives: boolean | null;
};

export type Pr05NegativeControlResult = {
  method: string;
  seed: number;
  iterations: number;
  realNetExpectancy: number | null;
  controlNetExpectancies: number[];
  breaksDependency: boolean;
  verdict: "PASS" | "FAIL" | "NOT_RUN" | "INSUFFICIENT_DATA";
  reason: string;
  procedureApplied?: boolean;
  matchedIterations?: number;
  unmatchedIterations?: number;
  distributionDiffers?: boolean | null;
  implementationVerdict?: "PASS" | "FAIL" | "INSUFFICIENT_DATA";
  significanceVerdict?: "DIFFERS" | "NOT_DIFFERENT" | "INSUFFICIENT_DATA" | "NOT_EVALUATED";
};

export type Pr05CostStressResult = {
  scenarioId: string;
  label: string;
  measured: boolean;
  netExpectancy: number | null;
  flipsSign: boolean;
};

export type Pr05OfflineComparisonReport = {
  schemaVersion: typeof PR05_SCHEMA_VERSION;
  policyVersion: typeof PR05_POLICY_VERSION;
  experimentId: typeof PR05_EXPERIMENT_ID;
  datasetId: string;
  generatedAtMs: number;
  status: "COMPLETED" | "BLOCKED" | "INSUFFICIENT_DATA" | "NOT_RUN";
  reason: string | null;
  experimentManifest: Pr05ExperimentManifest;
  splitManifest: Pr05SplitManifest | null;
  dataInventory: Pr05DataInventoryReport;
  variantCount: number;
  independentLifecycleGroups: number;
  closedTradeCount: number;
  matchedExitOutcomes: Pr05TradeOutcome[];
  portfolioOutcomes: Pr05TradeOutcome[];
  aggregates: Pr05VariantAggregate[];
  negativeControl: Pr05NegativeControlResult;
  costStress: Pr05CostStressResult[];
  holdoutEvaluationStatus: "NOT_RUN" | "INSUFFICIENT_DATA" | "HOLDOUT_PROVENANCE_UNKNOWN" | "COMPLETED";
  profitabilityEvidence: "NOT_ESTABLISHED" | "INSUFFICIENT_DATA" | "INVALID_EVIDENCE";
  offlineCandidateVerdict: "INSUFFICIENT_DATA" | "INVALID_EVIDENCE" | "NO_CANDIDATE_SUPPORTED" | "OFFLINE_CANDIDATE_SUPPORTED" | "BLOCKED";
  selectedCandidateIds: string[];
  openBlockers: string[];
};

export type Pr05MatchedExitInput = {
  datasetId: string;
  manifests: MatchedEntryManifest[];
  ticksByManifestId: Record<string, Pr04ExitReplayTick[]>;
  policyIds?: ExitPolicyId[];
  recordedMarketData: boolean;
  headCommit?: string;
};

export type Pr05LifecycleRow = {
  lifecycleId: string;
  eventAtMs: number;
  labelEndAtMs: number;
  manifest: MatchedEntryManifest;
};
