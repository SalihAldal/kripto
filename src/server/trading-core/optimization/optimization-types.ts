import type { BacktestMarketData, BacktestMetrics } from "@/src/server/trading-core/backtest/backtest-types";

export type StrategyOptimizationParams = {
  rsiOversold: number;
  rsiOverbought: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  leverage: number;
  minScore: number;
  volatilityThreshold: number;
  entryFilterStrength: number;
};

export type StrategyOptimizationCandidate = {
  id: string;
  strategy: string;
  params: StrategyOptimizationParams;
};

export type WalkForwardWindow = {
  index: number;
  train: BacktestMarketData[];
  test: BacktestMarketData[];
};

export type WalkForwardResult = {
  candidateId: string;
  params: StrategyOptimizationParams;
  trainMetrics: BacktestMetrics;
  testMetrics: BacktestMetrics;
  stabilityScore: number;
  overfittingScore: number;
  optimizationScore: number;
};

export type StrategyOptimizationRequest = {
  strategy: string;
  marketData: BacktestMarketData[];
  initialBalance: number;
  futures: boolean;
  allowShort: boolean;
  positionSizePercent: number;
  maxCandidates?: number;
  apply?: boolean;
};

export type StrategyOptimizationResult = {
  strategy: string;
  best: WalkForwardResult | null;
  candidates: WalkForwardResult[];
  recommendation: {
    applySafe: boolean;
    reason: string;
    configPatch?: {
      global: {
        takeProfitPercent: number;
        stopLossPercent: number;
        leverage: number;
      };
      strategy: {
        minScore: number;
        params: Record<string, number>;
      };
    };
  };
  generatedAt: string;
};
