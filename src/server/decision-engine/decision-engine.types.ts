import type { ExpertOpinionType, ExpertType, MasterDecisionType } from "@prisma/client";
import type { AIAnalysisInput, AIConsensusResult, AIProviderResult } from "@/src/types/ai";

export type ExpertOpinionResult = {
  expertType: ExpertType;
  opinion: ExpertOpinionType;
  confidence: number;
  score: number;
  summary: string;
  positiveFactors: string[];
  negativeFactors: string[];
  topRisks: string[];
  metadata?: Record<string, unknown>;
};

export type DecisionMatrixSnapshot = {
  market: number;
  momentum: number;
  volume: number;
  liquidity: number;
  risk: number;
  news: number;
  execution: number;
  learning: number;
};

export type ConflictPair = {
  expertA: ExpertType;
  opinionA: ExpertOpinionType;
  expertB: ExpertType;
  opinionB: ExpertOpinionType;
  severity: number;
  description: string;
};

export type DecisionAttributionSnapshot = {
  supporters: Array<{ expert: ExpertType; opinion: ExpertOpinionType; score: number }>;
  blockers: Array<{ expert: ExpertType; opinion: ExpertOpinionType; score: number }>;
  confidenceReducers: Array<{ expert: ExpertType; reason: string }>;
};

export type MasterDecisionOutput = {
  decisionId: string;
  symbol: string;
  decision: MasterDecisionType;
  legacyDecision: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
  matrix: DecisionMatrixSnapshot;
  consensusScore: number;
  conflictScore: number;
  agreementScore: number;
  stability: number;
  confidence: number;
  reliability: number;
  expertOpinions: ExpertOpinionResult[];
  conflicts: ConflictPair[];
  attribution: DecisionAttributionSnapshot;
  humanReadable: string;
  watchlist: boolean;
};

export type AdjudicateInput = {
  decisionId: string;
  input: AIAnalysisInput;
  legacyResult: AIConsensusResult;
  providerResults?: AIProviderResult[];
};

export type DecisionEngineJobPayload =
  | { type: "WATCHLIST_RECHECK"; limit?: number }
  | { type: "EXPERT_REPLAY"; decisionId?: string; limit?: number }
  | { type: "EXPERT_PERFORMANCE"; periodDays?: number }
  | { type: "WEIGHT_RECOMMENDATION" };

export const ALL_EXPERT_TYPES: ExpertType[] = [
  "MARKET",
  "MOMENTUM",
  "VOLUME",
  "LIQUIDITY",
  "RISK",
  "NEWS",
  "EXECUTION",
  "LEARNING",
];

export const OPINION_POLARITY: Record<ExpertOpinionType, number> = {
  BUY: 1,
  WEAK_BUY: 0.6,
  HOLD: 0,
  WEAK_SELL: -0.6,
  SELL: -1,
  NO_OPINION: 0,
};

export const WATCHLIST_RECHECK_INTERVALS_MIN = [5, 15, 30] as const;
