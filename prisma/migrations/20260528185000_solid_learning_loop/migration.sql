CREATE TYPE "LearningOutcome" AS ENUM ('WIN', 'LOSS', 'BREAKEVEN');
CREATE TYPE "TradeHorizon" AS ENUM ('SCALP_5M', 'SHORT_30M', 'SESSION');
CREATE TYPE "LearningPolicyStatus" AS ENUM ('DRAFT', 'PAPER_VALIDATED', 'LIVE_ADVISORY', 'LIVE_ACTIVE', 'DISABLED');

CREATE TABLE "LearningTrade" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tradingPairId" TEXT NOT NULL,
  "positionId" TEXT,
  "tradeId" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "strategy" TEXT NOT NULL,
  "horizon" "TradeHorizon" NOT NULL,
  "outcome" "LearningOutcome" NOT NULL,
  "entryPrice" DOUBLE PRECISION NOT NULL,
  "exitPrice" DOUBLE PRECISION NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "returnPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "targetProfitPercent" DOUBLE PRECISION,
  "stopLossPercent" DOUBLE PRECISION,
  "maxDurationSec" INTEGER,
  "holdSec" INTEGER,
  "closeReason" TEXT,
  "marketRegime" TEXT,
  "qualityScore" DOUBLE PRECISION,
  "patternKey" TEXT NOT NULL,
  "criticGrade" TEXT,
  "criticVerdict" TEXT,
  "criticSummary" TEXT,
  "tpslSuggestion" JSONB,
  "metadata" JSONB,
  "openedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningTrade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningFeature" (
  "id" TEXT NOT NULL,
  "learningTradeId" TEXT NOT NULL,
  "featureKey" TEXT NOT NULL,
  "featureValue" TEXT NOT NULL,
  "numericValue" DOUBLE PRECISION,
  "category" TEXT NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LearningFeature_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningPatternStats" (
  "id" TEXT NOT NULL,
  "patternKey" TEXT NOT NULL,
  "strategy" TEXT NOT NULL,
  "horizon" "TradeHorizon" NOT NULL,
  "marketRegime" TEXT,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "breakevens" INTEGER NOT NULL DEFAULT 0,
  "winrate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "averageReturnPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalReturnPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "bestReturnPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "worstReturnPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxDrawdownPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectancyPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" "LearningPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "suggestedTakeProfitPercent" DOUBLE PRECISION,
  "suggestedStopLossPercent" DOUBLE PRECISION,
  "suggestedMaxDurationSec" INTEGER,
  "lastCriticVerdict" TEXT,
  "featureSummary" JSONB,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningPatternStats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LearningPolicyPatch" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "patternKey" TEXT NOT NULL,
  "status" "LearningPolicyStatus" NOT NULL DEFAULT 'DRAFT',
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "winrate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expectancyPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "maxDrawdownPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "minScoreDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sizeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "suggestedTakeProfitPercent" DOUBLE PRECISION,
  "suggestedStopLossPercent" DOUBLE PRECISION,
  "suggestedMaxDurationSec" INTEGER,
  "appliedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LearningPolicyPatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearningTrade_tradeId_key" ON "LearningTrade"("tradeId");
CREATE INDEX "LearningTrade_userId_closedAt_idx" ON "LearningTrade"("userId", "closedAt");
CREATE INDEX "LearningTrade_symbol_horizon_closedAt_idx" ON "LearningTrade"("symbol", "horizon", "closedAt");
CREATE INDEX "LearningTrade_patternKey_closedAt_idx" ON "LearningTrade"("patternKey", "closedAt");
CREATE INDEX "LearningTrade_outcome_horizon_idx" ON "LearningTrade"("outcome", "horizon");

CREATE INDEX "LearningFeature_featureKey_featureValue_idx" ON "LearningFeature"("featureKey", "featureValue");
CREATE INDEX "LearningFeature_category_idx" ON "LearningFeature"("category");
CREATE INDEX "LearningFeature_learningTradeId_idx" ON "LearningFeature"("learningTradeId");

CREATE UNIQUE INDEX "LearningPatternStats_patternKey_key" ON "LearningPatternStats"("patternKey");
CREATE INDEX "LearningPatternStats_horizon_status_confidenceScore_idx" ON "LearningPatternStats"("horizon", "status", "confidenceScore");
CREATE INDEX "LearningPatternStats_strategy_horizon_idx" ON "LearningPatternStats"("strategy", "horizon");

CREATE INDEX "LearningPolicyPatch_userId_status_idx" ON "LearningPolicyPatch"("userId", "status");
CREATE INDEX "LearningPolicyPatch_patternKey_status_idx" ON "LearningPolicyPatch"("patternKey", "status");

ALTER TABLE "LearningTrade" ADD CONSTRAINT "LearningTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningTrade" ADD CONSTRAINT "LearningTrade_tradingPairId_fkey" FOREIGN KEY ("tradingPairId") REFERENCES "TradingPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningTrade" ADD CONSTRAINT "LearningTrade_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningFeature" ADD CONSTRAINT "LearningFeature_learningTradeId_fkey" FOREIGN KEY ("learningTradeId") REFERENCES "LearningTrade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningPolicyPatch" ADD CONSTRAINT "LearningPolicyPatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
