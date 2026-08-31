import { env } from "@/lib/config";

export const LIVE_ACK_PHRASE = "I_UNDERSTAND_LIVE_FUNDS";

export type PaperRuntimeConfig = {
  takerFeeRate: number;
  makerFeeRate: number;
  defaultLatencyMs: number;
  startEquity: number;
  sizingMode: "fixed_notional" | "equity_percent" | "risk_per_trade";
  fixedNotional: number;
  equityPercent: number;
  riskPerTradePercent: number;
  maxPositionPercentOfEquity: number;
  maxPositionNotional: number;
  maxOpenPositions: number;
  maxGrossExposurePercent: number;
  maxDailyLossPercent: number;
  maxDrawdownPercent: number;
  consecutiveLossCooldown: number;
  btcShockPct: number;
  staleDataMaxAgeMs: number;
  wsStabilizationMs: number;
  timeExitMs: number;
  minProgressPct: number;
  trailPct: number;
  partialTpPct: number;
  partialTpFraction: number;
  correlationWindow: number;
  maxCorrelatedOpens: number;
  closedRetention: number;
};

export const DEFAULT_PAPER_CONFIG: PaperRuntimeConfig = {
  takerFeeRate: 0.0015,
  makerFeeRate: 0.0009,
  defaultLatencyMs: 350,
  startEquity: 2_500,
  sizingMode: "risk_per_trade",
  fixedNotional: 100,
  equityPercent: 0.04,
  riskPerTradePercent: 0.5,
  maxPositionPercentOfEquity: 10,
  maxPositionNotional: 250,
  maxOpenPositions: 3,
  maxGrossExposurePercent: 25,
  maxDailyLossPercent: 5,
  maxDrawdownPercent: 12,
  consecutiveLossCooldown: 3,
  btcShockPct: -1.2,
  staleDataMaxAgeMs: 15_000,
  wsStabilizationMs: 8_000,
  timeExitMs: 30 * 60_000,
  minProgressPct: 0.4,
  trailPct: 1.8,
  partialTpPct: 2.5,
  partialTpFraction: 0.4,
  correlationWindow: 3,
  maxCorrelatedOpens: 2,
  closedRetention: 400,
};

export function resolvePaperConfig(overrides?: Partial<PaperRuntimeConfig>): PaperRuntimeConfig {
  return {
    ...DEFAULT_PAPER_CONFIG,
    takerFeeRate: env.BINANCE_TAKER_FEE_RATE ?? DEFAULT_PAPER_CONFIG.takerFeeRate,
    startEquity: env.PAPER_INITIAL_BALANCE_USDT ?? DEFAULT_PAPER_CONFIG.startEquity,
    maxOpenPositions: env.EXECUTION_MAX_OPEN_POSITIONS ?? DEFAULT_PAPER_CONFIG.maxOpenPositions,
    maxDailyLossPercent: env.RISK_MAX_DAILY_LOSS_PERCENT ?? DEFAULT_PAPER_CONFIG.maxDailyLossPercent,
    ...overrides,
  };
}
