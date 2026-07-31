import type {
  ConflictSeverity,
  FusionAssetClass,
  FusionValidationStatus,
  IntelligenceFusionJobType,
  IntelligenceSourceType,
} from "@prisma/client";

export type IntelligenceFusionJobPayload =
  | { type: "FUSION_PIPELINE"; assetClass?: FusionAssetClass; symbol?: string }
  | { type: "CONFLICT_RESOLVE"; fusionId?: string }
  | { type: "SOURCE_RELIABILITY" }
  | { type: "NARRATIVE_BUILD"; fusionId?: string }
  | { type: "EVIDENCE_COLLECT"; fusionId?: string }
  | { type: "FUSION_REPLAY"; timelineKey?: string; limit?: number }
  | { type: "QUALITY_SCORE"; fusionId?: string }
  | { type: "KNOWLEDGE_INTEGRATE"; fusionId?: string }
  | { type: "VALIDATE_PUBLISH"; fusionId?: string };

export type CanonicalScores = {
  marketScore: number;
  trendScore: number;
  momentumScore: number;
  volumeScore: number;
  liquidityScore: number;
  orderBookScore: number;
  newsScore: number;
  whaleScore: number;
  onChainScore: number;
  portfolioScore: number;
  riskScore: number;
  learningScore: number;
  researchScore: number;
  macroScore: number;
  regimeScore: number;
  volatilityScore: number;
  confidenceScore: number;
};

export type SourceSnapshots = {
  marketSnapshot: Record<string, unknown>;
  scanner: Record<string, unknown>;
  news: Record<string, unknown>;
  whale: Record<string, unknown>;
  onChain: Record<string, unknown>;
  portfolio: Record<string, unknown>;
  learning: Record<string, unknown>;
  research: Record<string, unknown>;
  risk: Record<string, unknown>;
  metaAi: Record<string, unknown>;
  governance: Record<string, unknown>;
};

export type ConfidenceFusion = {
  dataConfidence: number;
  sourceConfidence: number;
  historicalConfidence: number;
  consensusConfidence: number;
  predictionConfidence: number;
  overallConfidence: number;
};

export type ConflictEntry = {
  sourceA: string;
  sourceB: string;
  signalA: string;
  signalB: string;
  severity: ConflictSeverity;
};

export type EvidenceItem = {
  scoreName: string;
  source: IntelligenceSourceType;
  value: number;
  supportingEvidence: Record<string, unknown>;
  freshness: number;
  historicalAccuracy: number;
  reliability: number;
};

export const FUSION_SOURCES: IntelligenceSourceType[] = [
  "MARKET_SNAPSHOT", "SCANNER", "NEWS", "WHALE", "ONCHAIN",
  "PORTFOLIO", "LEARNING", "RESEARCH", "RISK", "META_AI", "GOVERNANCE",
];

export const FUSION_EVENT = {
  FUSION_STARTED: "FusionStarted",
  FUSION_COMPLETED: "FusionCompleted",
  INTELLIGENCE_PUBLISHED: "IntelligencePublished",
  CONFLICT_DETECTED: "ConflictDetected",
  CONFLICT_RESOLVED: "ConflictResolved",
  NARRATIVE_BUILT: "NarrativeBuilt",
  EVIDENCE_COLLECTED: "EvidenceCollected",
  QUALITY_SCORED: "QualityScored",
  SOURCE_RELIABILITY_UPDATED: "SourceReliabilityUpdated",
  VALIDATION_PASSED: "ValidationPassed",
  VALIDATION_FAILED: "ValidationFailed",
  TIMELINE_RECORDED: "TimelineRecorded",
  KNOWLEDGE_INTEGRATED: "KnowledgeIntegrated",
} as const;

export type { ConflictSeverity, FusionAssetClass, FusionValidationStatus, IntelligenceFusionJobType, IntelligenceSourceType };
