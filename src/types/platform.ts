export type AlertLevel = "info" | "success" | "warning" | "error";

export type SummaryCard = {
  key: string;
  label: string;
  value: string;
  delta?: string;
  tone?: "primary" | "secondary" | "tertiary";
};

export type ScannerRow = {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
  aiScore: number;
};

export type AIModelCard = {
  id: string;
  model: string;
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  reason: string;
};

export type OrderBookRow = {
  price: number;
  amount: number;
  total: number;
  side: "bid" | "ask";
};

export type NotificationItem = {
  id: string;
  title: string;
  description: string;
  level: AlertLevel;
  time: string;
};

export type AIDebugProvider = {
  providerId: string;
  providerName: string;
  ok: boolean;
  latencyMs: number;
  decision: "BUY" | "SELL" | "HOLD" | "NO_TRADE" | null;
  remote: boolean;
  error?: string;
};

export type DebugStageSummary = {
  stage: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  message: string;
  createdAt: string;
};

export type DashboardDebugSnapshot = {
  symbol: string;
  scanner: {
    scannedAt: string | null;
    universeTotal: number;
    scannedCount: number;
    qualifiedCount: number;
    aiEvaluatedCount: number;
    selectedInScanner: boolean;
    context: {
      price: number;
      volume24h: number;
      spreadPercent: number;
      volatilityPercent: number;
      fakeSpikeScore: number;
      tradable: boolean;
      rejectReasons: string[];
      metadata: Record<string, unknown>;
    } | null;
  };
  ai: {
    finalDecision: "BUY" | "SELL" | "HOLD" | "NO_TRADE" | null;
    finalConfidence: number | null;
    finalRiskScore: number | null;
    explanation?: string | null;
    providers: AIDebugProvider[];
    laneProviderMap?: {
      technical?: string;
      momentum?: string;
      risk?: string;
    };
  };
  execution: {
    latestExecutionId: string | null;
    stages: DebugStageSummary[];
    openPositions: number | null;
    maxOpenPositions: number | null;
  };
  exchange: {
    fallbackActive: boolean;
    globalBanActive: boolean;
    networkCooldownActive: boolean;
    globalBanUntil: string | null;
    networkCooldownUntil: string | null;
    endpointHealth: Array<{
      base: string;
      score: number;
      totalCalls: number;
      successes: number;
      failures: number;
      consecutiveFailures: number;
      latencyEwmaMs: number;
      cooldownUntil: string | null;
    }>;
  };
  recentLogs: Array<{
    level: string;
    message: string;
    timestamp: string;
  }>;
};

export type TradeHistoryRow = {
  id: string;
  time: string;
  symbol: string;
  side: "LONG" | "SHORT";
  entry: number;
  exit: number;
  duration: string;
  pnlPercent: number;
  pnl: number;
};

export type TradeLifecycleEvent = {
  id?: string;
  executionId?: string;
  symbol?: string;
  stage: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";
  level?: "INFO" | "WARN" | "ERROR" | "TRADE" | "SIGNAL";
  message: string;
  orderId?: string;
  positionId?: string;
  createdAt: string;
  context?: Record<string, unknown>;
};

export type PnlReportFilters = {
  period: "daily" | "weekly" | "monthly" | "custom";
  startDate?: string;
  endDate?: string;
  coin?: string;
  aiModel?: string;
  mode?: "all" | "manual" | "auto";
  rangeStart: string;
  rangeEnd: string;
};

export type PnlSummary = {
  totalProfit: number;
  totalLoss: number;
  netPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  tradeCount: number;
  successCount: number;
  failedCount: number;
  openCount: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  bestCoin: string | null;
  worstCoin: string | null;
  totalFee: number;
};

export type PnlReportRow = {
  id: string;
  coin: string;
  buyTime: string | null;
  buyPrice: number;
  buyQty: number;
  sellTime: string | null;
  sellPrice: number;
  sellQty: number;
  fee: number;
  netPnl: number;
  durationSec: number;
  aiModel: string;
  tradeType: "manual" | "auto";
  result: "profit" | "loss" | "open";
  warnings: string[];
};

export type PnlAnalysis = {
  mostTradedCoins: Array<{ coin: string; pnl: number; count: number }>;
  bestPerformingCoins: Array<{ coin: string; pnl: number; count: number }>;
  worstPerformingCoins: Array<{ coin: string; pnl: number; count: number }>;
  hourlySuccessRate: Array<{ hour: string; tradeCount: number; winRate: number }>;
  dailySuccessRate: Array<{ day: string; tradeCount: number; winRate: number }>;
  aiPerformance: Array<{ aiModel: string; tradeCount: number; netPnl: number; winRate: number }>;
  strategyPerformance: Array<{ strategy: string; tradeCount: number; netPnl: number; winRate: number }>;
  maxDrawdown: number;
  streaks: {
    maxWinStreak: number;
    maxLossStreak: number;
  };
};

export type PnlCharts = {
  netPnlTimeline: Array<{ date: string; netPnl: number; tradeCount: number; cumulative: number }>;
  coinPnlDistribution: Array<{ label: string; value: number }>;
  aiPerformanceComparison: Array<{ label: string; value: number }>;
  tradeCountTimeline: Array<{ date: string; count: number }>;
  pnlDistribution: {
    profitTrades: number;
    lossTrades: number;
    openTrades: number;
  };
};

export type PnlReportResponse = {
  filters: PnlReportFilters;
  summary: PnlSummary;
  analysis: PnlAnalysis;
  charts: PnlCharts;
  rows: PnlReportRow[];
  filterOptions: {
    coins: string[];
    aiModels: string[];
    modes: Array<"all" | "manual" | "auto">;
  };
};

export type AutoRoundRunItem = {
  id: string;
  roundNo: number;
  state: string;
  symbol?: string | null;
  executionId?: string | null;
  buyPrice?: number | null;
  buyQty?: number | null;
  sellPrice?: number | null;
  sellQty?: number | null;
  netPnl?: number | null;
  feeTotal?: number | null;
  result?: string | null;
  failReason?: string | null;
  selectedReason?: string | null;
  startedAt: string;
  endedAt?: string | null;
};

export type AutoRoundJobItem = {
  id: string;
  status: string;
  totalRounds: number;
  completedRounds: number;
  failedRounds: number;
  currentRound: number;
  budgetPerTrade: number;
  targetProfitPct: number;
  stopLossPct: number;
  maxWaitSec: number;
  coinSelectionMode: string;
  aiMode: string;
  allowRepeatCoin: boolean;
  mode: string;
  activeState: string;
  stopRequested: boolean;
  startedAt?: string | null;
  finishedAt?: string | null;
  rounds: AutoRoundRunItem[];
};

export type AutoRoundStatusResponse = {
  active: AutoRoundJobItem | null;
  jobs: AutoRoundJobItem[];
};

export type PaperOrderRow = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  type: string;
  status: string;
  quantity: number;
  price: number;
  fee: number;
  createdAt: string;
  executedAt: string | null;
};

export type PaperTradingReport = {
  balances: Record<string, number>;
  updatedAt: string;
  orderCount: number;
  orders: PaperOrderRow[];
};

export type BacktestRunResult = {
  id: string;
  generatedAt: string;
  range: {
    start: string;
    end: string;
  };
  symbols: string[];
  strategy: "balanced" | "aggressive" | "conservative";
  aiEnabled: boolean;
  metrics: {
    totalPnl: number;
    winRate: number;
    maxDrawdown: number;
    avgHoldSec: number;
    tradeCount: number;
    wins: number;
    losses: number;
    bestCoins: Array<{ symbol: string; pnl: number; count: number }>;
    worstCoins: Array<{ symbol: string; pnl: number; count: number }>;
  };
  strategyComparison: Array<{
    key: string;
    tpPercent: number;
    slPercent: number;
    totalPnl: number;
    winRate: number;
    tradeCount: number;
    maxDrawdown: number;
  }>;
  trades: Array<{
    symbol: string;
    openedAt: string;
    closedAt: string;
    entryPrice: number;
    exitPrice: number;
    qty: number;
    tpPercent: number;
    slPercent: number;
    netPnl: number;
    holdSec: number;
    result: "win" | "loss";
    strategy: string;
  }>;
  sampleScenarios: Array<{
    label: string;
    strategy: string;
    aiEnabled: boolean;
    tpPercents: number[];
    slPercents: number[];
  }>;
};
