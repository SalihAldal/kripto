export type TradeSide = "BUY" | "SELL" | "HOLD";

export type ModuleStatus = "disabled" | "starting" | "healthy" | "degraded" | "failed" | "stopped";

export type MarketCandle = {
  symbol: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketTick = {
  symbol: string;
  price: number;
  volume?: number;
  eventTime: number;
};

export type MarketSnapshot = {
  symbol: string;
  candles: MarketCandle[];
  latestTick?: MarketTick;
  receivedAt: string;
};

export type IndicatorSnapshot = {
  rsi?: number;
  emaFast?: number;
  emaSlow?: number;
  macd?: {
    macd: number;
    signal: number;
    histogram: number;
  };
  volumeSpike?: {
    ratio: number;
    isSpike: boolean;
    currentVolume: number;
    averageVolume: number;
  };
};

export type StrategySignal = {
  strategy: string;
  symbol: string;
  side: TradeSide;
  score: number;
  confidence: number;
  reasons: string[];
  indicators: IndicatorSnapshot;
  generatedAt: string;
};

export type SignalDecision = {
  symbol: string;
  side: TradeSide;
  score: number;
  confidence: number;
  strategySignals: StrategySignal[];
  botAllocation?: {
    botId: string;
    botName: string;
    strategy: string;
    priority: number;
    weight: number;
    score: number;
    reason: string;
  } | null;
  marketRegime?: {
    regime: string;
    trendDirection: string;
    strategyMode: string;
    tradeAllowed: boolean;
    confidence: number;
    reasons: string[];
    metrics: Record<string, number>;
    detectedAt: string;
  };
  risk?: RiskVerdict;
  reasons: string[];
  generatedAt: string;
  output: "json";
};

export type RiskVerdict = {
  allowed: boolean;
  level: "LOW" | "MID" | "MEDIUM" | "HIGH" | "BLOCKED";
  reasons: string[];
  score?: number;
  adjustedNotional?: number;
  cooldownUntil?: string;
  breakdown?: Record<string, number>;
  maxNotional?: number;
};

export type ExecutionIntent = {
  symbol: string;
  side: Exclude<TradeSide, "HOLD">;
  score: number;
  confidence: number;
  dryRun: boolean;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type ExecutionResult = {
  accepted: boolean;
  status: "SIMULATED" | "QUEUED" | "REJECTED" | "SKIPPED";
  intent?: ExecutionIntent;
  reasons: string[];
  createdAt: string;
};

export interface TradingModule {
  readonly name: string;
  readonly enabled: boolean;
  start?(): Promise<void>;
  stop?(): Promise<void>;
  health(): Promise<ModuleHealth>;
}

export type ModuleHealth = {
  name: string;
  status: ModuleStatus;
  enabled: boolean;
  details?: Record<string, unknown>;
  checkedAt: string;
};
