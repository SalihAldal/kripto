import type { MarketCandle, TradeSide } from "@/src/server/trading-core/core/types";

export type BacktestMarketData = {
  symbol: string;
  candles: MarketCandle[];
};

export type BacktestStrategyConfig = {
  name: string;
  enabled: boolean;
};

export type BacktestCostModel = {
  makerFeeRate: number;
  takerFeeRate: number;
  slippageBps: number;
  latencyMs: number;
};

export type BacktestRequest = {
  initialBalance: number;
  leverage: number;
  futures: boolean;
  allowShort: boolean;
  positionSizePercent: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  strategies: BacktestStrategyConfig[];
  costModel: BacktestCostModel;
  marketData: BacktestMarketData[];
};

export type BacktestTrade = {
  id: string;
  strategy: string;
  symbol: string;
  side: Exclude<TradeSide, "HOLD">;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  notional: number;
  fee: number;
  slippage: number;
  grossPnl: number;
  netPnl: number;
  returnPercent: number;
  exitReason: "TAKE_PROFIT" | "STOP_LOSS" | "REVERSE_SIGNAL" | "MOMENTUM_FADE" | "TIMEOUT" | "END_OF_DATA";
  holdSec?: number;
  laneTag?: string;
  entryGateReason?: string;
  outcome?: "win" | "loss" | "breakeven";
};

export type PaperRoundGateRejectionSample = {
  symbol: string;
  time: number;
  laneTag: string;
  reason: string;
};

export type PaperRoundStrategyDiagnostics = {
  barsScanned: number;
  candidateScans: number;
  gatePasses: number;
  gateRejections: Array<{ reason: string; count: number }>;
  qualityRejections: Array<{ reason: string; count: number }>;
  cooldownRejections: number;
  rejectionSamples: PaperRoundGateRejectionSample[];
  exitReasonBreakdown: Array<{ reason: string; count: number }>;
};

export type BacktestMetrics = {
  tradeCount: number;
  wins: number;
  losses: number;
  winrate: number;
  totalPnl: number;
  endingBalance: number;
  sharpeRatio: number;
  maxDrawdown: number;
  expectancy: number;
  profitFactor: number;
};

export type StrategyBacktestResult = {
  strategy: string;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: Array<{ time: number; equity: number }>;
  diagnostics?: PaperRoundStrategyDiagnostics;
};

export type BacktestResult = {
  id: string;
  startedAt: string;
  finishedAt: string;
  config: Omit<BacktestRequest, "marketData"> & {
    symbols: string[];
    mode?: "paper-round" | "strategy-lab";
    dataSource?: "real-klines" | "synthetic";
    maxWaitSec?: number;
  };
  metrics: BacktestMetrics;
  strategyResults: StrategyBacktestResult[];
};
