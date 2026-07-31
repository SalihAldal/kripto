import type { IndicatorSnapshot } from "@/src/server/trading-core/core/types";
import type { LiquidationHeatmapAnalysis } from "@/src/server/trading-core/liquidation-heatmap";

export type ExperienceOutcome = "WIN" | "LOSS" | "BREAKEVEN";
export type ExperienceRiskFlag = "SAFE" | "CAUTION" | "RISKY";

export type ExperienceEntryConditions = {
  strategy: string;
  botId?: string;
  side: "BUY" | "SELL";
  confidenceScore?: number;
  entryPrice?: number;
  indicators?: IndicatorSnapshot;
};

export type ExperienceMarketContext = {
  symbol: string;
  marketRegime?: string;
  volumeRatio?: number;
  fundingRatePercent?: number;
  volatilityPercent?: number;
  orderbookImbalancePercent?: number;
  spreadPercent?: number;
  liquidityUsd?: number;
  liquidation?: Pick<LiquidationHeatmapAnalysis, "squeezeDirection" | "squeezeScore" | "manipulationRiskScore" | "riskLevel"> | null;
};

export type TradeExperienceRecord = {
  experienceId: string;
  tradeId: string;
  entry: ExperienceEntryConditions;
  market: ExperienceMarketContext;
  pnlResult: number;
  returnPercent: number;
  tradeDurationMs?: number;
  outcome: ExperienceOutcome;
  riskFlag: ExperienceRiskFlag;
  notes: string[];
  createdAt: string;
};

export type ExperienceMemoryInput = Omit<TradeExperienceRecord, "experienceId" | "outcome" | "riskFlag" | "createdAt">;

export type ExperienceQueryInput = {
  entry: ExperienceEntryConditions;
  market: ExperienceMarketContext;
  minSimilarityScore?: number;
  limit?: number;
};

export type HistoricalTradeMatch = {
  experience: TradeExperienceRecord;
  similarityScore: number;
  matchingReasons: string[];
};

export type ConfidenceMemoryResult = {
  confidenceScore: number;
  riskFlag: ExperienceRiskFlag;
  similarTrades: number;
  historicalWinrate: number;
  averageReturnPercent: number;
  matchingTrades: HistoricalTradeMatch[];
  rememberedSetups: TradeExperienceRecord[];
  riskyPatterns: TradeExperienceRecord[];
  reasons: string[];
  generatedAt: string;
};

export type ExperienceMemorySnapshot = {
  totalExperiences: number;
  successfulSetups: TradeExperienceRecord[];
  failedSetups: TradeExperienceRecord[];
  riskyPatterns: TradeExperienceRecord[];
  updatedAt: string;
};
