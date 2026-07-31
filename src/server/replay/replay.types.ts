import type { DecisionVerdict, ReplayJobCadence, ReplayWorkerJobType } from "@prisma/client";

export const REPLAY_HORIZONS = [
  { label: "5m", ms: 5 * 60_000 },
  { label: "15m", ms: 15 * 60_000 },
  { label: "30m", ms: 30 * 60_000 },
  { label: "1h", ms: 60 * 60_000 },
  { label: "4h", ms: 4 * 60 * 60_000 },
  { label: "12h", ms: 12 * 60 * 60_000 },
  { label: "24h", ms: 24 * 60 * 60_000 },
  { label: "3d", ms: 3 * 24 * 60 * 60_000 },
  { label: "7d", ms: 7 * 24 * 60 * 60_000 },
] as const;

export type ReplayHorizonLabel = (typeof REPLAY_HORIZONS)[number]["label"];

export type PriceCandle = {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type PricePathResult = {
  candles: PriceCandle[];
  priceAtDecision: number;
  source: "market_snapshot" | "trade_event_log" | "klines" | "decision_log" | "mixed";
  coveragePct: number;
};

export type ReplayMetrics = {
  mfePct: number;
  maePct: number;
  peakProfitPct: number;
  maxDrawdownPct: number;
  atrMultiple: number | null;
  relativeStrengthAfter: number | null;
  volumeChangePct: number | null;
  volatilityChangePct: number | null;
  marketRegimeAfter: string | null;
  highestPrice: number;
  lowestPrice: number;
  horizonReturns: Record<string, number>;
};

export type ReplayJobPayload =
  | { type: "REPLAY_SINGLE"; decisionId: string; cadence?: ReplayJobCadence }
  | { type: "REPLAY_BATCH"; limit?: number; since?: string; cadence?: ReplayJobCadence; resumeCursor?: string }
  | { type: "REPLAY_DAILY" }
  | { type: "REPLAY_WEEKLY" }
  | { type: "REPLAY_MONTHLY" }
  | { type: "EVALUATE_REJECTED"; limit?: number }
  | { type: "SCAN_MISSED_OPPORTUNITIES"; limit?: number }
  | { type: "AGGREGATE_STATISTICS"; cadence?: ReplayJobCadence; periodDays?: number };

export type ReplayDashboardSummary = {
  replaySummary: {
    totalReplayed: number;
    totalPending: number;
    totalFailed: number;
    avgAccuracyPct: number | null;
    missedWinnersCount: number;
    falseRejectCount: number;
  };
  missedWinners: Array<Record<string, unknown>>;
  falseRejects: Array<Record<string, unknown>>;
  worstDecisions: Array<Record<string, unknown>>;
  bestDecisions: Array<Record<string, unknown>>;
  accuracyByStrategy: Array<Record<string, unknown>>;
  accuracyByMarketRegime: Array<Record<string, unknown>>;
  accuracyBySymbol: Array<Record<string, unknown>>;
  accuracyByTimeframe: Array<Record<string, unknown>>;
  rejectAccuracy: Array<Record<string, unknown>>;
  weightRecommendations: Array<Record<string, unknown>>;
};

export type VerdictInput = {
  originalDecision: string;
  executionAllowed: boolean;
  metrics: ReplayMetrics;
  confidence?: number | null;
};

export { DecisionVerdict, ReplayJobCadence, ReplayWorkerJobType };
