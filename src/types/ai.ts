export type AIDecision = "BUY" | "SELL" | "HOLD" | "NO_TRADE";

export type AIRecommendedAction =
  | "BUY"
  | "SELL"
  | "HOLD"
  | "NO_TRADE";

export type AIStandardizedOutput = {
  symbol: string;
  timestamp: string;
  timeframeContext: {
    higher: string;
    mid: string;
    lower: string;
    alignmentSummary: string;
  };
  coreThesis: string;
  bullishFactors: string[];
  bearishFactors: string[];
  confidenceScore: number;
  riskFlags: string[];
  noTradeTriggers: string[];
  recommendedAction: AIRecommendedAction;
  explanationSummary: string;
};

export type AIModelOutput = {
  decision: AIDecision;
  confidence: number;
  targetPrice: number | null;
  stopPrice: number | null;
  estimatedDurationSec: number;
  reasoningShort: string;
  riskScore: number;
  standardizedOutput?: AIStandardizedOutput;
  metadata: Record<string, unknown>;
};

export type TechnicalSnapshot = {
  symbol: string;
  lastPrice: number;
  spread: number;
  volatility: number;
  averageVolume: number;
};

export type AIAnalysisInput = {
  symbol: string;
  lastPrice: number;
  klines: Array<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    openTime: number;
    closeTime: number;
  }>;
  volume24h: number;
  orderBookSummary: {
    bestBid: number;
    bestAsk: number;
    bidDepth: number;
    askDepth: number;
  };
  recentTradesSummary: {
    buyVolume: number;
    sellVolume: number;
    buySellRatio: number;
  };
  spread: number;
  volatility: number;
  marketSignals?: {
    change24h?: number;
    shortMomentumPercent?: number;
    shortFlowImbalance?: number;
    tradeVelocity?: number;
    btcDominanceBias?: number;
    socialSentimentScore?: number;
    newsSentiment?: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  };
  marketRegime?: {
    mode:
      | "STRONG_BULLISH_TREND"
      | "WEAK_BULLISH_TREND"
      | "STRONG_BEARISH_TREND"
      | "WEAK_BEARISH_TREND"
      | "RANGE_SIDEWAYS"
      | "HIGH_VOLATILITY_CHAOS"
      | "LOW_VOLUME_DEAD_MARKET"
      | "NEWS_DRIVEN_UNSTABLE";
    confidenceScore?: number;
    reason: string;
    marketSummary?: string;
    selectedStrategy: string;
    allowedStrategyTypes?: string[];
    forbiddenStrategyTypes?: string[];
    tradingAggressiveness?: "VERY_LOW" | "LOW" | "MEDIUM" | "HIGH";
    entryThresholdScore?: number;
    openTradeAllowed: boolean;
    tpMultiplier: number;
    slMultiplier: number;
    riskMultiplier: number;
  };
  multiTimeframe?: {
    higher: {
      d1: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number; lastClose: number };
      h4: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number; lastClose: number };
      trend: "BULLISH" | "BEARISH" | "RANGE";
      confidence: number;
    };
    mid: {
      h1: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number; lastClose: number };
      structure: "TREND_CONTINUATION" | "POTENTIAL_REVERSAL" | "RANGE";
      momentumBias: "BULLISH" | "BEARISH" | "RANGE";
    };
    lower: {
      m15: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number; lastClose: number };
      m5: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number; lastClose: number };
      entryQuality: "HIGH" | "MEDIUM" | "LOW";
    };
    entry: {
      m15: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number; lastClose: number };
      m5: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number; lastClose: number };
    };
    trend: {
      h1: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number; lastClose: number };
    };
    macro: {
      h4: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number; lastClose: number };
      d1: { direction: "BULLISH" | "BEARISH" | "RANGE"; strength: number; slopePercent: number; lastClose: number };
    };
    dominantTrend: "BULLISH" | "BEARISH" | "RANGE";
    alignmentScore: number;
    conflict: boolean;
    trendAligned: boolean;
    entrySuitable: boolean;
    conflictingSignals: string[];
    finalAlignmentSummary: string;
    reason: string;
  };
  strategyParams?: Record<string, unknown>;
  riskSettings?: {
    maxRiskPerTrade?: number;
    maxLeverage?: number;
    maxDailyLossPercent?: number;
  };
};

export type AIRoleScore = {
  role: "AI-1_TECHNICAL" | "AI-2_SENTIMENT" | "AI-3_RISK";
  score: number;
  decision: AIDecision;
  confidence: number;
  rationale: string[];
  veto?: boolean;
};

export type AIDecisionPayload = {
  coin: string;
  entryPrice: number;
  targetPrice: number | null;
  stopPrice: number | null;
  riskRewardRatio: number;
  technicalReason: string;
  sentimentReason: string;
  riskAssessment: string;
  confidenceScore: number;
  openTrade: boolean;
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
  strategyRuntime?: {
    aiScoreThreshold: number;
    technicalMinScore: number;
    sentimentMinScore: number;
    riskVetoLevel: number;
    consensusMinScore: number;
    noTradeThreshold: number;
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
};

export type AIProviderConfig = {
  id: string;
  name: string;
  apiKey?: string;
  timeoutMs: number;
  weight: number;
  enabled: boolean;
};

export type AIProviderResult = {
  providerId: string;
  providerName: string;
  ok: boolean;
  output?: AIModelOutput;
  latencyMs: number;
  error?: string;
};

export type AIConsensusResult = {
  finalDecision: AIDecision;
  finalConsensusDecision?: "BUY" | "WATCHLIST" | "NO-TRADE" | "REJECT";
  finalConsensusConfidence?: number;
  finalConfidence: number;
  finalRiskScore: number;
  score: number;
  explanation: string;
  outputs: AIProviderResult[];
  rejected: boolean;
  rejectReason?: string;
  roleScores?: AIRoleScore[];
  decisionPayload?: AIDecisionPayload;
  generatedAt: string;
};
