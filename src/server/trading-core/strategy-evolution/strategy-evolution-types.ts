import type { BacktestMarketData } from "@/src/server/trading-core/backtest/backtest-types";
import type { OverfittingDetectionReport } from "@/src/server/trading-core/backtest/overfitting";
import type { StrategyOptimizationParams, StrategyOptimizationResult, WalkForwardResult } from "@/src/server/trading-core/optimization";

export type StrategyEvolutionStage = "SIMULATION" | "SAFETY_CHECK" | "READY_FOR_PROMOTION" | "PROMOTED" | "REJECTED";

export type StrategyEvolutionRequest = {
  strategy: string;
  marketData: BacktestMarketData[];
  initialBalance: number;
  futures: boolean;
  allowShort: boolean;
  positionSizePercent: number;
  maxCandidates?: number;
  promote?: boolean;
  requireOverfittingPass?: boolean;
};

export type StrategyEvolutionPatch = {
  global: {
    takeProfitPercent: number;
    stopLossPercent: number;
    leverage: number;
    aiConfidenceThreshold: number;
  };
  strategy: {
    minScore: number;
    params: {
      rsiOversold: number;
      rsiOverbought: number;
      volatilityThreshold: number;
      entryFilterStrength: number;
    };
  };
};

export type StrategyEvolutionResult = {
  strategy: string;
  stage: StrategyEvolutionStage;
  bestCandidate: WalkForwardResult | null;
  optimizedParams?: StrategyOptimizationParams;
  simulation: StrategyOptimizationResult;
  overfittingReport?: OverfittingDetectionReport;
  proposedPatch?: StrategyEvolutionPatch;
  promoted: boolean;
  promotionReason: string;
  generatedAt: string;
};
