import type { IndicatorSnapshot } from "@/src/server/trading-core/core/types";
import type { DynamicPositionSizingDecision } from "@/src/server/trading-core/dynamic-position-sizing";
import type { MarketEdgeCondition } from "@/src/server/trading-core/market-edge";
import type { TradeQualityDecision } from "@/src/server/trading-core/trade-quality";
import type { TradeLearningReport } from "@/src/server/trading-core/self-learning";

export type FeedbackTradeStatus = "OPEN" | "CLOSED" | "REJECTED";
export type FeedbackSetupStatus = "BOOSTED" | "NEUTRAL" | "BLACKLISTED";

export type FeedbackMarketSnapshot = {
  marketRegime?: string;
  volatilityPercent?: number;
  fundingRatePercent?: number;
  orderbookImbalancePercent?: number;
  spreadPercent?: number;
  volumeRatio?: number;
  liquidityUsd?: number;
  newsSpikeScore?: number;
};

export type FeedbackStrategySnapshot = {
  strategy: string;
  params?: Record<string, number | string | boolean>;
  minScore?: number;
  confidenceScore?: number;
  indicators?: IndicatorSnapshot;
  edgeConditions?: MarketEdgeCondition[];
};

export type FeedbackOpenTradeInput = {
  tradeId: string;
  botId: string;
  strategy: string;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  quantity: number;
  openedAt?: string;
  market: FeedbackMarketSnapshot;
  strategySnapshot: FeedbackStrategySnapshot;
  tradeQuality?: TradeQualityDecision;
  sizing?: DynamicPositionSizingDecision;
};

export type FeedbackCloseTradeInput = {
  tradeId: string;
  exitPrice: number;
  realizedPnl: number;
  returnPercent: number;
  closedAt?: string;
  exitReason?: string;
  applyLearning?: boolean;
};

export type FeedbackRejectTradeInput = FeedbackOpenTradeInput & {
  rejectReason: string;
  rejectedAt?: string;
  confidenceScore?: number;
};

export type FeedbackTradeRecord = FeedbackOpenTradeInput & {
  status: FeedbackTradeStatus;
  exitPrice?: number;
  realizedPnl?: number;
  returnPercent?: number;
  closedAt?: string;
  exitReason?: string;
  rejectReason?: string;
  rejectedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type FeedbackSetupStats = {
  setupKey: string;
  botId: string;
  strategy: string;
  marketRegime?: string;
  trades: number;
  wins: number;
  losses: number;
  winrate: number;
  averageReturnPercent: number;
  adaptiveConfidenceScore: number;
  dynamicWeight: number;
  status: FeedbackSetupStatus;
  reasons: string[];
  updatedAt: string;
};

export type FeedbackLoopReport = {
  trade: FeedbackTradeRecord;
  learningReport: TradeLearningReport;
  setupStats: FeedbackSetupStats;
  botMarketSuccess: FeedbackSetupStats[];
  blacklistedSetups: FeedbackSetupStats[];
  boostedSetups: FeedbackSetupStats[];
  generatedAt: string;
};

export type FeedbackLoopSnapshot = {
  openTrades: FeedbackTradeRecord[];
  closedTrades: FeedbackTradeRecord[];
  rejectedTrades: FeedbackTradeRecord[];
  setupStats: FeedbackSetupStats[];
  blacklistedSetups: FeedbackSetupStats[];
  boostedSetups: FeedbackSetupStats[];
  lastReport?: FeedbackLoopReport | null;
  updatedAt: string;
};
