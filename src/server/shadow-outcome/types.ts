export const OUTCOME_HORIZONS_MIN = [1, 3, 5, 10, 15, 30, 60, 120] as const;
export type OutcomeHorizonMin = (typeof OUTCOME_HORIZONS_MIN)[number];

export const MOVE_CLASSES = [1, 2, 3, 5, 7, 10, 15, 20] as const;
export type MoveClass = (typeof MOVE_CLASSES)[number];

export const REACH_THRESHOLDS = [1, 2, 3, 5, 7, 10, 15, 20] as const;

export type PriceSource = "live" | "replay" | "synthetic";

export type HorizonOutcome = {
  horizonMin: OutcomeHorizonMin;
  mfePct: number | null;
  maePct: number | null;
  returnPct: number | null;
  timeToMfeMs: number | null;
  complete: boolean;
  quality: "OK" | "OUTCOME_DATA_INCOMPLETE";
};

export type DetectionSnapshot = {
  candidateId: string;
  symbol: string;
  firstDetectedAt: number;
  firstDetectionPrice: number;
  primaryLane: string;
  secondaryEvidence: string[];
  opportunityScore: number;
  opportunityBreakdown: Record<string, number>;
  microScore: number | null;
  microBreakdown: Record<string, number> | null;
  liquidityScore: number | null;
  executionQuality: number | null;
  finalScore: number;
  initialRank: number | null;
  btcReturn1m: number | null;
  btcReturn5m: number | null;
  marketBreadthPctPositive1m: number | null;
  aiStatus: string | null;
  aiModifier: number;
  tdiDecision: string | null;
  reasonCodes: string[];
  warnings: string[];
  rvol1m: number | null;
  priceAccelerationShort: number | null;
  takerBuyRatio5s: number | null;
  source: PriceSource;
  microTiming?: Record<string, number | null> | null;
};

export type JourneyEvent = {
  at: number;
  stage: string;
  lane: string;
  score: number;
  state: string;
};

export type TrackedCandidate = {
  snapshot: Readonly<DetectionSnapshot>;
  journey: JourneyEvent[];
  moveKey: string;
  latestStage: string;
  latestScore: number;
  latestRank: number | null;
  latestAiStatus: string | null;
  latestTdiDecision: string | null;
  hotAt: number | null;
  microConfirmedAt: number | null;
  executionReadyAt: number | null;
  deepSubscriptionAt: number | null;
  lastPrice: number;
  lastPriceAt: number;
  high: number;
  low: number;
  highAt: number;
  outcomes: HorizonOutcome[];
  reachTimes: Record<string, number | null>;
  pricePoints: Array<{ t: number; price: number; high?: number; low?: number }>;
  invalidReason: string | null;
};

export type MoverEvent = {
  symbol: string;
  moveClass: MoveClass;
  horizonMin: number;
  moveStartAt: number;
  moveStartPrice: number;
  thresholdReachedAt: number;
  peakAt: number;
  peakPrice: number;
  peakMovePct: number;
};

export type MissReason =
  | "NOT_DETECTED"
  | "LATE_DETECTION"
  | "LOW_LIQUIDITY"
  | "SCORE_BELOW_THRESHOLD"
  | "TOP_K_DROPPED"
  | "STALE_DATA"
  | "UNIVERSE_EXCLUDED"
  | "UNKNOWN";
