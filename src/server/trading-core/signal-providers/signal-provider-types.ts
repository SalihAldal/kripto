import type { TradeSide } from "@/src/server/trading-core/core/types";

export type SignalProviderType = "INTERNAL_AI" | "TRADINGVIEW_WEBHOOK" | "MANUAL_TRADER" | "EXTERNAL_API" | "ML_PREDICTION_ENGINE";
export type SignalProviderStatus = "ACTIVE" | "PAUSED" | "DISABLED";
export type SignalProviderRiskRating = "LOW" | "MEDIUM" | "HIGH" | "BLOCKED";
export type SignalVerificationStatus = "VERIFIED" | "SUSPICIOUS" | "REJECTED";

export type SignalProviderConfig = {
  providerId: string;
  name: string;
  type: SignalProviderType;
  status: SignalProviderStatus;
  priority: number;
  baseScore: number;
  riskRating: SignalProviderRiskRating;
  minConfidence: number;
  supportedPairs: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProviderSignalInput = {
  providerId: string;
  symbol: string;
  side: TradeSide;
  confidence: number;
  score?: number;
  price?: number;
  timeframe?: string;
  strategy?: string;
  sourceTimestamp?: string;
  payload?: Record<string, unknown>;
};

export type ProviderSignalVerification = {
  status: SignalVerificationStatus;
  verified: boolean;
  fakeSignalScore: number;
  confidenceScore: number;
  reasons: string[];
};

export type ProviderSignal = ProviderSignalInput & {
  signalId: string;
  providerType: SignalProviderType;
  providerName: string;
  providerScore: number;
  priorityScore: number;
  riskRating: SignalProviderRiskRating;
  verification: ProviderSignalVerification;
  receivedAt: string;
};

export type ProviderPerformanceSample = {
  providerId: string;
  signalId?: string;
  realizedPnl: number;
  won?: boolean;
  latencyMs?: number;
  verified?: boolean;
  createdAt?: string;
};

export type SignalProviderPerformance = {
  providerId: string;
  signalCount: number;
  verifiedSignals: number;
  suspiciousSignals: number;
  rejectedSignals: number;
  winrate: number;
  totalPnl: number;
  averagePnl: number;
  providerScore: number;
  riskRating: SignalProviderRiskRating;
  updatedAt: string;
};

export type ProviderConsensus = {
  symbol: string;
  side: TradeSide;
  confidence: number;
  score: number;
  selectedProviderId?: string;
  providerSignals: ProviderSignal[];
  reasons: string[];
  generatedAt: string;
};

export type SignalProviderSnapshot = {
  providers: SignalProviderConfig[];
  performance: SignalProviderPerformance[];
  recentSignals: ProviderSignal[];
  updatedAt: string;
};
