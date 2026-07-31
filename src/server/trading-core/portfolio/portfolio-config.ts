import type { PortfolioConfig } from "@/src/server/trading-core/portfolio/portfolio-types";

function numberEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function getPortfolioConfig(): PortfolioConfig {
  return {
    maxSingleCoinExposurePercent: numberEnv("TRADING_PORTFOLIO_MAX_SINGLE_COIN_EXPOSURE_PERCENT", 28),
    maxCorrelatedExposurePercent: numberEnv("TRADING_PORTFOLIO_MAX_CORRELATED_EXPOSURE_PERCENT", 45),
    maxStrategyExposurePercent: numberEnv("TRADING_PORTFOLIO_MAX_STRATEGY_EXPOSURE_PERCENT", 40),
    maxTotalExposurePercent: numberEnv("TRADING_PORTFOLIO_MAX_TOTAL_EXPOSURE_PERCENT", 120),
    hedgeThresholdPercent: numberEnv("TRADING_PORTFOLIO_HEDGE_THRESHOLD_PERCENT", 35),
    rebalanceThresholdPercent: numberEnv("TRADING_PORTFOLIO_REBALANCE_THRESHOLD_PERCENT", 8),
  };
}
