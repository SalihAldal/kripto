export type TerminalVerdict = "APPROVED" | "WAIT" | "REJECTED" | "FAILED" | "UNKNOWN";

export type DecisionVerdict = "APPROVE" | "WAIT" | "REJECT" | "FAILED";

export type AiExecutionMode = "REMOTE" | "DEGRADED_LOCAL" | "AI_DEGRADED" | "AI_PROVIDER_DEGRADED";

export type ExitReasonCode =
  | "TAKE_PROFIT"
  | "STOP_LOSS"
  | "STRATEGY_EXIT"
  | "TIME_EXIT"
  | "END_OF_REPLAY";

export type AiExecutionGateVerdict = "AI_GATE_PASS" | "AI_GATE_BLOCK" | "AI_ADVISORY_ONLY";

export type AiExecutionGatePolicy = "VETO" | "ADVISORY";

export type AiExecutionGateRecord = {
  candidateId?: string;
  symbol: string;
  aiVerdict: string;
  aiFinalDecision: string;
  consensusDecision?: string | null;
  aiGatePolicy: AiExecutionGatePolicy;
  aiGateVerdict: AiExecutionGateVerdict;
  executionVerdict: AiExecutionGateVerdict;
  policy: AiExecutionGatePolicy;
  reasonCode: string;
  reasonDetail: string;
  executionSide?: "BUY" | "SELL" | null;
  timestamp: string;
};

export type FeeEdgeMetricsSnapshot = {
  generatedAt: string;
  entryPrice: number;
  quantity: number;
  notional: number;
  takerFeeRate: number;
  estimatedEntryFee: number;
  estimatedExitFee: number;
  estimatedRoundTripFees: number;
  estimatedRoundTripFee: number;
  expectedGrossAtTp: number;
  expectedGrossPnL: number;
  expectedGrossAtSl: number;
  expectedGrossToFeeRatio: number;
  feeToExpectedGrossRatio: number;
  minimumGrossToCoverFees: number;
  expectedNetAfterFeesAtTp: number;
  expectedNetAfterFeesAtSl: number;
  expectedNetPnL: number;
  expectedGrossEdge?: number;
  expectedNetEdge?: number;
  feeToGrossEdgeRatio?: number;
  minimumGrossMoveToCoverFees?: number;
  edgeAfterFees?: number;
  feeClassification?: "FEE_SAFE" | "FEE_BORDERLINE" | "FEE_EROSION" | "UNKNOWN";
  takeProfitPercent: number;
  stopLossPercent: number;
  feeEdgeClass?: "FEE_SAFE" | "FEE_BORDERLINE" | "FEE_EROSION" | "UNKNOWN";
};

export type ExitForensicRecord = {
  exitModel: "POSITION_MONITOR" | "REPLAY_WINDOW" | "MANUAL_TIMEOUT";
  exitReason: ExitReasonCode;
  entryPrice: number;
  exitPrice: number;
  entryTimestamp: string;
  exitTimestamp: string;
  durationMs: number;
  holdDurationMs?: number;
  tpLevel?: number | null;
  slLevel?: number | null;
  strategyExit?: boolean;
  strategyExitReason?: string | null;
  timeExitReason?: string | null;
  normalizedCloseReason?: string | null;
  closeReasonAlias?: string | null;
  priceAtMonitorTick?: number | null;
  decisionTimestamp?: string | null;
  monitorPrecedenceRule?: string | null;
  replayPrecedenceRule?: string | null;
  realizedGrossPnL?: number;
  closeReason?: string | null;
  replayWindowEnded?: boolean;
};

export type ExecutionCandidateForensic = {
  candidateId: string;
  symbol: string;
  aiVerdict: string;
  executionVerdict: AiExecutionGateVerdict | "PENDING" | "REJECTED";
  riskVerdict?: string;
  sizingVerdict?: string;
  feeEstimate?: FeeEdgeMetricsSnapshot;
  orderVerdict?: string;
  reasonCode?: string;
  reasonDetail?: string;
  timestamp: string;
};

export type ForensicRegimeClass =
  | "RANGE"
  | "TREND"
  | "HIGH_VOLATILITY"
  | "CHAOS"
  | "LOW_LIQUIDITY"
  | "UNKNOWN";

export type EntryTimingClass = "GOOD_ENTRY" | "NORMAL" | "CHASING" | "EDGE_DECAY" | "POSSIBLY_LATE" | "UNKNOWN";

export type EntryTimingAggregateReport = {
  generatedAt: string;
  sampleSize: number;
  classificationCounts: Partial<Record<EntryTimingClass, number>>;
  entryDelayMs: { p50: number; p90: number; p95: number };
  movementToEntryPercent: { p50: number; p90: number; p95: number };
  stageLatencyMs: {
    scannerToCandidate?: { p50: number; p90: number; p95: number };
    candidateToDecision?: { p50: number; p90: number; p95: number };
    decisionToEntry?: { p50: number; p90: number; p95: number };
  };
};

export type MeanReversionEntryRecord = {
  candidateId: string;
  tradeId?: string;
  symbol: string;
  side: "LONG" | "SHORT";
  strategyId: string;
  strategySelectionReason: string;
  forensicRegime: ForensicRegimeClass;
  marketRegime: string;
  volatilityPercent: number;
  trendStrength: number;
  liquidityScore: number;
  momentumPercent: number;
  shortMomentumPercent: number;
  entryTimingMs?: number;
  entryPrice: number;
  candidateTimestamp?: string;
  decisionTimestamp?: string;
  entryTimestamp: string;
  metadata?: Record<string, unknown>;
};

export type ScannerQualificationRejection = {
  symbol: string;
  stage: "universe" | "qualification" | "filter" | "candidate_generation" | "ranking";
  filter: string;
  reasonCode: string;
  exclusionCategory?:
    | "SCANNER_ROTATION"
    | "PUMP_LANE_MISS"
    | "QUALIFICATION"
    | "LIQUIDITY"
    | "SPREAD"
    | "VOLATILITY"
    | "STALE_DATA"
    | "OTHER";
  reasonDetail: string;
  threshold?: number | string | null;
  actualValue?: number | string | null;
  timestamp: string;
  missedOpportunityStage?: MissedOpportunityStage;
};

export type NotDiscoveredAnalysisRecord = {
  symbol: string;
  stage: MissedOpportunityStage;
  filter: string;
  reasonCode: string;
  reasonDetail: string;
  threshold?: number | string | null;
  actualValue?: number | string | null;
  analysisScope: "POST_ENTRY_ANALYSIS";
  subsequentMovePercent?: number;
  timestamp: string;
  qualificationTrail: ScannerQualificationRejection[];
};

export type EvCalibrationBucket = {
  bucketLabel: string;
  evMin: number;
  evMax: number;
  sampleSize: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  predictedExpectancy: number;
  actualExpectancy: number;
  calibrationDelta: number;
  grossPnL: number;
  netPnL: number;
};

export type EvCalibrationReport = {
  generatedAt: string;
  formulaVersion: string;
  totalSamples: number;
  buckets: EvCalibrationBucket[];
  meanCalibrationDelta: number;
  brierScore?: number | null;
  deterministicHash: string;
};

export type EntryTimingRecord = {
  candidateId: string;
  symbol: string;
  candidateTimestamp?: string;
  decisionTimestamp?: string;
  entryTimestamp: string;
  entryDelayMs: number;
  priceAtCandidate?: number;
  priceAtDecision?: number;
  priceAtEntry: number;
  movementToEntryPercent?: number;
  classification: EntryTimingClass;
  reasonDetail: string;
};

export type ScannerCoverageSnapshot = {
  timestamp: string;
  scannerUniverse: number;
  priorityMaxPerCycle?: number;
  rotationCandidates: number;
  priorityCandidates: number;
  rotationCount?: number;
  priorityCount?: number;
  duplicatesRemoved: number;
  duplicateCount?: number;
  totalEvaluated: number;
  totalEvaluationCount?: number;
  notDiscoveredCount: number;
  priorityRescuedCount: number;
  discoverySources: Array<{
    symbol: string;
    discoverySource: "ROTATION" | "PRIORITY" | "PUMP" | "OTHER";
    prioritySource?: string;
    priorityReason?: string;
    priorityScore?: number;
  }>;
};

export type StrategyPerformanceRow = {
  strategy: string;
  sampleSize: number;
  tradeCount: number;
  winRate: number;
  grossPnL: number;
  fees: number;
  netPnL: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  averageWin: number;
  averageLoss: number;
  averageHoldingTimeMs: number;
  medianHoldingTimeMs: number;
  regimeBreakdown: Partial<Record<ForensicRegimeClass, { tradeCount: number; netPnL: number; winRate: number }>>;
};

export type StrategyPerformanceReport = {
  generatedAt: string;
  totalSampleSize: number;
  strategies: StrategyPerformanceRow[];
  deterministicHash: string;
};

export type MeanReversionOfflineAnalysis = {
  generatedAt: string;
  totalTrades: number;
  byRegime: Record<string, { tradeCount: number; wins: number; netPnL: number }>;
  bySide: Record<string, { tradeCount: number; wins: number; netPnL: number }>;
  byVolatilityBucket: Record<string, { tradeCount: number; wins: number; netPnL: number }>;
  byHoldTimeBucket: Record<string, { tradeCount: number; wins: number; netPnL: number }>;
  deterministicHash: string;
};

export type P1ForensicSessionBundle = {
  meanReversionEntries: MeanReversionEntryRecord[];
  scannerQualificationRejections: ScannerQualificationRejection[];
  notDiscoveredRecords: NotDiscoveredAnalysisRecord[];
  entryTimingRecords: EntryTimingRecord[];
  entryTimingAggregates?: EntryTimingAggregateReport;
  scannerCoverage?: ScannerCoverageSnapshot[];
  meanReversionAnalysis?: MeanReversionOfflineAnalysis;
  evCalibration?: EvCalibrationReport;
  evComponentAttribution?: EvComponentAttributionReport;
  strategyPerformance?: StrategyPerformanceReport;
  strategyRegimeMatrix?: StrategyRegimeMatrixReport;
  mrRegimeGatingExperiment?: MrRegimeGatingExperimentReport;
  opportunityFunnel?: OpportunityFunnelReport;
  lossPatterns?: TradePatternReport;
  winningPatterns?: TradePatternReport;
  feeAwareEdgeResearch?: FeeAwareEdgeResearchReport;
  promotionGate?: PromotionGateEvaluation;
  exitForensicsReport?: {
    generatedAt: string;
    precedence: {
      positionMonitor: string;
      replayWindow: string;
    };
    rows: Array<{
      tradeId: string;
      positionId: string;
      symbol: string;
      entryPrice: number;
      entryTimestamp?: string;
      exitPrice: number;
      exitTimestamp?: string;
      holdDurationMs?: number;
      exitReason?: ExitReasonCode;
      exitModel?: ExitForensicRecord["exitModel"];
      tpLevel?: number | null;
      slLevel?: number | null;
      strategyExitReason?: string | null;
      timeExitReason?: string | null;
      grossPnL: number;
      entryFee: number;
      exitFee: number;
      totalFee: number;
      netPnL: number;
    }>;
    exitReasonCounts: Record<string, number>;
    exitModelCounts: Record<string, number>;
  };
  replayExitDiagnostics?: {
    generatedAt: string;
    rows: Array<{
      tradeId: string;
      symbol: string;
      exitReason?: ExitReasonCode;
      exitModel?: ExitForensicRecord["exitModel"];
      replayWindowEnded?: boolean;
      tpWouldHitBeforeBoundary: "YES" | "NO" | "UNKNOWN";
      slWouldHitBeforeBoundary: "YES" | "NO" | "UNKNOWN";
      strategyExitWouldHitBeforeBoundary: "YES" | "NO" | "UNKNOWN";
      timeExitWouldHitBeforeBoundary: "YES" | "NO" | "UNKNOWN";
      diagnostic: string;
    }>;
  };
  grossPositiveNetNegative?: Array<{
    tradeId: string;
    symbol: string;
    strategy: string;
    grossPnL: number;
    entryFee: number;
    exitFee: number;
    totalFee: number;
    netPnL: number;
    feeToGrossRatio?: number;
    minimumGrossMovementToCoverFees: number;
  }>;
  feeByStrategy?: Array<{
    strategy: string;
    grossPnL: number;
    fees: number;
    netPnL: number;
    feePerTrade: number;
    grossPositiveNetNegativeCount: number;
    tradeCount: number;
  }>;
  feeByHoldTime?: Array<{
    holdBucket: string;
    tradeCount: number;
    grossPnL: number;
    fees: number;
    netPnL: number;
    avgFeePerTrade: number;
  }>;
  exitFeeInteraction?: Array<{
    tradeId: string;
    symbol: string;
    classification: "EXIT_CREATED_LOSS" | "FEE_CREATED_LOSS" | "BOTH" | "UNKNOWN";
    grossPnL: number;
    totalFee: number;
    netPnL: number;
    exitReason?: ExitReasonCode;
  }>;
};

export type MissedOpportunityStage =
  | "NOT_DISCOVERED"
  | "DISCOVERED_NOT_QUALIFIED"
  | "STRATEGY_REJECTED"
  | "EV_REJECTED"
  | "AI_REJECTED"
  | "CONSENSUS_REJECTED"
  | "RISK_REJECTED"
  | "SIZING_REJECTED"
  | "CAPITAL_SLOT_REJECTED"
  | "EXECUTION_FAILED"
  | "OTHER";

export type PaperSessionStatus =
  | "CREATED"
  | "RUNNING"
  | "ROUND_INITIALIZING"
  | "RUNNING_ROUND"
  | "EXIT_WAIT"
  | "COMPLETED"
  | "FAILED"
  | "STOPPED";

export type ForensicStage =
  | "scanner"
  | "candidate"
  | "strategy"
  | "ev"
  | "ai"
  | "consensus"
  | "decision"
  | "risk"
  | "sizing"
  | "execution"
  | "exit"
  | "simulation"
  | "pnl"
  | "session";

export type CandidateTerminalRecord = {
  candidateId: string;
  symbol: string;
  stage: ForensicStage;
  verdict: TerminalVerdict;
  reasonCode: string;
  reasonDetail: string;
  timestamp: string;
  strategyId?: string;
  rank?: number;
  metadata?: Record<string, unknown>;
};

export type ScannerSymbolRecord = {
  symbol: string;
  timestamp: string;
  market: string;
  quote: string;
  volume?: number;
  liquidity?: number;
  price?: number;
  change24h?: number;
  marketRegime?: string;
  qualification: TerminalVerdict;
  reasonCode: string;
  stageTimingsMs?: Record<string, number>;
};

export type ScannerCycleSummary = {
  cycleId: string;
  startedAt: string;
  endedAt: string;
  universeCount: number;
  eligibleCount: number;
  qualifiedCount: number;
  rejectedCount: number;
  rejectionReasons: Record<string, number>;
  durationMs: number;
  errorCount: number;
  retryCount: number;
  rateLimitCount: number;
  symbols: ScannerSymbolRecord[];
};

export type CandidateTraceRecord = {
  candidateId: string;
  symbol: string;
  strategyId?: string;
  strategyScore?: number;
  marketContext?: Record<string, unknown>;
  technicalInputs?: Record<string, unknown>;
  candidateTimestamp: string;
  source: string;
  ranking?: number;
  terminal?: CandidateTerminalRecord;
};

export type AiCallAudit = {
  callId: string;
  candidateId?: string;
  symbol: string;
  executionMode: AiExecutionMode;
  provider: string;
  model?: string | null;
  timestamp: string;
  latencyMs: number;
  remote?: boolean;
  success: boolean;
  degraded: boolean;
  healthState?: string;
  reason?: string;
  reasonCode?: string;
  reasonDetail?: string;
  healthBefore?: string;
  healthAfter?: string;
  requestStartedAt?: string;
  requestEndedAt?: string;
  responseReceived?: boolean;
  errorCode?: string;
  errorType?: string;
  retryCount?: number;
  finalHealth?: string;
};

export type ConsensusAudit = {
  consensusId: string;
  symbol: string;
  providerVotes: Record<string, string>;
  weights: Record<string, number>;
  confidence: number;
  masterRuleId?: string;
  finalDecision: string;
  reason: string;
  timestamp: string;
};

export type EvAudit = {
  candidateId: string;
  symbol: string;
  formulaVersion: string;
  winProbability?: number;
  expectedProfit?: number;
  expectedLoss?: number;
  fees?: number;
  expectedRiskReward?: number;
  expectedValue?: number;
  threshold?: number;
  verdict: TerminalVerdict;
  reasonCode: string;
  timestamp: string;
};

export type DecisionTraceRecord = {
  candidateId: string;
  symbol: string;
  stage: ForensicStage;
  verdict: DecisionVerdict;
  reasonCode: string;
  reasonDetail: string;
  rank?: number;
  capitalSlot?: number;
  score?: number;
  timestamp: string;
};

export type RiskSizingTrace = {
  candidateId: string;
  symbol: string;
  riskVerdict: TerminalVerdict;
  riskParameters?: Record<string, unknown>;
  requestedSize?: number;
  computedSize?: number;
  availableBalance?: number;
  maxSimultaneousPositions?: number;
  finalQuantity?: number;
  rejectionReason?: string;
  timestamp: string;
};

export type PaperOrderAudit = {
  candidateId?: string;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  quantity: number;
  fees: number;
  orderId?: string;
  fillId?: string;
  positionId?: string;
  roundId?: string;
  sessionId?: string;
  exchange: string;
  executionMode: "paper" | "live" | "dry-run";
  timestamp: string;
  reconciled: boolean;
  reconcileError?: string;
  aiVerdict?: string;
  executionVerdict?: AiExecutionGateVerdict;
  executionGateReasonCode?: string;
  feeMetrics?: FeeEdgeMetricsSnapshot;
};

export type PnlLedgerEntry = {
  tradeId: string;
  positionId?: string;
  symbol: string;
  roundId?: string;
  sessionId?: string;
  grossPnL: number;
  entryFee: number;
  exitFee: number;
  totalFee: number;
  netPnL: number;
  feeToGrossRatio?: number;
  feeEdgeClass?: "FEE_SAFE" | "FEE_BORDERLINE" | "FEE_EROSION" | "UNKNOWN";
  grossPositiveNetNegative?: boolean;
  feeReconciliationStatus: "PASS" | "FAIL" | "UNKNOWN";
  exitReason?: ExitReasonCode;
  exitModel?: ExitForensicRecord["exitModel"];
  exitForensics?: ExitForensicRecord;
  timestamp: string;
};

export type PnlLedgerSummary = {
  grossPnL: number;
  totalFees: number;
  netPnL: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  maxDrawdown: number;
  averageWin: number;
  averageLoss: number;
  consecutiveLosses: number;
  tradeCount: number;
  grossPositiveNetNegativeCount?: number;
  feeClassBreakdown?: Partial<Record<"FEE_SAFE" | "FEE_BORDERLINE" | "FEE_EROSION" | "UNKNOWN", number>>;
  exitModelBreakdown?: Partial<Record<"POSITION_MONITOR" | "REPLAY_WINDOW" | "MANUAL_TIMEOUT", number>>;
};

export type PaperSessionSnapshot = {
  sessionId: string;
  roundId?: string;
  status: PaperSessionStatus;
  currentStage?: ForensicStage;
  currentRound?: number;
  lastProgressAt: string;
  error?: string | null;
  updatedAt: string;
};

export type SimulationIntegrityReport = {
  sessionId: string;
  checkedAt: string;
  violations: Array<{
    code: string;
    message: string;
    stage: ForensicStage;
    decisionTimestamp: string;
    leakedTimestamp?: string;
  }>;
  passed: boolean;
};

export type NativePaperDiagnostics = {
  sessionId: string;
  generatedAt: string;
  scannerCount: number;
  candidateCount: number;
  strategyCount: number;
  evCount: number;
  aiCount: number;
  decisionCount: number;
  riskCount: number;
  sizingCount: number;
  orders: number;
  fills: number;
  positions: number;
  exits: number;
  rejectionCountsByStage: Record<string, number>;
  rejectionCountsByReason: Record<string, number>;
};

export type ResolvedConfigSnapshot = {
  generatedAt: string;
  configHash?: string;
  exchange: string;
  mode?: string;
  exchangeRouting?: {
    platform?: string;
    marketDataProvider?: string;
    metadataProvider?: string;
    paperExecutionProvider?: string;
    liveExecutionProvider?: string;
  };
  venueRouting?: {
    discoveryVenue?: string;
    marketDataVenue?: string;
    microstructureVenue?: string;
    metadataVenue?: string;
    paperExecutionVenue?: string;
    liveExecutionVenue?: string;
    platform?: string;
    lightSocketRole?: string;
    deepSocketRole?: string;
    maxControlCommandsPerSec?: number;
    officialMaxControlCommandsPerSec?: number;
  };
  aiPolicy?: string;
  tdiPolicy?: string;
  riskMode?: string;
  universe: Record<string, unknown>;
  aiMode: Record<string, unknown>;
  strategyConfig: Record<string, unknown>;
  evConfig: Record<string, unknown>;
  risk: Record<string, unknown>;
  sizing: Record<string, unknown>;
  fees: Record<string, unknown>;
  simulationWindow: Record<string, unknown>;
  maxPositions: number;
  timeframes: string[];
};

export type PreflightCheckStatus = "PASS" | "WARN" | "FAIL";

export type PreflightCheckResult = {
  status: PreflightCheckStatus;
  reasonCode: string;
  reasonDetail: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type PreflightOverallVerdict = "READY" | "BLOCKED" | "DEGRADED";

export type PaperRoundReconciliationRecord = {
  roundId: string;
  jobId: string;
  previousState: string;
  newState: string;
  reasonCode: string;
  reasonDetail: string;
  timestamp: string;
};

export type PaperJobReconciliationRecord = {
  jobId: string;
  previousStatus: string;
  newStatus: string;
  reasonCode: string;
  reasonDetail: string;
  timestamp: string;
};

export type PaperPreflightArtifact = {
  attemptId: string;
  userId: string;
  generatedAt: string;
  overallVerdict: PreflightOverallVerdict;
  canStart: boolean;
  blockReason?: string | null;
  blockCode?: string | null;
  database: PreflightCheckResult;
  binance: PreflightCheckResult;
  ai: PreflightCheckResult;
  emergencyStop: PreflightCheckResult;
  activeJobs: PreflightCheckResult;
  zombieRounds: PreflightCheckResult;
  workerLocks: PreflightCheckResult;
  resolvedConfig: PreflightCheckResult;
  duplicatePaperJobs: PreflightCheckResult;
  clockSync: PreflightCheckResult;
  reconciledRounds: PaperRoundReconciliationRecord[];
  reconciledJobs: PaperJobReconciliationRecord[];
};

export type ValidationDbReadiness = {
  status: "PASS" | "FAIL";
  reasonCode: string;
  reasonDetail: string;
  checkedAt: string;
  databaseUrlConfigured: boolean;
  requiredTables: Array<{ table: string; exists: boolean }>;
  missingTables: string[];
  migrationTablePresent: boolean;
  latestMigration?: string | null;
};

export type PreValidationGateCheckStatus = "PASS" | "FAIL" | "WARN" | "NOT_RECORDED";

export type PreValidationGateCheck = {
  code: string;
  status: PreValidationGateCheckStatus;
  detail: string;
  metadata?: Record<string, unknown>;
};

export type PreValidationGateResult = {
  status: "READY" | "NOT_READY";
  checkedAt: string;
  blockers: string[];
  checks: PreValidationGateCheck[];
};

// Backward-compatible exports for modules that still import these from forensic.types.
export type ForensicSessionContext = import("./forensic-context").ForensicSessionContext;
export type ScannerDecisionObservabilityInput =
  import("@/src/server/observability/decision-observability.types").ScannerDecisionObservabilityInput;

export const FORENSIC_ARTIFACT_CAPS = {
  scannerSymbolsPerCycle: 200,
  candidateTracePerSession: 500,
  aiCallsPerSession: 300,
  decisionRecordsPerSession: 500,
  missedOpportunitiesPerSession: 200,
  tdiDecisionRecordsPerSession: 500,
} as const;

export type TdiWaitReasonCode = "NO_SLOT" | "BELOW_THRESHOLD" | "NEUTRAL" | "RISK" | "COOLDOWN" | "OTHER";

export type TdiDecisionVerdict = "APPROVED" | "WAIT" | "REJECTED";
export type TdiFirstBlockingCondition =
  | "MOMENTUM"
  | "TECHNICAL"
  | "MTF_ALIGNMENT"
  | "RISK"
  | "COOLDOWN"
  | "NO_SLOT"
  | "LEARNING"
  | "CONFIDENCE"
  | "NEUTRAL"
  | "OTHER";

export type TdiScoreType = "HYBRID_COMPOSITE" | "MASTER_EXPERT_AVERAGE" | "UNKNOWN";

export type TdiProductionReplayStatus = "COMPLETE" | "PARTIAL" | "INCOMPLETE";
export type TdiInputValueStatus = "AVAILABLE" | "MISSING" | "STALE" | "INVALID" | "NOT_APPLICABLE" | "UNKNOWN";
export type TdiBlockClassification = "DATA_QUALITY_BLOCK" | "POLICY_BLOCK";

export type TdiInputField<T = unknown> = {
  value: T | null;
  status: TdiInputValueStatus;
  source?: string;
  note?: string;
};

export type TdiInputContract = {
  technicalScore: TdiInputField<number>;
  momentumScore: TdiInputField<number>;
  sentimentScore: TdiInputField<number>;
  shortMomentum: TdiInputField<number>;
  shortFlowImbalance: TdiInputField<number>;
  executionScore: TdiInputField<number>;
  confidence: TdiInputField<number>;
  bullishCount: TdiInputField<number>;
  learningScore: TdiInputField<number>;
  regime: TdiInputField<string>;
  regimeDelta: TdiInputField<TdiDecisionRecord["regimeDelta"]>;
  thresholds: TdiInputField<TdiDecisionRecord["thresholds"]>;
  liquidity: TdiInputField<number>;
  volatility: TdiInputField<number>;
  expectedValue: TdiInputField<number>;
  openInterest: TdiInputField<number>;
  marketContext: TdiInputField<string>;
  simulation: TdiInputField<string>;
  trendData: TdiInputField<string>;
};

export const TDI_DECISION_SCHEMA_VERSION = "tdi-decision-v2" as const;

export type TdiDecisionRecord = {
  candidateId: string;
  symbol: string;
  verdict: TdiDecisionVerdict;
  reasonCode?: string;
  waitReasonCode?: TdiWaitReasonCode;
  firstBlockingCondition?: TdiFirstBlockingCondition;
  blockingConditions?: TdiFirstBlockingCondition[];
  masterDecision?: string;
  hybridDecision?: string;
  finalDecision?: string;
  legacyDecision?: string;
  hybridRejected?: boolean;
  /** @deprecated Use hybridCompositeScore or masterExpertConsensusScore with scoreType. */
  consensusScore?: number;
  hybridCompositeScore?: number | null;
  masterExpertConsensusScore?: number | null;
  scoreType?: TdiScoreType;
  technicalScore?: number;
  momentumScore?: number;
  sentimentScore?: number;
  shortMomentum?: number;
  shortFlow?: number;
  executionScore?: number;
  confidence?: number;
  bullishCount?: number;
  learningScore?: number;
  liquidity?: number;
  volatility?: number;
  expectedValue?: number;
  openInterest?: number;
  marketContext?: string;
  simulation?: string;
  trendData?: string;
  thresholds?: {
    technicalMinScore?: number;
    sentimentMinScore?: number;
    compositeMinScore?: number;
    confidenceMinScore?: number;
  };
  regime?: string;
  regimeDelta?: {
    technical?: number;
    sentiment?: number;
    composite?: number;
  };
  paperRelaxed?: boolean;
  learningLane?: boolean;
  tdiInputContract?: TdiInputContract;
  missingFields?: string[];
  dataQualityIssues?: string[];
  blockClassification?: TdiBlockClassification;
  dataQualityBlock?: boolean;
  policyBlock?: boolean;
  rank?: number;
  capitalSlot?: number;
  maxSlots?: number;
  openPositionCount?: number;
  strategy?: string;
  forensicRegime?: ForensicRegimeClass;
  reasonDetail: string;
  timestamp: string;
};

export type TdiDecisionArtifact = {
  schemaVersion: typeof TDI_DECISION_SCHEMA_VERSION;
  records: TdiDecisionRecord[];
};

export type SlotCandidateSnapshot = {
  symbol: string;
  rank: number;
  score: number;
  strategy: string;
  regime: string;
  reason: string;
  tdiVerdict?: TdiDecisionVerdict;
  waitReasonCode?: TdiWaitReasonCode;
};

export type SlotOpportunityRow = {
  slotIndex: number;
  selected: SlotCandidateSnapshot;
  nextBest?: SlotCandidateSnapshot & { scoreGap: number };
};

export type SlotOpportunityReport = {
  generatedAt: string;
  maxPositions: number;
  selectedCount: number;
  waitCount: number;
  rows: SlotOpportunityRow[];
  deterministicHash: string;
};

export type StrategyComparisonPolicyFlags = {
  regimeGating?: boolean;
  feeFloor?: boolean;
  entryTimingProtection?: boolean;
};

export type StrategyComparisonConfig = {
  label: string;
  policyFlags: StrategyComparisonPolicyFlags;
};

export type StrategyComparisonMetrics = {
  sampleSize: number;
  tradeCount: number;
  winRate: number;
  grossPnL: number;
  fees: number;
  netPnL: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  feeDragRatio: number;
};

export type StrategyComparisonReport = {
  generatedAt: string;
  baseline: StrategyComparisonConfig & { metrics: StrategyComparisonMetrics };
  candidate: StrategyComparisonConfig & { metrics: StrategyComparisonMetrics };
  delta: Partial<StrategyComparisonMetrics>;
  evidenceRefs: string[];
  deterministicHash: string;
  promotionReady: false;
};

export type FeeAwareEntryPolicyVerdict = "OBSERVE" | "PASS" | "BLOCK";

export type FeeAwareEntryPolicyEvaluation = {
  policyVersion: string;
  verdict: FeeAwareEntryPolicyVerdict;
  feeEdgeClass?: "FEE_SAFE" | "FEE_BORDERLINE" | "FEE_EROSION" | "UNKNOWN";
  expectedGrossToFeeRatio: number;
  minimumGrossToCoverFees: number;
  estimatedRoundTripFees: number;
  expectedNetAfterFeesAtTp: number;
  minGrossToFeeRatio?: number;
  minGrossToFeeRatioSource?: string;
  blockingEnabled: boolean;
  reasonCode: string;
  reasonDetail: string;
  timestamp: string;
};

export type VolatilityBreakoutValidationReport = {
  generatedAt: string;
  strategy: string;
  sampleSize: number;
  tradeCount: number;
  winRate: number;
  netPnL: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  sufficientData: boolean;
  minimumSampleRequired: number;
  recommendation: "INSUFFICIENT_DATA" | "NEUTRAL" | "FAVOR_MORE_RESEARCH";
  reasonDetail: string;
  deterministicHash: string;
};

export type P2PromotionGate = {
  changeId: string;
  description: string;
  before: StrategyComparisonMetrics;
  after: StrategyComparisonMetrics;
  sampleSize: number;
  riskImpact: string;
  feeImpact: string;
  acceptanceTest: string;
  promoted: false;
};

export type EvComponentContribution = {
  component: string;
  weight: number;
  range: { min: number; max: number };
  observedContribution: number;
  evidenceQuality: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
  reasonDetail: string;
};

export type EvComponentAttributionReport = {
  generatedAt: string;
  formulaVersion: string;
  sampleSize: number;
  components: EvComponentContribution[];
  dominantComponent?: string;
  deterministicHash: string;
};

export type MrRegimeGatingExperimentReport = {
  generatedAt: string;
  baselineLabel: "CURRENT_MR";
  candidateLabel: "MR_WITH_REGIME_FILTER";
  baseline: StrategyComparisonMetrics;
  candidate: StrategyComparisonMetrics;
  delta: Partial<StrategyComparisonMetrics>;
  filteredRegimes: ForensicRegimeClass[];
  sampleSize: number;
  confidence: "INSUFFICIENT" | "LOW" | "MEDIUM" | "HIGH";
  riskImpact: string;
  missedOpportunities: number;
  promotionStatus: PromotionGateStatus;
  deterministicHash: string;
};

export type OpportunityFunnelStage =
  | "DISCOVERED"
  | "STRATEGY_QUALIFIED"
  | "TDI"
  | "SIZING"
  | "AI"
  | "RISK"
  | "EXECUTION";

export type OpportunityLossReason =
  | "NOT_DISCOVERED"
  | "FILTERED_OUT"
  | "TDI_WAIT"
  | "NO_SLOT"
  | "SIZING"
  | "AI_REJECTED"
  | "RISK"
  | "EXECUTION_FAILED"
  | "TRADED"
  | "UNKNOWN";

export type OpportunityFunnelRow = {
  stage: OpportunityFunnelStage | "TOTAL";
  entered: number;
  lost: number;
  lostReason: OpportunityLossReason;
  count: number;
  percentage: number;
  evidenceCompleteness: "COMPLETE" | "PARTIAL" | "INSUFFICIENT";
};

export type OpportunityFunnelReport = {
  generatedAt: string;
  totalDiscovered: number;
  traded: number;
  stages: OpportunityFunnelRow[];
  lossByReason: Partial<Record<OpportunityLossReason, { count: number; percentage: number }>>;
  deterministicHash: string;
};

export type LossPatternCode =
  | "NORMAL_VARIANCE"
  | "ENTRY_TIMING"
  | "REGIME_MISMATCH"
  | "STRATEGY_WEAKNESS"
  | "AI_MISJUDGMENT"
  | "RISK_ISSUE"
  | "FEE_DRAG"
  | "EXIT_PROBLEM"
  | "UNKNOWN";

export type WinPatternConfidence = "FACT" | "REPEATED_PATTERN" | "HYPOTHESIS";

export type TradePatternClassification = {
  tradeId: string;
  symbol: string;
  strategy: string;
  regime: string;
  classification: LossPatternCode | WinPatternConfidence;
  evidence: string[];
  netPnL: number;
};

export type TradePatternReport = {
  generatedAt: string;
  sampleSize: number;
  classifications: TradePatternClassification[];
  summary: Partial<Record<string, number>>;
  deterministicHash: string;
};

export type StrategyRegimeMatrixCell = {
  strategy: string;
  regime: ForensicRegimeClass | "UNKNOWN";
  tradeCount: number;
  winRate: number;
  grossPnL: number;
  fees: number;
  netPnL: number;
  expectancy: number;
  profitFactor: number;
  sampleSize: number;
  sampleLabel: "SUFFICIENT" | "NOT_ENOUGH_DATA";
  maxDrawdown?: number;
};

export type StrategyRegimeMatrixReport = {
  generatedAt: string;
  cells: StrategyRegimeMatrixCell[];
  deterministicHash: string;
};

export type FeeEdgeClassification = "FEE_SAFE" | "FEE_BORDERLINE" | "FEE_EROSION" | "UNKNOWN";

export type FeeAwareEdgeResearchRow = {
  candidateId?: string;
  symbol: string;
  strategy?: string;
  expectedGross: number;
  expectedRoundTripFee: number;
  expectedNet: number;
  edgeAfterFees: number;
  classification: FeeEdgeClassification;
  evidenceQuality: "HIGH" | "MEDIUM" | "LOW" | "INSUFFICIENT";
};

export type FeeAwareEdgeResearchReport = {
  generatedAt: string;
  sampleSize: number;
  rows: FeeAwareEdgeResearchRow[];
  summary: Partial<Record<FeeEdgeClassification, number>>;
  deterministicHash: string;
};

export type PromotionGateStatus = "PROMOTABLE" | "RESEARCH_ONLY" | "REJECTED";

export type PromotionGateEvaluation = {
  changeId: string;
  description: string;
  status: PromotionGateStatus;
  before: StrategyComparisonMetrics;
  after: StrategyComparisonMetrics;
  sampleSize: number;
  criteria: Array<{ rule: string; passed: boolean; detail: string }>;
  riskImpact: string;
  feeImpact: string;
  acceptanceTest: string;
  promoted: false;
  deterministicHash: string;
};

export type NoSlotClassification = "JUSTIFIED_NO_SLOT" | "POSSIBLE_MISSED_SLOT" | "UNKNOWN";

export type NoSlotCandidateRecord = {
  candidateId: string;
  symbol: string;
  rank: number;
  score: number;
  reasonCode: TdiWaitReasonCode;
  strategy?: string;
  regime?: string;
  ev?: number;
  oi?: number;
  classification: NoSlotClassification;
  evidence: string[];
  postEntryMovePercent?: number;
};

export type SlotAllocationAnalysisReport = {
  generatedAt: string;
  maxPositions: number;
  approvedCount: number;
  waitCount: number;
  noSlotCandidates: NoSlotCandidateRecord[];
  roundRows: SlotOpportunityRow[];
  deterministicHash: string;
};

export type SlotAllocationExperimentReport = {
  generatedAt: string;
  baselineLabel: string;
  experimentLabel: string;
  baselineMaxPositions: number;
  experimentMaxPositions: number;
  baseline: StrategyComparisonMetrics & { capitalUtilization: number; missedOpportunities: number; riskExposure: number };
  experiment: StrategyComparisonMetrics & { capitalUtilization: number; missedOpportunities: number; riskExposure: number };
  delta: Partial<StrategyComparisonMetrics>;
  promotionStatus: PromotionGateStatus;
  note: string;
  deterministicHash: string;
};

export type TdiSensitivityPoint = {
  thresholdDelta: number;
  effectiveThreshold: number;
  /** Score ≥ effectiveThreshold / scored sample size (counterfactual). */
  scoreAboveThresholdRate: number;
  /** Production-style replay approval rate at this threshold slice. */
  runtimeApprovalEquivalentRate: number;
  waitRate: number;
  noSlotRate: number;
  falsePositiveEstimate: number;
  falseNegativeEstimate: number;
  sampleSize: number;
  /** @deprecated Use scoreAboveThresholdRate — previously mislabeled as approval. */
  approvalRate: number;
};

export const TDI_SENSITIVITY_SCHEMA_VERSION = "tdi-sensitivity-v2" as const;

export type TdiSensitivityReport = {
  schemaVersion: typeof TDI_SENSITIVITY_SCHEMA_VERSION;
  generatedAt: string;
  currentThreshold: number;
  scoreDistribution: { min: number; max: number; mean: number; p50: number; p75: number; p90: number };
  scoreAboveThresholdCount: number;
  scoreAboveThresholdRate: number;
  runtimeApprovalEquivalentCount: number;
  runtimeApprovalEquivalentRate: number;
  runtimeWaitCount: number;
  runtimeRejectedCount: number;
  productionReplayStatus: TdiProductionReplayStatus;
  productionReplayReason?: string;
  scoreThresholdExplanation: string;
  waitDistribution: Partial<Record<TdiWaitReasonCode, number>>;
  firstBlockingDistribution?: Partial<Record<TdiFirstBlockingCondition, number>>;
  blockClassificationDistribution?: Partial<Record<TdiBlockClassification, number>>;
  dataQualityBlockCount?: number;
  policyBlockCount?: number;
  sensitivityPoints: TdiSensitivityPoint[];
  recommendation: "NO_CHANGE" | "RESEARCH_ONLY" | "INSUFFICIENT_DATA";
  deterministicHash: string;
  /** @deprecated Use runtimeApprovalEquivalentRate — actual recorded TDI APPROVED rate. */
  approvalRate: number;
  compatibility: {
    approvalRateMeans: "runtimeApprovalEquivalentRate";
    scoreThresholdPassField: "scoreAboveThresholdRate";
    legacyApprovalRateWas: "mixed score threshold counterfactual (misleading)";
  };
};

export type VolatilityBreakoutBreakdownRow = {
  dimension: "regime" | "volatility" | "liquidity" | "momentum" | "exitType";
  bucket: string;
  tradeCount: number;
  winRate: number;
  netPnL: number;
  expectancy: number;
  sampleLabel: "SUFFICIENT" | "NOT_ENOUGH_DATA";
};

export type FeeEdgeExperimentClass = "FEE_SAFE" | "FEE_BORDERLINE" | "FEE_EROSION";

export type FeeAwareEntryExperimentReport = {
  generatedAt: string;
  baseline: StrategyComparisonMetrics;
  experiment: StrategyComparisonMetrics;
  delta: Partial<StrategyComparisonMetrics>;
  classificationSummary: Partial<Record<FeeEdgeExperimentClass, number>>;
  promotionStatus: PromotionGateStatus;
  blockingEnabledInProduction: false;
  deterministicHash: string;
};

export type EntryTimingExperimentReport = {
  generatedAt: string;
  baselineLabel: "CURRENT_ENTRY";
  experimentLabel: "CONTROLLED_ENTRY_PROTECTION";
  baseline: StrategyComparisonMetrics;
  experiment: StrategyComparisonMetrics;
  delta: Partial<StrategyComparisonMetrics>;
  lateEntryCount: number;
  promotionStatus: PromotionGateStatus;
  deterministicHash: string;
};

export type AiStrategyInteractionRow = {
  strategy: string;
  regime: string;
  aiVerdict: string;
  tradeCount: number;
  winRate: number;
  netPnL: number;
  expectancy: number;
  sampleLabel: "SUFFICIENT" | "NOT_ENOUGH_DATA";
};

export type AiStrategyInteractionReport = {
  generatedAt: string;
  rows: AiStrategyInteractionRow[];
  summary: {
    approvePositiveExpectancy: boolean | null;
    vetoRemovedGoodTrades: boolean | null;
    evidenceQuality: "INSUFFICIENT" | "PARTIAL" | "COMPLETE";
  };
  deterministicHash: string;
};

export type OpportunityValueStage = "SCANNER" | "TDI" | "SLOT" | "SIZING" | "AI" | "RISK" | "EXECUTION";

export type OpportunityValueRow = {
  stage: OpportunityValueStage;
  reason: string;
  symbol: string;
  postEntryMovePercent?: number;
  estimatedOpportunityValue: number;
  analysisScope: "POST_ENTRY_ANALYSIS";
};

export type OpportunityValueReport = {
  generatedAt: string;
  rows: OpportunityValueRow[];
  rankedByStage: Partial<Record<OpportunityValueStage, { count: number; totalEstimatedValue: number }>>;
  deterministicHash: string;
};

export type ProfitabilityExperimentRecord = {
  experimentId: string;
  baseline: string;
  variant: string;
  hypothesis: string;
  parameters: Record<string, unknown>;
  sample: number;
  metrics: StrategyComparisonMetrics;
  risk: { maxDrawdown: number; riskExposure?: number };
  result: PromotionGateStatus;
  promotionStatus: PromotionGateStatus;
  acceptanceTest: string;
};

export type ProfitabilityExperimentRegistry = {
  generatedAt: string;
  experiments: ProfitabilityExperimentRecord[];
  safetyPreserved: {
    aiGate: true;
    riskGate: true;
    sizingGate: true;
    executionIntegrity: true;
    pnlReconciliation: true;
  };
  deterministicHash: string;
};

export type P2ForensicSessionBundle = {
  tdiDecisions: TdiDecisionRecord[];
  slotOpportunity: SlotOpportunityReport;
  slotAllocationAnalysis: SlotAllocationAnalysisReport;
  slotAllocationExperiment: SlotAllocationExperimentReport;
  tdiSensitivity: TdiSensitivityReport;
  strategyComparison: StrategyComparisonReport;
  singleChangeExperiments: StrategyComparisonReport[];
  feePolicySamples: FeeAwareEntryPolicyEvaluation[];
  feeAwareEntryExperiment: FeeAwareEntryExperimentReport;
  entryTimingExperiment: EntryTimingExperimentReport;
  volatilityBreakout: VolatilityBreakoutValidationReport;
  aiStrategyInteraction: AiStrategyInteractionReport;
  opportunityValue: OpportunityValueReport;
  strategyRegimeMatrix: StrategyRegimeMatrixReport;
  experimentRegistry: ProfitabilityExperimentRegistry;
  promotionGate: PromotionGateEvaluation;
  promotionDecisions: Array<{ changeId: string; status: PromotionGateStatus; reason: string }>;
  baselineMetrics?: {
    generatedAt: string;
    tradeCount: number;
    winRate: number;
    grossPnL: number;
    fees: number;
    netPnL: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdown: number;
    averageWin: number;
    averageLoss: number;
    averageHold: number;
    medianHold: number;
    aiAlignment: string;
    entryQuality: string;
    exitModelQuality: string;
    feeStatus: string;
    scannerDiscoveryQuality: string;
  };
  outOfSampleEvaluation?: {
    available: boolean;
    reason?: string;
    split?: { inSampleCount: number; outOfSampleCount: number };
    support?: { expectancyImproved: boolean; drawdownSafe: boolean; supported: boolean };
    inSample?: {
      baseline: StrategyComparisonMetrics;
      candidate: StrategyComparisonMetrics;
      delta: Partial<StrategyComparisonMetrics>;
    };
    outOfSample?: {
      baseline: StrategyComparisonMetrics;
      candidate: StrategyComparisonMetrics;
      delta: Partial<StrategyComparisonMetrics>;
    };
  };
  profitConcentration?: {
    available: boolean;
    reason?: string;
    totalPositiveTrades?: number;
    totalPositiveNetPnL?: number;
    top1TradeContributionPct: number;
    top3TradeContributionPct: number;
    topSymbol?: string | null;
    topSymbolContributionPct: number;
    topStrategy?: string | null;
    topStrategyContributionPct: number;
    topRegime?: string | null;
    topRegimeContributionPct: number;
    concentrationClass: "REAL_EDGE" | "SINGLE_TRADE_LUCK" | "UNKNOWN";
  };
  candidateQualityFactors?: {
    generatedAt: string;
    winners: Record<string, number>;
    losers: Record<string, number>;
    deltas: Record<string, number>;
    evidenceClass: "FACT" | "REPEATED_PATTERN" | "HYPOTHESIS";
  };
  trendFollowingValidation?: {
    generatedAt: string;
    strategyCount: number;
    tradeCount: number;
    netPnL: number;
    expectancy: number;
    verdict: "NOT_PROVEN" | "PROMISING" | "MIXED";
    reason: string;
  };
};
