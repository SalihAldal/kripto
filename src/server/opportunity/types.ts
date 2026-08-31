export type OpportunityLane = "EARLY" | "STEADY" | "MOMENTUM" | "CONTINUATION";

export type OpportunityState =
  | "DISCOVERED"
  | "WATCHING"
  | "HOT"
  | "PROMOTED"
  | "COOLING"
  | "EXPIRED";

export type ScoreBreakdown = {
  priceVelocity: number;
  priceAcceleration: number;
  volumeAcceleration: number;
  relativeVolume: number;
  relativeStrength: number;
  breakout: number;
  compressionExpansion: number;
  consistency: number;
  retracementQuality: number;
  exhaustion: number;
  chaseControl: number;
  liquidity: number;
};

export type OpportunityFeatures = {
  return1s: number;
  return5s: number;
  return15s: number;
  return30s: number;
  return1m: number;
  return3m: number;
  return5m: number;
  return15m: number;
  change24h: number;
  velocity5s: number;
  velocity15s: number;
  velocity30s: number;
  velocity1m: number;
  priceAccelerationShort: number;
  priceAccelerationMedium: number;
  accelerationConsistency: number;
  volume1m: number;
  volume3m: number;
  volume5m: number;
  rvol1m: number;
  rvol3m: number;
  rvol5m: number;
  volumeAcceleration: number;
  relativeStrengthBTC1m: number;
  relativeStrengthBTC5m: number;
  relativeStrengthMarket: number;
  distanceTo3mHigh: number;
  distanceTo5mHigh: number;
  breakout3m: number;
  breakout5m: number;
  compressionScore: number;
  expansionScore: number;
  maxRetracement: number;
  retracementRatio: number;
  recoverySpeed: number;
  momentumConsistency: number;
  exhaustionScore: number;
  chaseRisk: number;
  quoteVolume24h: number;
};

export type FilterReasonCode =
  | "LOW_LIQUIDITY"
  | "NEGATIVE_ACCELERATION"
  | "EXHAUSTED"
  | "MARKET_WIDE_MOVE_ONLY"
  | "STALE_DATA"
  | "INSUFFICIENT_VOLUME_SUPPORT"
  | "EXCLUDED_SYMBOL"
  | "NEGATIVE_DIRECTION";

export type OpportunityReasonCode =
  | "EARLY_PRICE_ACCELERATION"
  | "EARLY_VOLUME_ACCELERATION"
  | "RVOL_SPIKE"
  | "RELATIVE_STRENGTH"
  | "BREAKOUT_NEAR"
  | "BREAKOUT_CONFIRMED"
  | "STEADY_TREND"
  | "MOMENTUM_PERSISTENCE"
  | "CONTINUATION_RECOVERY"
  | "VOLUME_ACCELERATION"
  | "COMPRESSION_EXPANSION";

export type OpportunityCandidate = {
  candidateId: string;
  symbol: string;
  primaryLane: OpportunityLane;
  secondaryEvidence: OpportunityLane[];
  score: number;
  laneScores: Record<OpportunityLane, number>;
  breakdown: ScoreBreakdown;
  features: OpportunityFeatures;
  reasonCodes: OpportunityReasonCode[];
  state: OpportunityState;
  firstDetectedAt: number;
  firstDetectionPrice: number;
  lastScoreAt: number;
  lastEvidenceAt: number;
  currentPrice: number;
  scansWithoutEvidence: number;
  deepSubscribed: boolean;
};

export type MarketBreadth = {
  pctPositive1m: number;
  pctPositive5m: number;
  medianReturn1m: number;
  medianReturn5m: number;
  topDecileReturn1m: number;
  btcReturn1m: number;
  btcReturn5m: number;
};

export type OpportunityMilestone = {
  at: number;
  candidateId: string;
  symbol: string;
  event: "CREATED" | "LANE_CHANGE" | "STATE_CHANGE" | "PROMOTED" | "EXPIRED";
  state: OpportunityState;
  primaryLane: OpportunityLane;
  score: number;
  firstDetectionPrice: number;
  currentPrice: number;
};

export type OpportunityScanResult = {
  scannedAt: number;
  universeSize: number;
  evaluated: number;
  staleRejects: number;
  liquidityRejects: number;
  excludedRejects: number;
  ranked: OpportunityCandidate[];
  laneLeaders: Record<OpportunityLane, OpportunityCandidate[]>;
  durationMs: number;
  deepSubscriptions: number;
  filterSamples: Array<{ symbol: string; reason: FilterReasonCode; move5m: number }>;
};
