import type { BacktestMarketData, BacktestMetrics, BacktestRequest } from "@/src/server/trading-core/backtest/backtest-types";

export type OverfittingRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type OverfittingCheckResult = {
  name: "walk_forward" | "out_of_sample" | "monte_carlo" | "regime_variation" | "randomization";
  passed: boolean;
  riskScore: number;
  message: string;
  metrics?: BacktestMetrics;
  details?: Record<string, unknown>;
};

export type OverfittingDetectionRequest = {
  backtest: Omit<BacktestRequest, "marketData"> & {
    marketData?: BacktestMarketData[];
    symbols?: string[];
    candlesPerSymbol?: number;
  };
  windows?: number;
  monteCarloRuns?: number;
  randomizationRuns?: number;
};

export type OverfittingDetectionReport = {
  riskLevel: OverfittingRiskLevel;
  riskScore: number;
  passed: boolean;
  checks: OverfittingCheckResult[];
  recommendation: string;
  generatedAt: string;
};
