export { PortfolioCorrelationAnalyzer } from "@/src/server/trading-core/portfolio/portfolio-correlation-analyzer";
export { getPortfolioConfig } from "@/src/server/trading-core/portfolio/portfolio-config";
export { PortfolioExposureAnalyzer } from "@/src/server/trading-core/portfolio/portfolio-exposure-analyzer";
export { PortfolioHedgeManager } from "@/src/server/trading-core/portfolio/hedge-manager";
export { SmartPortfolioManager, smartPortfolioManager } from "@/src/server/trading-core/portfolio/portfolio-manager";
export { PortfolioStrategyAllocationEngine } from "@/src/server/trading-core/portfolio/strategy-allocation-engine";
export type {
  CorrelationExposure,
  ExposureBucket,
  HedgeRecommendation,
  PortfolioAction,
  PortfolioAnalysis,
  PortfolioConfig,
  PortfolioDecision,
  PortfolioIntent,
  PortfolioPositionInput,
  PortfolioRiskLevel,
} from "@/src/server/trading-core/portfolio/portfolio-types";
