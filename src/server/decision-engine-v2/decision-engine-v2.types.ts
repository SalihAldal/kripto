import type {
  MLModelAlgorithm,
  MLModelStatus,
  MLDecisionLabel,
  CalibrationMethod,
  MLValidationMethod,
  ModelPromotionStatus,
  DecisionEngineV2JobType,
} from "@prisma/client";
import type { FeatureSnapshotInput } from "@/src/server/observability/decision-observability.types";

export const DECISION_ENGINE_V2_FEATURE_NAMES = [
  "momentum",
  "relativeVolume",
  "atr",
  "vwapDistance",
  "rsi",
  "emaDistance",
  "btcStrength",
  "ethStrength",
  "spread",
  "liquidity",
  "orderbookImbalance",
  "volatility",
  "discoveryScore",
  "marketRegimeScore",
  "historicalCoinBehaviour",
  "confidencePrior",
] as const;

export type DecisionEngineV2FeatureName = (typeof DECISION_ENGINE_V2_FEATURE_NAMES)[number];
export type DecisionEngineV2FeatureVector = Record<DecisionEngineV2FeatureName, number>;

export type DecisionEngineV2JobPayload =
  | { type: "PREDICTION_BATCH"; limit?: number; decisionIds?: string[] }
  | { type: "MODEL_TRAIN"; algorithm?: MLModelAlgorithm; limit?: number }
  | { type: "MODEL_VALIDATE"; modelId?: string }
  | { type: "CALIBRATION_UPDATE"; modelId?: string }
  | { type: "FEATURE_IMPORTANCE"; modelId?: string }
  | { type: "SHADOW_PERFORMANCE"; engineId?: string; days?: number }
  | { type: "PROMOTION_CHECK"; modelId?: string }
  | { type: "REGISTRY_SYNC" };

export type InferenceArtifact = {
  algorithm: MLModelAlgorithm;
  featureNames: DecisionEngineV2FeatureName[];
  classLabels: MLDecisionLabel[];
  featureMeans: number[];
  featureStds: number[];
  coefficients: number[][];
  intercepts: number[];
  calibration: {
    method: CalibrationMethod;
    platt?: { a: number; b: number };
    isotonic?: { x: number[]; y: number[] };
  };
  outcomeStats: Record<
    MLDecisionLabel,
    {
      expectedReturn: number;
      expectedRisk: number;
      expectedHoldingMinutes: number;
      expectedMaxDrawdown: number;
      expectedMaxProfit: number;
    }
  >;
};

export type DecisionEngineV2Prediction = {
  decision: MLDecisionLabel;
  confidence: number;
  rawProbabilities: Record<MLDecisionLabel, number>;
  calibratedProbabilities: Record<MLDecisionLabel, number>;
  expectedReturn: number;
  expectedRisk: number;
  expectedHoldingMinutes: number;
  expectedMaxDrawdown: number;
  expectedMaxProfit: number;
  reason: string;
  modelId: string;
  modelVersion: string;
  inferenceTimeMs: number;
  featuresUsed: DecisionEngineV2FeatureVector;
};

export type TrainingRowExport = {
  features: DecisionEngineV2FeatureVector;
  label: MLDecisionLabel;
  symbol: string;
  decisionId: string;
  timestamp: string;
  returnPct?: number;
};

export type ModelTrainingResult = {
  modelId: string;
  modelKey: string;
  version: string;
  algorithm: MLModelAlgorithm;
  artifact: InferenceArtifact;
  validationMetrics: Array<{
    method: MLValidationMethod;
    accuracy: number;
    f1Score: number;
    sampleSize: number;
    metrics: Record<string, number>;
  }>;
  featureImportance: Array<{
    featureName: string;
    shapValue: number;
    gainImportance: number;
    permutationImportance: number;
  }>;
};

export type ShadowAbComparison = {
  ruleEngineId: string;
  mlEngineId: string;
  winRateDelta: number;
  profitFactorDelta: number;
  expectancyDelta: number;
  maxDrawdownDelta: number;
  avgHoldingMinutesDelta: number;
  tradeQualityDelta: number;
};

export type ExtractFeatureInput = {
  featureSnapshot?: FeatureSnapshotInput | null;
  symbol: string;
  scannerScore?: number | null;
  momentumScore?: number | null;
  discoveryScore?: number | null;
  marketRegime?: string | null;
  metadata?: Record<string, unknown> | null;
};

export const ML_V2_PROMOTION_RULES = {
  minShadowTrades: 100,
  minProfitFactorVsBaseline: 1.0,
  minExpectancy: 0,
  maxDrawdownVsBaseline: 1.0,
  maxCatastrophicFailures: 0,
} as const;

export type {
  MLModelAlgorithm,
  MLModelStatus,
  MLDecisionLabel,
  CalibrationMethod,
  MLValidationMethod,
  ModelPromotionStatus,
  DecisionEngineV2JobType,
};
