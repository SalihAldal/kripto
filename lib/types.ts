export type TradeSide = "BUY" | "SELL";
export type PositionStatus = "OPEN" | "CLOSED";

export type MarketTicker = {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  updatedAt: string;
};

export type AiVote = {
  model: string;
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  reason: string;
};

export type AiConsensus = {
  symbol: string;
  finalSignal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  votes: AiVote[];
  marketMode?: string;
  marketModeReason?: string;
  selectedStrategy?: string;
  marketRegimeProfile?: {
    regimeName: string;
    confidenceScore: number;
    allowedStrategyTypes: string[];
    forbiddenStrategyTypes: string[];
    tradingAggressiveness: "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH";
    marketSummary: string;
    entryThresholdScore: number;
  };
  executionAction?: "OPEN" | "SKIP";
  executionReason?: string;
  noTradeMode?: {
    enabled: boolean;
    reasonList: string[];
    blockedByAi: Array<"AI-1_TECHNICAL" | "AI-2_SENTIMENT" | "AI-3_RISK">;
    retryLaterSuggestion: string;
    marketNotSuitableSummary: string;
  };
  consensusEngine?: {
    finalDecision: "BUY" | "WATCHLIST" | "NO-TRADE" | "REJECT";
    decisionConfidence: number;
    alignedFactors: string[];
    conflictingFactors: string[];
    vetoStatus: {
      vetoed: boolean;
      blockedBy: Array<"AI-1_TECHNICAL" | "AI-2_SENTIMENT" | "AI-3_RISK" | "MARKET_REGIME" | "TRADE_QUALITY" | "SELF_CRITIC">;
      vetoReason?: string;
    };
    reasonedFinalReport: string;
  };
  selfCriticReview?: {
    criticismPoints: string[];
    hiddenRisks: string[];
    confidenceAdjusted: number;
    overrideSuggestion: "KEEP_BUY" | "DOWNGRADE_WATCHLIST" | "DOWNGRADE_NO_TRADE";
    finalApprovalOrDowngrade: "APPROVED" | "DOWNGRADED_WATCHLIST" | "DOWNGRADED_NO_TRADE";
  };
  liquidityZones?: Array<{
    level: number;
    type: "equal_high" | "equal_low" | "wick_cluster";
    strength: number;
    note: string;
  }>;
  riskyAreas?: Array<{
    label: string;
    level: number;
    reason: string;
  }>;
  liquidityIntel?: {
    probableStopClusters: Array<{
      level: number;
      side: "ABOVE_EQUAL_HIGHS" | "BELOW_EQUAL_LOWS";
      intensity: number;
    }>;
    sweepDetected: boolean;
    fakeBreakoutRisk: number;
    safeEntryTiming: string;
    liquidityRiskScore: number;
    trappedTradersScenario: string;
    breakoutTrap: boolean;
    rangeLiquidityGrab: boolean;
    smartMoneyStyleSummary: string;
  };
  safeEntryPoint?: number | null;
  entryRejectReason?: string;
  timeframeAnalysis?: {
    higher: {
      d1: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
      h4: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
      trend: "BULLISH" | "BEARISH" | "RANGE";
      confidence: number;
    };
    mid: {
      h1: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
      structure: "TREND_CONTINUATION" | "POTENTIAL_REVERSAL" | "RANGE";
      momentumBias: "BULLISH" | "BEARISH" | "RANGE";
    };
    lower: {
      m15: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
      m5: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
      entryQuality: "HIGH" | "MEDIUM" | "LOW";
    };
    entry: {
      m15: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
      m5: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
    };
    trend: {
      h1: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
    };
    macro: {
      h4: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
      d1: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number };
    };
    dominantTrend: "BULLISH" | "BEARISH" | "RANGE";
    alignmentScore: number;
    trendAligned: boolean;
    entrySuitable: boolean;
    conflict: boolean;
    conflictingSignals: string[];
    finalAlignmentSummary: string;
    reason: string;
  };
  createdAt: string;
};

export type TradeRecord = {
  id: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  openPrice: number;
  closePrice?: number;
  status: PositionStatus;
  pnl?: number;
  pnlPercent?: number;
  createdAt: string;
  closedAt?: string;
};

export type SystemLogLevel = "INFO" | "WARN" | "ERROR" | "TRADE" | "SIGNAL";

export type SystemLog = {
  id: string;
  level: SystemLogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
};
