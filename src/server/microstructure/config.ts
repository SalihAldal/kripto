import { env } from "@/lib/config";
import type { OpportunityLane } from "@/src/server/opportunity/types";
import type { MicroScoreBreakdown } from "@/src/server/microstructure/types";

export type MicrostructureConfig = {
  deepLimit: number;
  warmupMs: number;
  warmupTrades: number;
  aiMaxModifier: number;
  intendedNotional: number;
  confirmThreshold: number;
  executionThreshold: number;
  dropThreshold: number;
  staleMs: number;
  ttlMs: number;
  extremeSpreadBps: number;
  wideSpreadBps: number;
};

export const DEFAULT_MICRO_CONFIG: MicrostructureConfig = {
  deepLimit: 24,
  warmupMs: 400,
  warmupTrades: 8,
  aiMaxModifier: 8,
  intendedNotional: 50,
  confirmThreshold: 62,
  executionThreshold: 70,
  dropThreshold: 48,
  staleMs: 5_000,
  ttlMs: 8 * 60_000,
  extremeSpreadBps: 400,
  wideSpreadBps: 80,
};

export function resolveMicroConfig(overrides?: Partial<MicrostructureConfig>): MicrostructureConfig {
  return {
    ...DEFAULT_MICRO_CONFIG,
    deepLimit: env.MICRO_DEEP_LIMIT ?? DEFAULT_MICRO_CONFIG.deepLimit,
    warmupMs: env.MICRO_WARMUP_MS ?? DEFAULT_MICRO_CONFIG.warmupMs,
    warmupTrades: env.MICRO_WARMUP_TRADES ?? DEFAULT_MICRO_CONFIG.warmupTrades,
    aiMaxModifier: env.MICRO_AI_MAX_MODIFIER ?? DEFAULT_MICRO_CONFIG.aiMaxModifier,
    intendedNotional: env.MICRO_INTENDED_NOTIONAL ?? DEFAULT_MICRO_CONFIG.intendedNotional,
    ...overrides,
  };
}

export const FINAL_WEIGHTS = {
  opportunity: 0.42,
  micro: 0.38,
  liquidity: 0.2,
} as const;

export const MICRO_LANE_WEIGHTS: Record<OpportunityLane, MicroScoreBreakdown> = {
  EARLY: {
    takerBuyRatio: 0.12,
    buyFlowAcceleration: 0.18,
    tradeAcceleration: 0.14,
    askDepletion: 0.14,
    bidSupport: 0.08,
    depthImbalance: 0.1,
    breakoutAcceptance: 0.08,
    spreadQuality: 0.08,
    exhaustion: 0.1,
    divergence: 0.08,
  },
  STEADY: {
    takerBuyRatio: 0.1,
    buyFlowAcceleration: 0.08,
    tradeAcceleration: 0.08,
    askDepletion: 0.08,
    bidSupport: 0.16,
    depthImbalance: 0.1,
    breakoutAcceptance: 0.06,
    spreadQuality: 0.16,
    exhaustion: 0.1,
    divergence: 0.08,
  },
  MOMENTUM: {
    takerBuyRatio: 0.16,
    buyFlowAcceleration: 0.12,
    tradeAcceleration: 0.1,
    askDepletion: 0.12,
    bidSupport: 0.08,
    depthImbalance: 0.08,
    breakoutAcceptance: 0.14,
    spreadQuality: 0.08,
    exhaustion: 0.12,
    divergence: 0.1,
  },
  CONTINUATION: {
    takerBuyRatio: 0.1,
    buyFlowAcceleration: 0.1,
    tradeAcceleration: 0.08,
    askDepletion: 0.1,
    bidSupport: 0.1,
    depthImbalance: 0.08,
    breakoutAcceptance: 0.14,
    spreadQuality: 0.08,
    exhaustion: 0.16,
    divergence: 0.12,
  },
};
