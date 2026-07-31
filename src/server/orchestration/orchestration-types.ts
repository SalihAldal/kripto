import type {
  OrchestrationAction,
  OrchestrationAdaptiveActionType,
  OrchestrationEventType,
  OrchestrationPersistenceStatus,
} from "@prisma/client";

export const ORCHESTRATION_VERSIONS = {
  learningSchemaVersion: "learning-v1",
  orchestrationVersion: "orchestration-v1",
  regimeModelVersion: "regime-v1",
  featureVectorVersion: "features-v1",
  criticVersion: "critic-v1",
} as const;

export type OrchestrationVersions = typeof ORCHESTRATION_VERSIONS;

export type OrchestrationReasonMap = Record<string, string[]>;

export type OrchestrationAdaptiveRecommendation = {
  actionType: OrchestrationAdaptiveActionType;
  scope: string;
  targetKey?: string;
  reason: string;
  confidence: number;
  thresholdDelta?: number;
  confidenceDelta?: number;
  sizeMultiplier?: number;
  riskMultiplier?: number;
  cooldownUntil?: string;
  parameters?: Record<string, unknown>;
};

export type OrchestrationDecisionInput = {
  userId?: string;
  idempotencyKey: string;
  executionId?: string;
  tradeId?: string;
  positionId?: string;
  symbol?: string;
  mode?: string;
  decisionStage?: string;
  action: OrchestrationAction;
  strategy?: string;
  marketRegime?: string;
  regimeLifecyclePhase?: string;
  confidenceOriginal?: number;
  confidenceAdjusted?: number;
  confidencePenalty?: number;
  riskMultiplier?: number;
  suppressionScore?: number;
  orchestrationScore?: number;
  uncertaintyScore?: number;
  edgeHealthScore?: number;
  clusterRiskScore?: number;
  vetoLayer?: string;
  vetoReasons?: string[];
  reasonMap?: OrchestrationReasonMap;
  factorWeights?: Record<string, number>;
  forensicReport?: Record<string, unknown>;
  adaptiveActions?: OrchestrationAdaptiveRecommendation[];
  metadata?: Record<string, unknown>;
};

export type OrchestrationUncertaintyInput = {
  executionId?: string;
  tradeId?: string;
  positionId?: string;
  symbol?: string;
  marketRegime?: string;
  uncertaintyScore: number;
  confidenceReliability: number;
  predictionStability: number;
  decisionAmbiguity: number;
  conflictingSignalScore: number;
  dataConfidenceScore: number;
  manipulationSuspicion: number;
  reasonMap?: OrchestrationReasonMap;
  metadata?: Record<string, unknown>;
};

export type OrchestrationEdgeHealthInput = {
  userId?: string;
  strategy: string;
  symbol?: string;
  marketRegime?: string;
  horizon?: string;
  rollingWindow?: number;
  sampleCount?: number;
  rollingWinrate?: number;
  rollingEv?: number;
  regimeExpectancy?: number;
  strategyDecayScore?: number;
  falsePositiveScore?: number;
  drawdownAcceleration?: number;
  confidenceCalibrationError?: number;
  edgeStabilityScore?: number;
  manipulationExposure?: number;
  volatilityExposure?: number;
  slippageDegradation?: number;
  executionQualityDrift?: number;
  diagnostics?: Record<string, unknown>;
  recommendedActions?: OrchestrationAdaptiveRecommendation[];
  metadata?: Record<string, unknown>;
};

export type OrchestrationClusterInput = {
  clusterKey: string;
  clusterType: string;
  symbol?: string;
  strategy?: string;
  marketRegime?: string;
  sessionKey?: string;
  sampleCount?: number;
  consecutiveLosses?: number;
  sameRegimeLosses?: number;
  manipulationLosses?: number;
  volatilityClusterScore?: number;
  executionDegradationScore?: number;
  marketHostilityScore?: number;
  recommendedAction?: string;
  cooldownUntil?: string;
  evidence?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type OrchestrationPersistenceEnvelope = {
  decision: OrchestrationDecisionInput;
  uncertainty?: OrchestrationUncertaintyInput;
  edgeHealth?: OrchestrationEdgeHealthInput;
  cluster?: OrchestrationClusterInput;
};

export type PersistenceAuditInput = {
  userId?: string;
  outboxId?: string;
  eventType: OrchestrationEventType;
  targetModel: string;
  targetId?: string;
  status: OrchestrationPersistenceStatus;
  message: string;
  error?: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};
