export type RiskLevel = "LOW" | "MID" | "HIGH" | "BLOCKED";

export type RiskTradeInput = {
  symbol: string;
  side: "BUY" | "SELL";
  volatilityPercent: number;
  leverage: number;
  spreadPercent: number;
  drawdownPercent: number;
  openPositions: number;
  winratePercent: number;
  consecutiveLosses: number;
  fundingRatePercent: number;
  liquidationDistancePercent: number;
  accountEquity: number;
  requestedNotional: number;
  correlatedSymbols?: string[];
};

export type RiskScoreBreakdown = {
  volatility: number;
  leverage: number;
  spread: number;
  drawdown: number;
  openPositions: number;
  winrate: number;
  consecutiveLosses: number;
  fundingRate: number;
  liquidationRisk: number;
  correlation: number;
};

export type RiskDecision = {
  allowed: boolean;
  level: RiskLevel;
  score: number;
  adjustedNotional: number;
  denyReasons: string[];
  cooldownUntil?: string;
  breakdown: RiskScoreBreakdown;
};
