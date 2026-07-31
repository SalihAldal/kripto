import type {
  LiveReadinessStatus,
  MissedOpportunityCategory,
  PaperTradeSide,
  PaperValidationJobType,
} from "@prisma/client";

export type PaperValidationJobPayload =
  | { type: "SYNC_PORTFOLIO"; userId?: string }
  | { type: "RECORD_TRADES"; userId?: string; limit?: number }
  | { type: "CALCULATE_METRICS"; userId?: string }
  | { type: "COIN_RANKING"; userId?: string }
  | { type: "SESSION_ANALYSIS"; userId?: string }
  | { type: "MISSED_OPPORTUNITY"; userId?: string; limit?: number }
  | { type: "ACCURACY_CHECK"; userId?: string; limit?: number }
  | { type: "RISK_VALIDATION"; userId?: string }
  | { type: "READINESS_SCORE"; userId?: string }
  | { type: "DAILY_REPORT"; userId?: string; date?: string };

export type TradeQualityScores = {
  tradeQualityScore: number;
  entryScore: number;
  exitScore: number;
  executionScore: number;
  decisionScore: number;
  riskScore: number;
  overallScore: number;
};

export type PaperAccuracyMetrics = {
  fillAccuracyPct: number;
  expectedFillPrice: number;
  actualFillPrice: number;
  priceDifference: number;
  latencyMs: number;
  latencyDifferenceMs: number;
};

export type LiveReadinessResult = {
  readinessScore: number;
  status: LiveReadinessStatus;
  gates: {
    minTradesMet: boolean;
    minProfitFactorMet: boolean;
    minWinRateMet: boolean;
    maxDrawdownMet: boolean;
    dataQualityMet: boolean;
    executionQualityMet: boolean;
    replayIntegrityMet: boolean;
  };
  recommendation: string | null;
  blockers: string[];
};

export const SESSION_TYPES = ["ASIAN", "EUROPEAN", "US", "WEEKEND", "WEEKDAY"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const MARKET_REGIMES = [
  "BULL",
  "BEAR",
  "SIDEWAYS",
  "PUMP",
  "DUMP",
  "HIGH_VOLATILITY",
  "LOW_VOLATILITY",
] as const;

export type { LiveReadinessStatus, MissedOpportunityCategory, PaperTradeSide, PaperValidationJobType };

export const PAPER_VALIDATION_EVENT = {
  TRADE_RECORDED: "PaperTradeRecorded",
  TRADE_CLOSED: "PaperTradeClosed",
  PORTFOLIO_SYNCED: "PaperPortfolioSynced",
  READINESS_CALCULATED: "LiveReadinessCalculated",
  DAILY_REPORT_GENERATED: "DailyPaperReportGenerated",
} as const;
