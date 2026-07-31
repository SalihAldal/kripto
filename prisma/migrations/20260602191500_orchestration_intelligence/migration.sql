CREATE TYPE "OrchestrationAction" AS ENUM ('ALLOW', 'CAUTION', 'SUPPRESS', 'BLOCK');
CREATE TYPE "OrchestrationEventType" AS ENUM ('DECISION', 'UNCERTAINTY', 'EDGE_HEALTH', 'CLUSTER', 'ADAPTIVE_ACTION', 'FORENSIC', 'LEARNING_EVENT', 'PERSISTENCE_AUDIT');
CREATE TYPE "OrchestrationPersistenceStatus" AS ENUM ('PENDING', 'WRITTEN', 'FAILED', 'RETRYING', 'DEAD_LETTER');
CREATE TYPE "OrchestrationAdaptiveActionType" AS ENUM ('THRESHOLD_INCREASE', 'CONFIDENCE_PENALTY', 'SIZE_REDUCTION', 'STRATEGY_COOLDOWN', 'STRATEGY_DISABLE', 'NO_TRADE_MODE', 'RISK_REDUCTION', 'INFO');

CREATE TABLE "OrchestrationDecision" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "executionId" TEXT,
  "tradeId" TEXT,
  "positionId" TEXT,
  "symbol" TEXT,
  "mode" TEXT,
  "decisionStage" TEXT NOT NULL DEFAULT 'PRE_TRADE',
  "action" "OrchestrationAction" NOT NULL,
  "strategy" TEXT,
  "marketRegime" TEXT,
  "regimeLifecyclePhase" TEXT,
  "confidenceOriginal" DOUBLE PRECISION,
  "confidenceAdjusted" DOUBLE PRECISION,
  "confidencePenalty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "riskMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "suppressionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "orchestrationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "uncertaintyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "edgeHealthScore" DOUBLE PRECISION,
  "clusterRiskScore" DOUBLE PRECISION,
  "vetoLayer" TEXT,
  "vetoReasons" JSONB,
  "reasonMap" JSONB,
  "factorWeights" JSONB,
  "forensicReport" JSONB,
  "adaptiveActions" JSONB,
  "learningSchemaVersion" TEXT NOT NULL DEFAULT 'learning-v1',
  "orchestrationVersion" TEXT NOT NULL DEFAULT 'orchestration-v1',
  "regimeModelVersion" TEXT NOT NULL DEFAULT 'regime-v1',
  "featureVectorVersion" TEXT NOT NULL DEFAULT 'features-v1',
  "criticVersion" TEXT NOT NULL DEFAULT 'critic-v1',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrchestrationDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrchestrationUncertaintySnapshot" (
  "id" TEXT NOT NULL,
  "orchestrationDecisionId" TEXT,
  "executionId" TEXT,
  "tradeId" TEXT,
  "positionId" TEXT,
  "symbol" TEXT,
  "marketRegime" TEXT,
  "uncertaintyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "confidenceReliability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "predictionStability" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "decisionAmbiguity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "conflictingSignalScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "dataConfidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "manipulationSuspicion" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reasonMap" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrchestrationUncertaintySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrchestrationEdgeHealthSnapshot" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "strategy" TEXT NOT NULL,
  "symbol" TEXT,
  "marketRegime" TEXT,
  "horizon" TEXT,
  "rollingWindow" INTEGER NOT NULL DEFAULT 50,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "rollingWinrate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rollingEv" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "regimeExpectancy" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "strategyDecayScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "falsePositiveScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "drawdownAcceleration" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "confidenceCalibrationError" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "edgeStabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "manipulationExposure" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "volatilityExposure" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "slippageDegradation" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "executionQualityDrift" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "diagnostics" JSONB,
  "recommendedActions" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrchestrationEdgeHealthSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrchestrationClusterSnapshot" (
  "id" TEXT NOT NULL,
  "clusterKey" TEXT NOT NULL,
  "clusterType" TEXT NOT NULL,
  "symbol" TEXT,
  "strategy" TEXT,
  "marketRegime" TEXT,
  "sessionKey" TEXT,
  "sampleCount" INTEGER NOT NULL DEFAULT 0,
  "consecutiveLosses" INTEGER NOT NULL DEFAULT 0,
  "sameRegimeLosses" INTEGER NOT NULL DEFAULT 0,
  "manipulationLosses" INTEGER NOT NULL DEFAULT 0,
  "volatilityClusterScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "executionDegradationScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "marketHostilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "recommendedAction" TEXT,
  "cooldownUntil" TIMESTAMP(3),
  "evidence" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrchestrationClusterSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrchestrationAdaptiveAction" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "orchestrationDecisionId" TEXT,
  "actionType" "OrchestrationAdaptiveActionType" NOT NULL,
  "scope" TEXT NOT NULL,
  "targetKey" TEXT,
  "status" "OrchestrationPersistenceStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "thresholdDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "confidenceDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sizeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "riskMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "cooldownUntil" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "disabledAt" TIMESTAMP(3),
  "parameters" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrchestrationAdaptiveAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrchestrationPersistenceOutbox" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "eventType" "OrchestrationEventType" NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT,
  "status" "OrchestrationPersistenceStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "nextRetryAt" TIMESTAMP(3),
  "lockedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "payload" JSONB NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrchestrationPersistenceOutbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrchestrationPersistenceAudit" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "outboxId" TEXT,
  "eventType" "OrchestrationEventType" NOT NULL,
  "targetModel" TEXT NOT NULL,
  "targetId" TEXT,
  "status" "OrchestrationPersistenceStatus" NOT NULL,
  "message" TEXT NOT NULL,
  "error" TEXT,
  "payload" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrchestrationPersistenceAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrchestrationDecision_idempotencyKey_key" ON "OrchestrationDecision"("idempotencyKey");
CREATE INDEX "OrchestrationDecision_userId_createdAt_idx" ON "OrchestrationDecision"("userId", "createdAt");
CREATE INDEX "OrchestrationDecision_symbol_createdAt_idx" ON "OrchestrationDecision"("symbol", "createdAt");
CREATE INDEX "OrchestrationDecision_executionId_createdAt_idx" ON "OrchestrationDecision"("executionId", "createdAt");
CREATE INDEX "OrchestrationDecision_positionId_createdAt_idx" ON "OrchestrationDecision"("positionId", "createdAt");
CREATE INDEX "OrchestrationDecision_action_createdAt_idx" ON "OrchestrationDecision"("action", "createdAt");
CREATE INDEX "OrchestrationDecision_marketRegime_strategy_createdAt_idx" ON "OrchestrationDecision"("marketRegime", "strategy", "createdAt");

CREATE INDEX "OrchestrationUncertaintySnapshot_orchestrationDecisionId_idx" ON "OrchestrationUncertaintySnapshot"("orchestrationDecisionId");
CREATE INDEX "OrchestrationUncertaintySnapshot_symbol_createdAt_idx" ON "OrchestrationUncertaintySnapshot"("symbol", "createdAt");
CREATE INDEX "OrchestrationUncertaintySnapshot_marketRegime_createdAt_idx" ON "OrchestrationUncertaintySnapshot"("marketRegime", "createdAt");
CREATE INDEX "OrchestrationUncertaintySnapshot_uncertaintyScore_createdAt_idx" ON "OrchestrationUncertaintySnapshot"("uncertaintyScore", "createdAt");

CREATE INDEX "OrchestrationEdgeHealthSnapshot_userId_createdAt_idx" ON "OrchestrationEdgeHealthSnapshot"("userId", "createdAt");
CREATE INDEX "OrchestrationEdgeHealthSnapshot_strategy_marketRegime_createdAt_idx" ON "OrchestrationEdgeHealthSnapshot"("strategy", "marketRegime", "createdAt");
CREATE INDEX "OrchestrationEdgeHealthSnapshot_symbol_createdAt_idx" ON "OrchestrationEdgeHealthSnapshot"("symbol", "createdAt");
CREATE INDEX "OrchestrationEdgeHealthSnapshot_edgeStabilityScore_createdAt_idx" ON "OrchestrationEdgeHealthSnapshot"("edgeStabilityScore", "createdAt");

CREATE INDEX "OrchestrationClusterSnapshot_clusterKey_createdAt_idx" ON "OrchestrationClusterSnapshot"("clusterKey", "createdAt");
CREATE INDEX "OrchestrationClusterSnapshot_clusterType_createdAt_idx" ON "OrchestrationClusterSnapshot"("clusterType", "createdAt");
CREATE INDEX "OrchestrationClusterSnapshot_symbol_createdAt_idx" ON "OrchestrationClusterSnapshot"("symbol", "createdAt");
CREATE INDEX "OrchestrationClusterSnapshot_strategy_marketRegime_createdAt_idx" ON "OrchestrationClusterSnapshot"("strategy", "marketRegime", "createdAt");
CREATE INDEX "OrchestrationClusterSnapshot_cooldownUntil_idx" ON "OrchestrationClusterSnapshot"("cooldownUntil");

CREATE INDEX "OrchestrationAdaptiveAction_userId_createdAt_idx" ON "OrchestrationAdaptiveAction"("userId", "createdAt");
CREATE INDEX "OrchestrationAdaptiveAction_orchestrationDecisionId_idx" ON "OrchestrationAdaptiveAction"("orchestrationDecisionId");
CREATE INDEX "OrchestrationAdaptiveAction_actionType_status_idx" ON "OrchestrationAdaptiveAction"("actionType", "status");
CREATE INDEX "OrchestrationAdaptiveAction_scope_targetKey_status_idx" ON "OrchestrationAdaptiveAction"("scope", "targetKey", "status");
CREATE INDEX "OrchestrationAdaptiveAction_cooldownUntil_idx" ON "OrchestrationAdaptiveAction"("cooldownUntil");

CREATE UNIQUE INDEX "OrchestrationPersistenceOutbox_idempotencyKey_key" ON "OrchestrationPersistenceOutbox"("idempotencyKey");
CREATE INDEX "OrchestrationPersistenceOutbox_status_nextRetryAt_idx" ON "OrchestrationPersistenceOutbox"("status", "nextRetryAt");
CREATE INDEX "OrchestrationPersistenceOutbox_eventType_createdAt_idx" ON "OrchestrationPersistenceOutbox"("eventType", "createdAt");
CREATE INDEX "OrchestrationPersistenceOutbox_aggregateType_aggregateId_idx" ON "OrchestrationPersistenceOutbox"("aggregateType", "aggregateId");

CREATE INDEX "OrchestrationPersistenceAudit_userId_createdAt_idx" ON "OrchestrationPersistenceAudit"("userId", "createdAt");
CREATE INDEX "OrchestrationPersistenceAudit_outboxId_idx" ON "OrchestrationPersistenceAudit"("outboxId");
CREATE INDEX "OrchestrationPersistenceAudit_eventType_status_createdAt_idx" ON "OrchestrationPersistenceAudit"("eventType", "status", "createdAt");
CREATE INDEX "OrchestrationPersistenceAudit_targetModel_targetId_idx" ON "OrchestrationPersistenceAudit"("targetModel", "targetId");

ALTER TABLE "OrchestrationDecision" ADD CONSTRAINT "OrchestrationDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrchestrationUncertaintySnapshot" ADD CONSTRAINT "OrchestrationUncertaintySnapshot_orchestrationDecisionId_fkey" FOREIGN KEY ("orchestrationDecisionId") REFERENCES "OrchestrationDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrchestrationEdgeHealthSnapshot" ADD CONSTRAINT "OrchestrationEdgeHealthSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrchestrationAdaptiveAction" ADD CONSTRAINT "OrchestrationAdaptiveAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrchestrationAdaptiveAction" ADD CONSTRAINT "OrchestrationAdaptiveAction_orchestrationDecisionId_fkey" FOREIGN KEY ("orchestrationDecisionId") REFERENCES "OrchestrationDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrchestrationPersistenceAudit" ADD CONSTRAINT "OrchestrationPersistenceAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrchestrationPersistenceAudit" ADD CONSTRAINT "OrchestrationPersistenceAudit_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "OrchestrationPersistenceOutbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
