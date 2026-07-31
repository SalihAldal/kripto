export type LiveTradeRow = {
  id: string;
  botId: string;
  symbol: string;
  side: "BUY" | "SELL";
  entryPrice: number;
  markPrice: number;
  quantity: number;
  pnl: number;
  pnlPercent: number;
  status: "OPEN" | "CLOSED" | "PENDING";
  openedAt: string;
};

export type BotPerformanceRow = {
  botId: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
  score: number;
  weight: number;
  trades: number;
  winrate: number;
  realizedPnl: number;
  unrealizedPnl: number;
};

export type TradeHistoryRow = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  pnl: number;
  confidence: number;
  marketRegime: string;
  closedAt: string;
};

export type TradingDashboardSnapshot = {
  connected: boolean;
  updatedAt: string;
  summary: {
    openTrades: number;
    dailyPnl: number;
    riskLevel: "LOW" | "MID" | "HIGH" | "BLOCKED";
    aiConfidence: number;
    marketRegime: string;
    activeBots: number;
  };
  liveTrades: LiveTradeRow[];
  botPerformance: BotPerformanceRow[];
  pnlCurve: Array<{ time: string; pnl: number }>;
  aiConfidence: Array<{ model: string; confidence: number; decision: string }>;
  marketRegimes: Array<{ symbol: string; regime: string; confidence: number; trend: string }>;
  tradeHistory: TradeHistoryRow[];
};
