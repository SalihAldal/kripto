import { env } from "@/lib/config";
import { getTicker, validateSymbolFilters } from "@/services/binance.service";
import { getPausedState, getRiskConfigByUser } from "@/src/server/repositories/risk.repository";

export type PreTradeValidationInput = {
  userId: string;
  symbol: string;
  quantity: number;
  priceHint?: number;
  allowMultipleOpenPositions: boolean;
  openPositionCount: number;
  side: "BUY" | "SELL";
};

export type PreTradeValidationResult = {
  ok: boolean;
  reasons: string[];
  marketPrice: number;
  notional: number;
  adjustedQuantity: number;
  minNotional?: number;
};

export async function validatePreTrade(input: PreTradeValidationInput): Promise<PreTradeValidationResult> {
  const reasons: string[] = [];
  const ticker = await getTicker(input.symbol);
  const marketPrice = input.priceHint ?? ticker.price;

  const pausedState = await getPausedState(input.userId).catch(() => ({
    paused: false,
    reason: undefined as string | undefined,
    until: undefined as string | undefined,
  }));
  if (pausedState.paused) {
    const untilMs = pausedState.until ? new Date(pausedState.until).getTime() : 0;
    const stillActive = Number.isFinite(untilMs) && untilMs > Date.now();
    // Ignore stale pause flags whose cooldown already expired.
    if (!pausedState.until || stillActive) {
      reasons.push("Auto trade disabled");
    }
  }

  const riskConfig = await getRiskConfigByUser(input.userId).catch(() => null);
  const maxOpenPositions = Math.min(
    riskConfig?.maxOpenPositions ?? env.EXECUTION_MAX_OPEN_POSITIONS,
    env.EXECUTION_MAX_OPEN_POSITIONS,
  );
  if (!input.allowMultipleOpenPositions && input.openPositionCount > 0) {
    reasons.push("Multiple open positions disabled");
  }
  if (input.openPositionCount >= maxOpenPositions) {
    reasons.push(`Max open positions reached (${maxOpenPositions})`);
  }

  const validation = await validateSymbolFilters(input.symbol, input.quantity, marketPrice);
  if (!validation.ok) {
    reasons.push(...validation.reasons);
  }
  const adjustedQuantity = validation.adjustedQuantity ?? input.quantity;
  const notional = Number((adjustedQuantity * marketPrice).toFixed(8));

  if (riskConfig?.maxOrderNotional && notional > riskConfig.maxOrderNotional) {
    reasons.push(`Order notional exceeds risk limit (${riskConfig.maxOrderNotional})`);
  }

  return {
    ok: reasons.length === 0,
    reasons,
    marketPrice,
    notional,
    adjustedQuantity,
    minNotional: validation.minNotional,
  };
}
