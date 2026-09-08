export type AlphaSide = "LONG" | "SHORT" | "CASH";

export type DataAvailabilityState = "AVAILABLE" | "UNAVAILABLE" | "DEGRADED" | "STALE";

export type AlphaStatus =
  | "EXPERIMENTAL"
  | "VALIDATION_FAIL"
  | "VALIDATION_PASS"
  | "FINAL_FAIL"
  | "FINAL_PASS"
  | "ROBUSTNESS_FAIL"
  | "ROBUSTNESS_PASS"
  | "PAPER_READY"
  | "PAPER_PASS"
  | "LIVE_ELIGIBLE";

export type DataKind =
  | "OHLCV"
  | "FUNDING"
  | "BASIS"
  | "OPEN_INTEREST"
  | "TAKER_FLOW"
  | "AGG_TRADES"
  | "ORDER_BOOK"
  | "LIQUIDATION"
  | "MARK_PRICE"
  | "INDEX_PRICE"
  | "BTC_CONTEXT"
  | "CROSS_SECTIONAL";

export type DataRequirement = {
  kind: DataKind;
  minFreshnessMs?: number;
  granularity?: string;
};

export type FeatureUnit = "percentage" | "ratio" | "bps" | "absolute" | "normalized";

export type FeatureValue = {
  name: string;
  value: number;
  unit: FeatureUnit;
  scale: string;
  timestamp: number;
  source: string;
  freshnessMs: number;
};

export type AlphaSignal = {
  alphaId: string;
  module: string;
  version: string;
  symbol: string;
  venue: string;
  side: AlphaSide;
  timestamp: number;
  horizon: string;
  confidence: number;
  expectedEdgeBps: number;
  expectedCostBps: number;
  expectedNetEdgeBps: number;
  reasonCodes: string[];
  metadata: Record<string, unknown>;
};

export type AlphaEvaluation = {
  alphaId: string;
  module: string;
  version: string;
  timestamp: number;
  signal: AlphaSignal | null;
  noSignalReason?: string;
  features: FeatureValue[];
  dataStates: Record<DataKind, DataAvailabilityState>;
};

export type AlphaContext = {
  timestamp: number;
  symbol: string;
  venue: string;
  features: Map<string, FeatureValue>;
  dataStates: Record<DataKind, DataAvailabilityState>;
  metadata?: Record<string, unknown>;
};

export type AlphaModule = {
  id: string;
  version: string;
  requiredData: DataRequirement[];
  supportedVenues: string[];
  supportedSides: AlphaSide[];
  holdingHorizon: string;
  evaluate: (input: AlphaContext) => Promise<AlphaEvaluation> | AlphaEvaluation;
};

export type AlphaTradeRecord = {
  entryTime: number;
  exitTime: number;
  symbol: string;
  side: AlphaSide;
  grossReturnPct: number;
  fundingPnlPct: number;
  feeCostPct: number;
  netReturnPct: number;
  split: "TRAIN" | "VALIDATION" | "TEST";
  alphaId: string;
  note?: string;
};

export type AlphaExperimentStats = {
  trades: number;
  wins: number;
  losses: number;
  grossPnl: number;
  netPnl: number;
  expectancy: number;
  profitFactor: number;
  maxDrawdown: number;
  longTrades: number;
  shortTrades: number;
  cashSkips: number;
};

export type AlphaScoreboardEntry = {
  alphaId: string;
  version: string;
  datasetId: string;
  configHash: string;
  featureVersion: string;
  costModelVersion: string;
  validationTrades: number;
  validationExpectancy: number | null;
  validationProfitFactor: number | null;
  validationNetPnl: number | null;
  testTrades: number;
  testExpectancy: number | null;
  testProfitFactor: number | null;
  testNetPnl: number | null;
  maxDrawdown: number | null;
  status: AlphaStatus;
  edgeConfidence: "HIGH" | "LOW" | "NONE";
  robustnessPassed: boolean;
};

export type PortfolioDecision = {
  accepted: boolean;
  symbol: string;
  side: AlphaSide;
  alphaId: string;
  notional: number;
  reasonCodes: string[];
  rejectedBecause?: string;
};

export type AiOverlayDecision = "ALLOW" | "REDUCE" | "VETO";

export type AiOverlayResult = {
  decision: AiOverlayDecision;
  confidenceAdjustment: number;
  reasonCodes: string[];
};
