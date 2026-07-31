import type {
  ExecutionIntent,
  ExecutionResult,
  IndicatorSnapshot,
  MarketSnapshot,
  RiskVerdict,
  StrategySignal,
  TradeSide,
} from "@/src/server/trading-core/core/types";

export type StrategySdkMode = "SCALPING" | "TREND" | "BREAKOUT" | "MEAN_REVERSION" | "CUSTOM";

export type StrategySdkMetadata = {
  name: string;
  version: string;
  description?: string;
  mode?: StrategySdkMode;
  symbols?: string[];
  enabled?: boolean;
  minScore?: number;
  riskProfile?: "LOW" | "MID" | "HIGH";
};

export type StrategySdkContext = {
  snapshot: MarketSnapshot;
  indicators: IndicatorSnapshot;
  now: Date;
  config: {
    minScore: number;
  };
};

export type StrategySdkSignal = {
  side: TradeSide;
  score: number;
  confidence: number;
  reasons: string[];
  indicators?: IndicatorSnapshot;
  metadata?: Record<string, unknown>;
};

export type StrategyRiskInput = {
  signal: StrategySignal;
  context: StrategySdkContext;
};

export type StrategyRiskResult = {
  allowed: boolean;
  reasons: string[];
  verdict?: RiskVerdict;
};

export type StrategyTradeInput = {
  signal: StrategySignal;
  risk?: RiskVerdict;
  context: StrategySdkContext;
};

export type StrategyTradeResult = {
  intent?: ExecutionIntent;
  execution?: ExecutionResult;
  reasons: string[];
};

export interface TradingStrategySdk {
  readonly meta: StrategySdkMetadata;
  generateSignal(context: StrategySdkContext): Promise<StrategySdkSignal> | StrategySdkSignal;
  validateRisk?(input: StrategyRiskInput): Promise<StrategyRiskResult> | StrategyRiskResult;
  executeTrade?(input: StrategyTradeInput): Promise<StrategyTradeResult> | StrategyTradeResult;
}
