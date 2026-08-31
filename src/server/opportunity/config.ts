import { env } from "@/lib/config";

export type OpportunityEngineConfig = {
  scanIntervalMs: number;
  minQuoteVolume24h: number;
  watchThreshold: number;
  hotThreshold: number;
  dropThreshold: number;
  topK: number;
  deepSubscriptionLimit: number;
  candidateTtlMs: number;
  laneQuotas: { EARLY: number; STEADY: number; MOMENTUM: number; CONTINUATION: number };
  decayPerIdleScan: number;
  excludedQuotes: string[];
};

export const DEFAULT_OPPORTUNITY_CONFIG: OpportunityEngineConfig = {
  scanIntervalMs: 1_000,
  minQuoteVolume24h: 500_000,
  watchThreshold: 58,
  hotThreshold: 72,
  dropThreshold: 52,
  topK: 28,
  deepSubscriptionLimit: 24,
  candidateTtlMs: 8 * 60_000,
  laneQuotas: { EARLY: 10, STEADY: 5, MOMENTUM: 8, CONTINUATION: 5 },
  decayPerIdleScan: 0.94,
  excludedQuotes: ["USDC", "FDUSD", "TUSD", "BUSD", "DAI"],
};

export function resolveOpportunityConfig(overrides?: Partial<OpportunityEngineConfig>): OpportunityEngineConfig {
  return {
    ...DEFAULT_OPPORTUNITY_CONFIG,
    minQuoteVolume24h: env.OPPORTUNITY_MIN_QUOTE_VOLUME_24H ?? DEFAULT_OPPORTUNITY_CONFIG.minQuoteVolume24h,
    hotThreshold: env.OPPORTUNITY_HOT_THRESHOLD ?? DEFAULT_OPPORTUNITY_CONFIG.hotThreshold,
    watchThreshold: env.OPPORTUNITY_WATCH_THRESHOLD ?? DEFAULT_OPPORTUNITY_CONFIG.watchThreshold,
    topK: env.OPPORTUNITY_TOP_K ?? DEFAULT_OPPORTUNITY_CONFIG.topK,
    deepSubscriptionLimit: env.OPPORTUNITY_DEEP_LIMIT ?? DEFAULT_OPPORTUNITY_CONFIG.deepSubscriptionLimit,
    ...overrides,
  };
}

export const LANE_WEIGHTS = {
  EARLY: {
    priceVelocity: 0.14,
    priceAcceleration: 0.2,
    volumeAcceleration: 0.18,
    relativeVolume: 0.14,
    relativeStrength: 0.12,
    breakout: 0.07,
    compressionExpansion: 0.09,
    consistency: 0.04,
    retracementQuality: 0.02,
    exhaustion: 0.12,
    chaseControl: 0.06,
    liquidity: 0.04,
  },
  STEADY: {
    priceVelocity: 0.08,
    priceAcceleration: 0.08,
    volumeAcceleration: 0.08,
    relativeVolume: 0.08,
    relativeStrength: 0.12,
    breakout: 0.06,
    compressionExpansion: 0.04,
    consistency: 0.2,
    retracementQuality: 0.16,
    exhaustion: 0.1,
    chaseControl: 0.06,
    liquidity: 0.1,
  },
  MOMENTUM: {
    priceVelocity: 0.14,
    priceAcceleration: 0.1,
    volumeAcceleration: 0.12,
    relativeVolume: 0.1,
    relativeStrength: 0.1,
    breakout: 0.14,
    compressionExpansion: 0.04,
    consistency: 0.12,
    retracementQuality: 0.06,
    exhaustion: 0.14,
    chaseControl: 0.1,
    liquidity: 0.06,
  },
  CONTINUATION: {
    priceVelocity: 0.06,
    priceAcceleration: 0.06,
    volumeAcceleration: 0.1,
    relativeVolume: 0.08,
    relativeStrength: 0.1,
    breakout: 0.16,
    compressionExpansion: 0.06,
    consistency: 0.08,
    retracementQuality: 0.18,
    exhaustion: 0.16,
    chaseControl: 0.16,
    liquidity: 0.06,
  },
} as const;
