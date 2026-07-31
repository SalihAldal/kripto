import type { LiquidationHeatmapAnalysis } from "@/src/server/trading-core/liquidation-heatmap";
import type { MarketRegimeDecision } from "@/src/server/trading-core/market-regime";
import type { TradeQualityDecision } from "@/src/server/trading-core/trade-quality";

export type NoTradeZoneType =
  | "MANIPULATION_MARKET"
  | "EXTREME_SPREAD"
  | "PRE_NEWS"
  | "LOW_VOLUME"
  | "FAKE_BREAKOUT_ENV"
  | "VOLATILITY_SPIKE"
  | "LOW_LIQUIDITY";

export type NoTradeSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type NoTradeZoneInput = {
  symbol: string;
  marketRegime?: MarketRegimeDecision | null;
  liquidationHeatmap?: LiquidationHeatmapAnalysis | null;
  tradeQuality?: TradeQualityDecision | null;
  spreadPercent?: number;
  volumeRatio?: number;
  liquidityUsd?: number;
  volatilityPercent?: number;
  newsRiskScore?: number;
  fakeBreakoutScore?: number;
  pauseBots?: boolean;
  apply?: boolean;
  blockTtlMs?: number;
  botPauseTtlMs?: number;
  targetBotIds?: string[];
};

export type NoTradeZone = {
  type: NoTradeZoneType;
  severity: NoTradeSeverity;
  score: number;
  reason: string;
  blockUntil: string;
};

export type BotPausePlan = {
  botId: string;
  paused: boolean;
  pauseUntil: string;
  reason: string;
};

export type NoTradeZoneDecision = {
  symbol: string;
  blocked: boolean;
  severity: NoTradeSeverity;
  blockUntil?: string;
  zones: NoTradeZone[];
  botPausePlan: BotPausePlan[];
  applied: boolean;
  reasons: string[];
  generatedAt: string;
};
