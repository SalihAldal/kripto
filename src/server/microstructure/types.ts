import type { OpportunityCandidate, OpportunityLane, ScoreBreakdown } from "@/src/server/opportunity/types";

export type MicroState =
  | "WARMING"
  | "MICRO_CONFIRMED"
  | "EXECUTION_READY"
  | "COOLING"
  | "EXPIRED"
  | "HARD_REJECT";

export type MicroReasonCode =
  | "MICRO_STRONG_TAKER_BUY"
  | "MICRO_BUY_FLOW_ACCELERATION"
  | "MICRO_TRADE_RATE_EXPANSION"
  | "MICRO_ASK_DEPLETION"
  | "MICRO_BID_SUPPORT"
  | "MICRO_BREAKOUT_ACCEPTED"
  | "MICRO_POSITIVE_ABSORPTION"
  | "MICRO_SELL_FLOW_DOMINANT"
  | "MICRO_FLOW_DIVERGENCE"
  | "MICRO_ASK_RELOAD"
  | "MICRO_BID_WITHDRAWAL"
  | "MICRO_FAILED_BREAKOUT"
  | "MICRO_EXHAUSTION"
  | "MICRO_LOW_ACTIVITY"
  | "MICRO_WIDE_SPREAD"
  | "MICRO_DATA_STALE"
  | "MICRO_INVALID_BOOK"
  | "MICRO_ZERO_LIQUIDITY"
  | "MICRO_WARMING"
  | "MICRO_CROSS_LAYER_CONFIRM"
  | "EXECUTION_FINAL_SCORE_BELOW_THRESHOLD"
  | "EXECUTION_QUALITY_BELOW_THRESHOLD"
  | "EXECUTION_SPREAD_TOO_WIDE";

export type HardRejectCode =
  | "MICRO_DATA_STALE"
  | "MICRO_INVALID_BOOK"
  | "MICRO_ZERO_LIQUIDITY"
  | "MICRO_EXTREME_SPREAD"
  | "MICRO_BROKEN_SEQUENCE"
  | "MICRO_EXCHANGE_DISCONNECTED";

export type AiAdvisoryStatus = "READY" | "TIMEOUT" | "NO_OPINION" | "INVALID" | "UNAVAILABLE" | "PENDING";
export type AiAdvisoryDecision = "BULLISH_CONTEXT" | "NEUTRAL" | "CAUTION" | "NO_OPINION";

export type MicroScoreBreakdown = {
  takerBuyRatio: number;
  buyFlowAcceleration: number;
  tradeAcceleration: number;
  askDepletion: number;
  bidSupport: number;
  depthImbalance: number;
  breakoutAcceptance: number;
  spreadQuality: number;
  exhaustion: number;
  divergence: number;
};

export type MicroFeatures = {
  takerBuyVolume1s: number;
  takerSellVolume1s: number;
  takerBuyVolume5s: number;
  takerSellVolume5s: number;
  takerBuyVolume15s: number;
  takerSellVolume15s: number;
  takerBuyVolume60s: number;
  takerSellVolume60s: number;
  netTakerFlow5s: number;
  netTakerFlow15s: number;
  takerBuyRatio5s: number;
  takerBuyRatio15s: number;
  flowImbalance3s: number;
  flowImbalance5s: number;
  flowImbalance15s: number;
  flowImbalance60s: number;
  buyFlowAcceleration: number;
  sellFlowAcceleration: number;
  netFlowAcceleration: number;
  tradeRate1s: number;
  tradeRate5s: number;
  tradeRate15s: number;
  tradeRateAcceleration: number;
  avgTradeNotional5s: number;
  avgTradeNotional15s: number;
  avgTradeNotional60s: number;
  largeBuyTradeRate: number;
  largeSellTradeRate: number;
  largeBuyNotional: number;
  largeSellNotional: number;
  spreadBps: number;
  spreadAbsolute: number;
  topBookImbalance: number;
  depthImbalance5bps: number;
  depthImbalance10bps: number;
  depthImbalance25bps: number;
  bidLiquidity: number;
  askLiquidity: number;
  askDepthChange: number;
  askDepletionRate: number;
  askReloadRate: number;
  bidPersistence: number;
  bidReload: number;
  bidWithdrawal: number;
  liquidityVolatility: number;
  largeAskAppearedThenRemoved: number;
  largeBidAppearedThenRemoved: number;
  priceChangePerBuyNotional: number;
  sellAbsorption: number;
  buyAbsorption: number;
  crossLayerConfirmation: number;
  priceFlowDivergence: number;
  priceVolumeDivergence: number;
  priceBookDivergence: number;
  microExhaustion: number;
  breakoutHoldTime: number;
  postBreakoutFlow: number;
  breakoutRetestQuality: number;
  failedBreakout: number;
  expectedSlippageBps: number;
  depthToIntendedSize: number;
  lastAggTradeAt: number;
  lastBookTickerAt: number;
  lastDepthAt: number;
  tradeCount: number;
};

export type AiAdvisory = {
  status: AiAdvisoryStatus;
  decision: AiAdvisoryDecision;
  modifier: number;
  reason: string;
};

export type TdiShadow = {
  role: "SHADOW";
  decision: string;
  agreesWithCanonical: boolean | null;
  canReject: false;
};

export type FinalRankedCandidate = {
  quoteVolume24h?: number;
  change24h?: number;
  candidateId: string;
  symbol: string;
  lane: OpportunityLane;
  opportunityScore: number;
  opportunityBreakdown: ScoreBreakdown;
  microScore: number;
  microBreakdown: MicroScoreBreakdown;
  liquidityScore: number;
  executionQuality: number;
  ai: AiAdvisory;
  tdi: TdiShadow;
  finalScore: number;
  smoothedScore: number;
  rank: number;
  confidence: number;
  state: MicroState;
  reasonCodes: MicroReasonCode[];
  warnings: MicroReasonCode[];
  hardReject: HardRejectCode | null;
  firstDetectedAt: number;
  firstDetectionPrice: number;
  hotAt: number;
  microReadyAt: number | null;
  currentPrice: number;
  features: MicroFeatures;
  deepSubscribed: boolean;
  timing: {
    hotAt: number;
    deepSubscribeRequestedAt: number | null;
    deepActiveAt: number | null;
    firstAggTradeAt: number | null;
    firstBookTickerAt: number | null;
    microWarmupStartedAt: number | null;
    microDataReadyAt: number | null;
    microAnalyzedAt: number;
    terminalAt: number | null;
    subscribeActivationLatencyMs: number | null;
    firstDeepEventLatencyMs: number | null;
    warmupDurationMs: number | null;
    hotToMicroAnalyzeLatencyMs: number | null;
  };
};

export type MicroEvaluateInput = {
  opportunity: OpportunityCandidate;
  trades: import("@/src/server/market-data/spine/events").MarketTradeEvent[];
  book: import("@/src/server/market-data/spine/events").BookTickerState | null;
  depth: import("@/src/types/exchange").OrderBookSnapshot | null;
  bookHistory: BookSample[];
  intendedNotional: number;
  now?: number;
  ai?: AiAdvisory;
  tdiDecision?: string;
};

export type BookSample = {
  t: number;
  bestBid: number;
  bestAsk: number;
  bidQty: number;
  askQty: number;
  spreadBps: number;
};

export type MicroEvaluateResult = {
  evaluatedAt: number;
  durationMs: number;
  ranked: FinalRankedCandidate[];
  hotCount: number;
  warmingCount: number;
  confirmedCount: number;
  executionReadyCount: number;
  expiredCount: number;
  deepSubscriptions: number;
  restCalls: number;
};
