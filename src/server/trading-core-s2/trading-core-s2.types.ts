import type { SpotMarketRegimeLabel, MomentumBreakoutVerdict, TradingCoreS2JobType } from "@prisma/client";
import type { MarketContext } from "@/src/types/scanner";

export type TradingCoreS2JobPayload =
  | { type: "REGIME_REFRESH" }
  | { type: "DISCOVERY_SCAN"; limit?: number }
  | { type: "DISCOVERY_RANKING" }
  | { type: "MOMENTUM_EVALUATE"; limit?: number }
  | { type: "STATISTICS_UPDATE" };

export type MarketRegimeClassification = {
  regime: SpotMarketRegimeLabel;
  confidence: number;
  regimeStrength: number;
  expectedDurationMinutes: number;
  supportingFeatures: Record<string, number | string | boolean>;
  historicalSimilarity: number;
  btcTrend: number;
  ethTrend: number;
  btcDominance: number;
  volumeExpansion: number;
  atrPercent: number;
  realizedVolatility: number;
  marketBreadth: number;
  usdtPairStrength: number;
  relativeStrength: number;
  marketMomentum: number;
  classifiedAt: string;
};

export type DiscoveryV2ScoreBreakdown = {
  symbol: string;
  discoveryScore: number;
  momentumScore: number;
  volumeScore: number;
  relativeVolume: number;
  trendScore: number;
  breakoutScore: number;
  liquidityScore: number;
  spreadScore: number;
  volatilityScore: number;
  relativeBtcStrength: number;
  relativeEthStrength: number;
  regimeCompatibility: number;
  rejected: boolean;
  rejectReason?: string;
  metadata?: Record<string, unknown>;
};

export type DiscoveryV2Report = {
  topGainers: string[];
  topBreakoutCandidates: string[];
  topMomentum: string[];
  topVolumeExpansion: string[];
  topRelativeStrength: string[];
};

export type MomentumBreakoutEvaluation = {
  symbol: string;
  verdict: MomentumBreakoutVerdict;
  entryProbability: number;
  expectedRr: number;
  expectedHoldingMinutes: number;
  expectedVolatility: number;
  confidence: number;
  relativeVolume: number;
  momentum5m: number;
  momentum15m: number;
  relativeBtcStrength: number;
  relativeEthStrength: number;
  spreadPercent: number;
  features: Record<string, unknown>;
};

export const MOMENTUM_ALLOWED_REGIMES: SpotMarketRegimeLabel[] = [
  "STRONG_BULL",
  "WEAK_BULL",
  "BREAKOUT",
  "PUMP",
];

export const MOMENTUM_BLOCKED_REGIMES: SpotMarketRegimeLabel[] = [
  "STRONG_BEAR",
  "WEAK_BEAR",
  "SIDEWAYS",
  "DISTRIBUTION",
  "DUMP",
  "FAKE_BREAKOUT",
];

export type { SpotMarketRegimeLabel, MomentumBreakoutVerdict, TradingCoreS2JobType };

export type DiscoveryScoreInput = {
  symbol: string;
  context: MarketContext;
  btcChange24h: number;
  ethChange24h: number;
  globalMarketRegime: SpotMarketRegimeLabel;
};
