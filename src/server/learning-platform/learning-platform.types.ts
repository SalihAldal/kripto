import type { LearningPlatformJobType, ModelCandidateRole, ModelCandidateStatus, TrainingDatasetStatus } from "@prisma/client";

export type DatasetLabels = {
  return1h: number | null;
  return4h: number | null;
  return12h: number | null;
  return24h: number | null;
  mfe: number | null;
  mae: number | null;
  tradeSuccess: boolean;
  tradeFailure: boolean;
  expectedRr: number | null;
  peakProfitPct: number | null;
  maxDrawdownPct: number | null;
};

export type LearningPlatformJobPayload =
  | { type: "DATASET_BUILD"; limit?: number; datasetId?: string }
  | { type: "DATASET_VALIDATE"; datasetId?: string }
  | { type: "TRAIN_MODEL"; algorithm?: string; datasetId?: string; limit?: number }
  | { type: "EVALUATE_MODEL"; modelId?: string; datasetId?: string }
  | { type: "REGISTRY_SYNC" }
  | { type: "COIN_LEARN"; symbol?: string; limit?: number }
  | { type: "MARKET_MEMORY"; limit?: number }
  | { type: "TRADE_MEMORY"; tradeId?: string; limit?: number }
  | { type: "MISSED_OPPORTUNITY"; limit?: number }
  | { type: "DAILY_REPORT"; date?: string }
  | { type: "PROMOTION_CANDIDATE"; modelId?: string };

export type ModelEvaluationMetrics = {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  rocAuc: number;
  prAuc: number;
  profitFactor: number;
  expectancy: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  sampleSize: number;
};

export type { LearningPlatformJobType, ModelCandidateRole, ModelCandidateStatus, TrainingDatasetStatus };
