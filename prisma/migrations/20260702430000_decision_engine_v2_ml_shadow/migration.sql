-- Decision Engine V2 + ML Shadow Platform (Sprint 3)

CREATE TYPE "MLModelAlgorithm" AS ENUM ('LIGHTGBM', 'XGBOOST', 'CATBOOST', 'GRADIENT_BOOSTING');
CREATE TYPE "MLModelStatus" AS ENUM ('TRAINING', 'VALIDATED', 'CHAMPION', 'CHALLENGER', 'ARCHIVED', 'ROLLED_BACK');
CREATE TYPE "MLDecisionLabel" AS ENUM ('BUY', 'WAIT', 'NO_TRADE');
CREATE TYPE "CalibrationMethod" AS ENUM ('PLATT', 'ISOTONIC', 'NONE');
CREATE TYPE "MLValidationMethod" AS ENUM ('WALK_FORWARD', 'OUT_OF_SAMPLE', 'PURGED_CV', 'TIME_SERIES_SPLIT');
CREATE TYPE "ModelPromotionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'ROLLED_BACK');
CREATE TYPE "DecisionEngineV2JobType" AS ENUM ('PREDICTION_BATCH', 'MODEL_TRAIN', 'MODEL_VALIDATE', 'CALIBRATION_UPDATE', 'FEATURE_IMPORTANCE', 'SHADOW_PERFORMANCE', 'PROMOTION_CHECK', 'REGISTRY_SYNC');

CREATE TABLE "MLModel" (
  "id" TEXT NOT NULL,
  "modelKey" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "algorithm" "MLModelAlgorithm" NOT NULL,
  "status" "MLModelStatus" NOT NULL DEFAULT 'TRAINING',
  "featureSetVersion" TEXT NOT NULL,
  "trainingDatasetId" TEXT,
  "gitCommit" TEXT,
  "artifactPath" TEXT,
  "artifactJson" JSONB,
  "trainingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MLModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MLDecisionRegistry" (
  "id" TEXT NOT NULL,
  "registryKey" TEXT NOT NULL DEFAULT 'CURRENT',
  "championModelId" TEXT,
  "challengerModelId" TEXT,
  "activeModelId" TEXT,
  "previousModelId" TEXT,
  "rollbackModelId" TEXT,
  "metadata" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MLDecisionRegistry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelMetrics" (
  "id" TEXT NOT NULL,
  "metricsKey" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "validationMethod" "MLValidationMethod" NOT NULL,
  "hitRate" DOUBLE PRECISION,
  "profitFactor" DOUBLE PRECISION,
  "expectancy" DOUBLE PRECISION,
  "sharpe" DOUBLE PRECISION,
  "maxDrawdown" DOUBLE PRECISION,
  "accuracy" DOUBLE PRECISION,
  "f1Score" DOUBLE PRECISION,
  "auc" DOUBLE PRECISION,
  "sampleSize" INTEGER NOT NULL DEFAULT 0,
  "metrics" JSONB,
  "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelMetrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelPrediction" (
  "id" TEXT NOT NULL,
  "predictionKey" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "decisionId" TEXT,
  "symbol" TEXT NOT NULL,
  "featuresUsed" JSONB NOT NULL,
  "rawProbabilities" JSONB NOT NULL,
  "calibratedProbabilities" JSONB NOT NULL,
  "decision" "MLDecisionLabel" NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectedReturn" DOUBLE PRECISION,
  "expectedRisk" DOUBLE PRECISION,
  "expectedHoldingMinutes" INTEGER,
  "expectedMaxDrawdown" DOUBLE PRECISION,
  "expectedMaxProfit" DOUBLE PRECISION,
  "inferenceTimeMs" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reason" TEXT,
  "metadata" JSONB,
  "predictedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ModelPrediction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ModelPromotion" (
  "id" TEXT NOT NULL,
  "promotionKey" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "baselineEngineId" TEXT NOT NULL DEFAULT 'decision-engine-v1',
  "status" "ModelPromotionStatus" NOT NULL DEFAULT 'PENDING',
  "shadowTradeCount" INTEGER NOT NULL DEFAULT 0,
  "profitFactor" DOUBLE PRECISION,
  "expectancy" DOUBLE PRECISION,
  "maxDrawdown" DOUBLE PRECISION,
  "winRate" DOUBLE PRECISION,
  "blockers" JSONB,
  "rationale" TEXT,
  "promotedAt" TIMESTAMP(3),
  "rolledBackAt" TIMESTAMP(3),
  "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "ModelPromotion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShadowTrade" (
  "id" TEXT NOT NULL,
  "tradeKey" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "engineId" TEXT NOT NULL,
  "modelId" TEXT,
  "symbol" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "entryPrice" DOUBLE PRECISION,
  "exitPrice" DOUBLE PRECISION,
  "virtualPnl" DOUBLE PRECISION,
  "virtualPnlPct" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "metadata" JSONB,
  CONSTRAINT "ShadowTrade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShadowPerformance" (
  "id" TEXT NOT NULL,
  "perfKey" TEXT NOT NULL,
  "engineId" TEXT NOT NULL,
  "modelId" TEXT,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "profitFactor" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectancy" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sharpe" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxDrawdown" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "missedTrades" INTEGER NOT NULL DEFAULT 0,
  "rejectedTrades" INTEGER NOT NULL DEFAULT 0,
  "expectedProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "actualProfit" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sampleSize" INTEGER NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShadowPerformance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MLFeatureImportance" (
  "id" TEXT NOT NULL,
  "importanceKey" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "featureName" TEXT NOT NULL,
  "shapValue" DOUBLE PRECISION,
  "gainImportance" DOUBLE PRECISION,
  "permutationImportance" DOUBLE PRECISION,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MLFeatureImportance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DecisionEngineV2JobState" (
  "id" TEXT NOT NULL,
  "jobType" "DecisionEngineV2JobType" NOT NULL,
  "lastProcessedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'IDLE',
  "metadata" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionEngineV2JobState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MLModel_modelKey_key" ON "MLModel"("modelKey");
CREATE INDEX "MLModel_status_trainingDate_idx" ON "MLModel"("status", "trainingDate");
CREATE INDEX "MLModel_algorithm_version_idx" ON "MLModel"("algorithm", "version");

CREATE UNIQUE INDEX "MLDecisionRegistry_registryKey_key" ON "MLDecisionRegistry"("registryKey");

CREATE UNIQUE INDEX "ModelMetrics_metricsKey_key" ON "ModelMetrics"("metricsKey");
CREATE INDEX "ModelMetrics_modelId_validationMethod_idx" ON "ModelMetrics"("modelId", "validationMethod");
CREATE INDEX "ModelMetrics_validatedAt_idx" ON "ModelMetrics"("validatedAt");

CREATE UNIQUE INDEX "ModelPrediction_predictionKey_key" ON "ModelPrediction"("predictionKey");
CREATE INDEX "ModelPrediction_symbol_predictedAt_idx" ON "ModelPrediction"("symbol", "predictedAt");
CREATE INDEX "ModelPrediction_modelId_predictedAt_idx" ON "ModelPrediction"("modelId", "predictedAt");
CREATE INDEX "ModelPrediction_decisionId_idx" ON "ModelPrediction"("decisionId");
CREATE INDEX "ModelPrediction_decision_predictedAt_idx" ON "ModelPrediction"("decision", "predictedAt");

CREATE UNIQUE INDEX "ModelPromotion_promotionKey_key" ON "ModelPromotion"("promotionKey");
CREATE INDEX "ModelPromotion_modelId_status_idx" ON "ModelPromotion"("modelId", "status");
CREATE INDEX "ModelPromotion_evaluatedAt_idx" ON "ModelPromotion"("evaluatedAt");

CREATE UNIQUE INDEX "ShadowTrade_tradeKey_key" ON "ShadowTrade"("tradeKey");
CREATE INDEX "ShadowTrade_engineId_openedAt_idx" ON "ShadowTrade"("engineId", "openedAt");
CREATE INDEX "ShadowTrade_modelId_status_idx" ON "ShadowTrade"("modelId", "status");
CREATE INDEX "ShadowTrade_decisionId_idx" ON "ShadowTrade"("decisionId");
CREATE INDEX "ShadowTrade_symbol_openedAt_idx" ON "ShadowTrade"("symbol", "openedAt");

CREATE UNIQUE INDEX "ShadowPerformance_perfKey_key" ON "ShadowPerformance"("perfKey");
CREATE INDEX "ShadowPerformance_engineId_calculatedAt_idx" ON "ShadowPerformance"("engineId", "calculatedAt");
CREATE INDEX "ShadowPerformance_modelId_periodStart_periodEnd_idx" ON "ShadowPerformance"("modelId", "periodStart", "periodEnd");

CREATE UNIQUE INDEX "MLFeatureImportance_importanceKey_key" ON "MLFeatureImportance"("importanceKey");
CREATE INDEX "MLFeatureImportance_modelId_featureName_idx" ON "MLFeatureImportance"("modelId", "featureName");
CREATE INDEX "MLFeatureImportance_calculatedAt_idx" ON "MLFeatureImportance"("calculatedAt");

CREATE UNIQUE INDEX "DecisionEngineV2JobState_jobType_key" ON "DecisionEngineV2JobState"("jobType");

ALTER TABLE "MLDecisionRegistry" ADD CONSTRAINT "MLDecisionRegistry_championModelId_fkey" FOREIGN KEY ("championModelId") REFERENCES "MLModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MLDecisionRegistry" ADD CONSTRAINT "MLDecisionRegistry_challengerModelId_fkey" FOREIGN KEY ("challengerModelId") REFERENCES "MLModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MLDecisionRegistry" ADD CONSTRAINT "MLDecisionRegistry_activeModelId_fkey" FOREIGN KEY ("activeModelId") REFERENCES "MLModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MLDecisionRegistry" ADD CONSTRAINT "MLDecisionRegistry_previousModelId_fkey" FOREIGN KEY ("previousModelId") REFERENCES "MLModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MLDecisionRegistry" ADD CONSTRAINT "MLDecisionRegistry_rollbackModelId_fkey" FOREIGN KEY ("rollbackModelId") REFERENCES "MLModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ModelMetrics" ADD CONSTRAINT "ModelMetrics_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "MLModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelPrediction" ADD CONSTRAINT "ModelPrediction_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "MLModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ModelPromotion" ADD CONSTRAINT "ModelPromotion_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "MLModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShadowTrade" ADD CONSTRAINT "ShadowTrade_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "MLModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShadowPerformance" ADD CONSTRAINT "ShadowPerformance_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "MLModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MLFeatureImportance" ADD CONSTRAINT "MLFeatureImportance_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "MLModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
