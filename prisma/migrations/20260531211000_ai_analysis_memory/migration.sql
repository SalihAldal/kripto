CREATE TABLE "AIAnalysisMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "symbol" TEXT NOT NULL,
    "horizon" "TradeHorizon" NOT NULL,
    "marketRegime" TEXT,
    "patternKey" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "expectedMovePercent" DOUBLE PRECISION,
    "actualReturnPercent" DOUBLE PRECISION,
    "outcome" "LearningOutcome",
    "errorType" TEXT,
    "aiMistakeTags" JSONB,
    "sampleCount" INTEGER NOT NULL DEFAULT 1,
    "winCount" INTEGER NOT NULL DEFAULT 0,
    "lossCount" INTEGER NOT NULL DEFAULT 0,
    "rejectCount" INTEGER NOT NULL DEFAULT 0,
    "winRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgReturn" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avgConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastPredictionId" TEXT,
    "lastExecutionId" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIAnalysisMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AIAnalysisMemory_patternKey_horizon_decision_key" ON "AIAnalysisMemory"("patternKey", "horizon", "decision");
CREATE INDEX "AIAnalysisMemory_symbol_horizon_lastSeenAt_idx" ON "AIAnalysisMemory"("symbol", "horizon", "lastSeenAt");
CREATE INDEX "AIAnalysisMemory_horizon_outcome_idx" ON "AIAnalysisMemory"("horizon", "outcome");
CREATE INDEX "AIAnalysisMemory_errorType_lastSeenAt_idx" ON "AIAnalysisMemory"("errorType", "lastSeenAt");
CREATE INDEX "AIAnalysisMemory_userId_lastSeenAt_idx" ON "AIAnalysisMemory"("userId", "lastSeenAt");
