export const PR01_SCHEMA_VERSION = "pr01-opportunity-universe-v1";
export const PR01_POLICY_VERSION = "pr01-net-economics-v1";

export type EligibilityVerdict =
  | "EXECUTABLE"
  | "NOT_EXECUTABLE"
  | "HISTORICAL_ELIGIBILITY_UNKNOWN"
  | "VENUE_MAPPING_UNCERTAIN"
  | "INSUFFICIENT_DEPTH"
  | "BELOW_MIN_NOTIONAL"
  | "STALE_MARKET_DATA";

export type MoveOnsetType = "CAUSAL_THRESHOLD" | "RETROSPECTIVE_LABEL";

export type OpportunityCohort =
  | "A_MARKET_OBSERVATIONS"
  | "B_SYSTEM_DETECTED"
  | "C_STRATEGY_EVALUATED"
  | "D_ENTER_DECISION"
  | "E_EXECUTED_SETTLED"
  | "F_RETROSPECTIVE_SIGNIFICANT_MOVE";

export type CostCoverageLevel = "MEASURED" | "CONFIGURED_ASSUMPTION" | "MODELED" | "UNKNOWN";

export type EconomicsLevel =
  | "COST_COVERAGE"
  | "MOVE_VIABILITY"
  | "EXPECTANCY_ESTIMATE"
  | "REALIZED_NET_RESULT";

export type ExpectancyEvidenceStatus =
  | "PROVEN"
  | "INSUFFICIENT_EVIDENCE"
  | "UNKNOWN"
  | "NOT_EVALUATED";

export type MarketAnalysisResult = "PASS" | "PARTIAL" | "NOT_RUN" | "BLOCKED";

export type JoinConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type LatencySegment =
  | "MARKET_EVENT_TO_AVAILABLE"
  | "AVAILABLE_TO_FIRST_DETECTION"
  | "FIRST_DETECTION_TO_STRATEGY_SIGNAL"
  | "STRATEGY_SIGNAL_TO_CANONICAL_DECISION"
  | "DECISION_TO_INTENT"
  | "INTENT_TO_SUBMIT"
  | "SUBMIT_TO_FIRST_FILL"
  | "FIRST_FILL_TO_FULL_FILL";

export type LatencyObservation = {
  segment: LatencySegment;
  startAtMs: number | null;
  endAtMs: number | null;
  durationMs: number | null;
  status: "OBSERVED" | "MISSING" | "INVALID" | "NOT_OBSERVED";
  reasonCode: string | null;
  clockSkewMs: number | null;
  isRetry: boolean;
};

export type PointInTimeUniverseRecord = {
  schemaVersion: typeof PR01_SCHEMA_VERSION;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  discoveryVenue: string;
  executionVenue: string;
  marketType: "SPOT";
  asOfMs: number;
  metadataAvailableAtMs: number | null;
  listingStatus: "LISTED" | "DELISTED" | "UNKNOWN" | "HISTORICAL_ELIGIBILITY_UNKNOWN";
  allowedOrderTypes: string[];
  tickSize: number | null;
  stepSize: number | null;
  minQty: number | null;
  minNotional: number | null;
  quoteAssetCurrency: string;
  marketDataFreshnessMs: number | null;
  bookDepthCoverage: "MEASURED" | "PARTIAL" | "UNKNOWN";
  venueMappingQuality: "EXACT" | "VARIANT_RESOLVED" | "UNCERTAIN" | "MISSING";
  eligibilityVerdict: EligibilityVerdict;
  reasonCodes: string[];
};

export type OpportunityLifecycleRecord = {
  lifecycleId: string;
  symbol: string;
  venue: string;
  quoteCurrency: string;
  horizonMin: number | null;
  moveOnsetType: MoveOnsetType | null;
  thresholdCrossingAtMs: number | null;
  retrospectiveOnsetAtMs: number | null;
  sourceCoverageQuality: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  systemDetected: boolean;
  firstDetectedAtMs: number | null;
  eligibleForExecution: boolean | null;
  cohortsReached: OpportunityCohort[];
  joinConfidence: JoinConfidence;
  joinStatus: "JOINED" | "UNMATCHED" | "AMBIGUOUS" | "UNKNOWN";
  candidateId: string | null;
  decisionId: string | null;
  strategyId: string | null;
};

export type TradeEconomicsRecord = {
  schemaVersion: typeof PR01_SCHEMA_VERSION;
  candidateId: string | null;
  decisionId: string | null;
  strategyId: string | null;
  policyVersion: string;
  featureSnapshotId: string | null;
  venue: string;
  symbol: string;
  quoteCurrency: string;
  decisionAtMs: number | null;
  intendedNotional: number | null;
  intendedQuantity: number | null;
  horizonMin: number | null;
  expectedMove: {
    value: number | null;
    source: string;
    asOfMs: number | null;
    quality: "VALID" | "MISSING" | "STALE" | "INVALID" | "MODEL_ESTIMATE";
  };
  costCoverage: {
    level: CostCoverageLevel;
    entryFee: number | null;
    exitFee: number | null;
    entryExecutionCost: number | null;
    exitExecutionCost: number | null;
    latencyAssumptionMs: number | null;
    quality: CostCoverageLevel;
    reasonCodes: string[];
  };
  moveViability: {
    grossMovePct: number | null;
    breakEvenMovePct: number | null;
    scenarioNetReturnPct: number | null;
    viable: boolean | null;
    status: "PASS" | "FAIL" | "UNKNOWN";
  };
  expectancy: {
    status: ExpectancyEvidenceStatus;
    winRate: number | null;
    avgWinPct: number | null;
    avgLossPct: number | null;
    evidenceRef: string | null;
  };
  realizedNet: {
    status: "OBSERVED" | "NOT_OBSERVED" | "UNKNOWN";
    netPnl: number | null;
    netReturnPct: number | null;
    source: "ER04_SETTLEMENT" | "UNKNOWN";
  };
  mfePct: number | null;
  status: string;
  reasonCodes: string[];
};

export type MoveBucketReport = {
  bucketId: string;
  moveClassPct: number;
  sampleCount: number;
  detectedCount: number;
  undetectedCount: number;
  unknownCoverageCount: number;
  executableCount: number;
  executableUnknownCount: number;
  avgCostRatioPct: number | null;
  avgRemainingMoveAfterDetectionPct: number | null;
};

export type Pr01AnalysisReport = {
  schemaVersion: typeof PR01_SCHEMA_VERSION;
  policyVersion: typeof PR01_POLICY_VERSION;
  generatedAt: string;
  inspectedHead: string | null;
  worktreeFingerprintSha256: string | null;
  marketAnalysisResult: MarketAnalysisResult;
  expectancyEvidenceStatus: ExpectancyEvidenceStatus;
  universe: {
    evaluatedCount: number;
    executableCount: number;
    notExecutableCount: number;
    historicalUnknownCount: number;
  };
  opportunityCohorts: Record<OpportunityCohort, number>;
  latency: {
    observedSegmentCount: number;
    missingSegmentCount: number;
    invalidSegmentCount: number;
  };
  economics: {
    costCoverageMeasured: number;
    costCoverageUnknown: number;
    moveViabilityPass: number;
    moveViabilityFail: number;
    expectancyProven: number;
    expectancyUnknown: number;
    realizedObserved: number;
  };
  moveBuckets: MoveBucketReport[];
  openBlockers: string[];
  verdicts: {
    PROMPT7_ENGINEERING_VERDICT: "PASS" | "PARTIAL" | "FAIL";
    UNIVERSE_COVERAGE_VERDICT: "PASS" | "PARTIAL" | "NOT_RUN" | "BLOCKED";
    OPPORTUNITY_ATTRIBUTION_VERDICT: "PASS" | "PARTIAL" | "NOT_RUN" | "BLOCKED";
    COST_MODEL_CORRECTNESS_VERDICT: "PASS" | "PARTIAL" | "FAIL";
    MARKET_ANALYSIS_RESULT: MarketAnalysisResult;
    EXPECTANCY_EVIDENCE_STATUS: ExpectancyEvidenceStatus;
    OVERALL_QA_STATUS: "QA_PENDING";
    PAPER_CAMPAIGN_STARTED: false;
    LIVE_AUTHORIZATION: "DISABLED";
    STRATEGY_PROMOTION: "NOT_EVALUATED";
  };
};
