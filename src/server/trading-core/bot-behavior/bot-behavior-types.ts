import type { BotAllocation } from "@/src/server/trading-core/bots/bot-types";
import type { SignalDecision, TradeSide } from "@/src/server/trading-core/core/types";

export type BotBehaviorType = "SCALPER" | "SWING" | "DCA" | "TREND" | "BREAKOUT";
export type BotRiskAppetite = "LOW" | "MEDIUM" | "HIGH";
export type BotTradePace = "FAST" | "NORMAL" | "SLOW";

export type BotBehaviorProfile = {
  botId: string;
  name: string;
  behaviorType: BotBehaviorType;
  riskAppetite: BotRiskAppetite;
  tradePace: BotTradePace;
  preferredRegimes: string[];
  preferredVolatilityPercent: { min: number; max: number };
  takeProfitPercent: number;
  stopLossPercent: number;
  trailingEnabled: boolean;
  partialTakeProfitPercent: number;
  maxHoldMinutes: number;
  entryAggression: number;
  positionSizeMultiplier: number;
  minSignalScore: number;
  minConfidence: number;
  dca?: {
    enabled: boolean;
    maxAdds: number;
    stepPercent: number;
    sizeMultiplier: number;
    volatilityMultiplier: number;
  };
  notes: string[];
};

export type BotBehaviorContext = {
  symbol: string;
  side: Exclude<TradeSide, "HOLD">;
  signal: SignalDecision;
  botAllocation?: BotAllocation | null;
  currentPrice?: number;
  volatilityPercent?: number;
};

export type DcaPlanStep = {
  step: number;
  triggerPrice: number;
  sizeMultiplier: number;
  reason: string;
};

export type BotBehaviorDecision = {
  botId: string;
  behaviorType: BotBehaviorType;
  allowed: boolean;
  action: "ENTER" | "WAIT" | "REDUCE_SIZE" | "DCA_PLAN";
  riskAppetite: BotRiskAppetite;
  tradePace: BotTradePace;
  takeProfitPercent: number;
  stopLossPercent: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  positionSizeMultiplier: number;
  entryAggression: number;
  maxHoldMinutes: number;
  dcaPlan: DcaPlanStep[];
  reasons: string[];
  metadata: Record<string, unknown>;
  decidedAt: string;
};
