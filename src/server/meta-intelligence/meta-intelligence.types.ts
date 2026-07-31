import type { CommitteeRole, ExecutiveNarrativeType, ExecutivePriority, ExecutiveReportType, MarketRegime, MetaIntelligenceJobType, StrategicObjectiveType } from "@prisma/client";

export type MetaIntelligenceJobPayload =
  | { type: "CONTEXT_BUILD" }
  | { type: "CONTEXT_FUSION"; contextId?: string }
  | { type: "CONFLICT_RESOLVE"; contextId?: string }
  | { type: "CONFIDENCE_CALIBRATE"; contextId?: string }
  | { type: "EXECUTIVE_REASON"; contextId?: string }
  | { type: "NARRATIVE_BUILD"; limit?: number }
  | { type: "PRIORITY_RANK"; limit?: number }
  | { type: "COMMITTEE_MEET"; topic?: string }
  | { type: "EXECUTIVE_REPORT"; reportType?: ExecutiveReportType }
  | { type: "EXECUTIVE_LEARN"; limit?: number }
  | { type: "KNOWLEDGE_BUILD"; limit?: number }
  | { type: "FUTURE_PLAN" }
  | { type: "KPI_TRACK" }
  | { type: "STRATEGIC_OBJECTIVES" };

export type GlobalMarketContext = {
  marketRegime: MarketRegime;
  scanner: Record<string, unknown>;
  news: Record<string, unknown>;
  whale: Record<string, unknown>;
  onChain: Record<string, unknown>;
  portfolio: Record<string, unknown>;
  risk: Record<string, unknown>;
  learning: Record<string, unknown>;
  research: Record<string, unknown>;
  governance: Record<string, unknown>;
  engineering: Record<string, unknown>;
};

export type ConfidenceScores = {
  overallConfidence: number;
  dataConfidence: number;
  marketConfidence: number;
  executionConfidence: number;
  portfolioConfidence: number;
  modelConfidence: number;
};

export type CommitteeOpinion = {
  role: CommitteeRole;
  opinion: string;
  stance: "BULLISH" | "BEARISH" | "NEUTRAL" | "CAUTIOUS";
  confidence: number;
};

export const COMMITTEE_ROLES: CommitteeRole[] = [
  "RISK_OFFICER", "PORTFOLIO_MANAGER", "RESEARCH_DIRECTOR", "MARKET_STRATEGIST",
  "MACRO_ANALYST", "EXECUTION_DIRECTOR", "NEWS_DIRECTOR", "WHALE_DIRECTOR",
  "ONCHAIN_DIRECTOR", "META_AI",
];

export const META_EVENT = {
  CONTEXT_BUILT: "MetaContextBuilt",
  CONFLICT_RESOLVED: "ExecutiveConflictResolved",
  DECISION_MADE: "ExecutiveDecisionMade",
  NARRATIVE_UPDATED: "MarketNarrativeUpdated",
  COMMITTEE_CONVENED: "CommitteeMeetingHeld",
  REPORT_GENERATED: "ExecutiveReportGenerated",
  RECOMMENDATION_CREATED: "ExecutiveRecommendationCreated",
  KPI_RECORDED: "ExecutiveKpiRecorded",
  KNOWLEDGE_UPDATED: "MetaKnowledgeUpdated",
} as const;

export type { CommitteeRole, ExecutiveNarrativeType, ExecutivePriority, ExecutiveReportType, MarketRegime, MetaIntelligenceJobType, StrategicObjectiveType };
