export type BotTradeSample = {
  botId: string;
  symbol?: string;
  strategy?: string;
  realizedPnl: number;
  returnPercent?: number;
  openedAt?: string;
  closedAt?: string;
  durationMs?: number;
};

export type BotPerformanceMetrics = {
  botId: string;
  tradeCount: number;
  wins: number;
  losses: number;
  winrate: number;
  averagePnl: number;
  totalPnl: number;
  maxDrawdown: number;
  sharpeRatio: number;
  expectancy: number;
  profitFactor: number;
  avgTradeDurationMs: number;
  strategyConsistency: number;
  botScore: number;
  adaptiveWeight: number;
  poorPerformance: boolean;
  flags: string[];
  updatedAt: string;
};
