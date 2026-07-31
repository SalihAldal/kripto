import type {
  DiscoveryAssetClass,
  DiscoveryLaneType,
  DiscoveryRegime,
  DiscoveryTier,
  DiscoveryUniverseSource,
} from "@prisma/client";
import type { MarketContext } from "@/src/types/scanner";

export type DiscoveryTradeType =
  | "SPOT"
  | "SWING"
  | "SCALP"
  | "MOMENTUM"
  | "BREAKOUT"
  | "POSITION"
  | "INVESTMENT";

export type UniverseSymbol = {
  symbol: string;
  exchange: string;
  marketType: "SPOT" | "FUTURES" | "ALPHA" | "OTHER";
  quoteAsset: string;
  baseAsset?: string;
  source: DiscoveryUniverseSource;
  status: string;
  zone?: string;
  isNewListing?: boolean;
  isDelistingCandidate?: boolean;
  listedAt?: Date;
  metadata?: Record<string, unknown>;
};

export type HealthCheckResult = {
  symbol: string;
  healthy: boolean;
  rejectReason?: string;
  exchangeOnline: boolean;
  candlesOk: boolean;
  dataQualityScore: number;
  metadata?: Record<string, unknown>;
};

export type LaneScoreResult = {
  lane: DiscoveryLaneType;
  score: number;
  reasons: string[];
  metadata?: Record<string, unknown>;
};

export type ScannerProfileDimensions = {
  momentum: number;
  trend: number;
  volume: number;
  whale: number;
  news: number;
  liquidity: number;
  funding: number;
  risk: number;
  relativeStrength: number;
  volatility: number;
  breakout: number;
  continuation: number;
  exhaustion: number;
};

export type DiscoveryProfileOutput = {
  symbol: string;
  assetClass: DiscoveryAssetClass;
  regime: DiscoveryRegime;
  opportunityScore: number;
  confidence: number;
  tier: DiscoveryTier;
  summary: string;
  positiveFactors: string[];
  negativeFactors: string[];
  tradeTypes: DiscoveryTradeType[];
  dimensions: ScannerProfileDimensions;
  laneScores: LaneScoreResult[];
  profile: Record<string, unknown>;
  health: HealthCheckResult;
};

export type DiscoveryBatchInput = {
  symbol: string;
  context?: MarketContext;
  universeMeta?: UniverseSymbol;
};

export type DiscoveryBatchResult = {
  scannedAt: string;
  totalSymbols: number;
  healthySymbols: number;
  profiles: DiscoveryProfileOutput[];
  rankings: Array<{ symbol: string; rank: number; tier: DiscoveryTier; opportunityScore: number }>;
};

export type DiscoveryJobPayload =
  | { type: "UNIVERSE_SYNC"; limit?: number }
  | { type: "HEALTH_CHECK"; symbols?: string[]; limit?: number }
  | { type: "DISCOVERY_CYCLE"; symbols?: string[]; limit?: number }
  | { type: "LANE_SCAN"; lane: DiscoveryLaneType; symbols?: string[]; limit?: number }
  | { type: "RANKING"; limit?: number }
  | { type: "LISTING_WATCH" };

export const ALL_DISCOVERY_LANES: DiscoveryLaneType[] = [
  "MOMENTUM",
  "BREAKOUT",
  "WHALE",
  "VOLUME_EXPLOSION",
  "SMART_MONEY",
  "TREND",
  "RELATIVE_STRENGTH",
  "NEWS",
  "FUNDING",
  "OPEN_INTEREST",
  "LIQUIDATION",
  "ORDERBOOK",
  "LOW_CAP",
  "HIGH_VOLUME",
  "NEW_LISTING",
  "MEME",
  "AI_COIN",
  "RWA",
  "DEPIN",
  "ARBITRAGE",
  "ANOMALY",
];

export const PROFILE_DIMENSION_KEYS: Array<keyof ScannerProfileDimensions> = [
  "momentum",
  "trend",
  "volume",
  "whale",
  "news",
  "liquidity",
  "funding",
  "risk",
  "relativeStrength",
  "volatility",
  "breakout",
  "continuation",
  "exhaustion",
];
