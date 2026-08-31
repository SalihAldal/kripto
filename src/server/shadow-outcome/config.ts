import { env } from "@/lib/config";

export type ShadowOutcomeConfig = {
  minTrackScore: number;
  gapMs: number;
  persistEveryMs: number;
  ordersDisabled: true;
  minSample: number;
};

export const DEFAULT_SHADOW_CONFIG: ShadowOutcomeConfig = {
  minTrackScore: 58,
  gapMs: 120_000,
  persistEveryMs: 30_000,
  ordersDisabled: true,
  minSample: 20,
};

export function resolveShadowConfig(overrides?: Partial<ShadowOutcomeConfig>): ShadowOutcomeConfig {
  return {
    ...DEFAULT_SHADOW_CONFIG,
    minTrackScore: env.SHADOW_MIN_TRACK_SCORE ?? DEFAULT_SHADOW_CONFIG.minTrackScore,
    ...overrides,
    ordersDisabled: true,
  };
}

/** Ground-truth mover: return over rolling window (not 24h). */
export const MOVER_SPECS: Array<{ moveClass: 3 | 5 | 7 | 10 | 15 | 20; horizonMin: number }> = [
  { moveClass: 3, horizonMin: 15 },
  { moveClass: 5, horizonMin: 30 },
  { moveClass: 7, horizonMin: 60 },
  { moveClass: 10, horizonMin: 60 },
  { moveClass: 15, horizonMin: 120 },
  { moveClass: 20, horizonMin: 120 },
];
