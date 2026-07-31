import type { DecisionTimelineStage } from "@prisma/client";
import type { AIAnalysisInput, AIConsensusResult } from "@/src/types/ai";
import type { ScannerCandidate } from "@/src/types/scanner";
import type { SignalQualityResult } from "@/src/server/execution/signal-quality-gate.service";

export type DecisionOutcomeLabel = "NO_TRADE" | "HOLD" | "BUY" | "SELL" | "REJECT" | "APPROVE" | "CAUTION" | "UNKNOWN";

export type RejectReasonInput = {
  reason: string;
  category: string;
  weight: number;
  severity: number;
  rank?: number;
};

export type DecisionScoreSnapshot = {
  scannerScore?: number | null;
  technicalScore?: number | null;
  volumeScore?: number | null;
  momentumScore?: number | null;
  trendScore?: number | null;
  regimeScore?: number | null;
  riskScore?: number | null;
  liquidityScore?: number | null;
  newsScore?: number | null;
  confidence?: number | null;
};

export type FeatureSnapshotInput = {
  indicators?: Record<string, unknown> | null;
  momentum?: Record<string, unknown> | null;
  volume?: Record<string, unknown> | null;
  orderBook?: Record<string, unknown> | null;
  liquidity?: Record<string, unknown> | null;
  spread?: Record<string, unknown> | null;
  volatility?: Record<string, unknown> | null;
  atr?: Record<string, unknown> | null;
  vwap?: Record<string, unknown> | null;
  rsi?: Record<string, unknown> | null;
  macd?: Record<string, unknown> | null;
  ema?: Record<string, unknown> | null;
  regime?: Record<string, unknown> | null;
  funding?: Record<string, unknown> | null;
  openInterest?: Record<string, unknown> | null;
  whale?: Record<string, unknown> | null;
  news?: Record<string, unknown> | null;
  raw?: Record<string, unknown> | null;
};

export type DecisionTimelineInput = {
  stage: DecisionTimelineStage;
  outcome: string;
  message?: string;
  details?: Record<string, unknown>;
};

export type BeginDecisionTraceInput = {
  decisionId: string;
  analysisId?: string;
  symbol: string;
  deferPersistence?: boolean;
  source?: string;
};

export type FinalizeDecisionLogInput = {
  decisionId: string;
  analysisId?: string;
  symbol: string;
  decision: DecisionOutcomeLabel | string;
  executionAllowed: boolean;
  humanSummary?: string;
  strategyUsed?: string;
  marketState?: Record<string, unknown>;
  scores?: DecisionScoreSnapshot;
  rejectReasons?: RejectReasonInput[];
  features?: FeatureSnapshotInput;
  metadata?: Record<string, unknown>;
};

export type ScannerDecisionObservabilityInput = {
  decisionId: string;
  symbol: string;
  scannerScore: number;
  scannerConfidence: number;
  status: string;
  reasons: string[];
  metrics?: Record<string, unknown>;
  contextMetadata?: Record<string, unknown>;
};

export type AiDecisionObservabilityInput = {
  decisionId: string;
  symbol: string;
  input: AIAnalysisInput;
  result: AIConsensusResult;
  scannerScore?: number;
};

export type QualityGateObservabilityInput = {
  decisionId: string;
  symbol: string;
  qualityGate: SignalQualityResult;
};

export type ExecutionDecisionObservabilityInput = {
  decisionId: string;
  symbol: string;
  opened: boolean;
  rejected: boolean;
  rejectReason?: string;
  decision?: string;
  candidate?: ScannerCandidate;
  ai?: AIConsensusResult;
  qualityGate?: SignalQualityResult;
  metadata?: Record<string, unknown>;
};
