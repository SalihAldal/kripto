import { env } from "@/lib/config";
import { calculateValidQuantity } from "@/services/binance.service";
import { publishExecutionEvent } from "@/src/server/execution/execution-event-bus";
import { resolveBalancesForMode } from "@/src/server/execution-management/balance-resolver.service";
import { validateBuyExecution, validateSellExecution } from "@/src/server/execution-management/execution-validation.service";
import { resolvePositionSizing } from "@/src/server/execution-management/position-sizing.engine";
import {
  ACTIVE_SIZING_MODE,
  type TradingExecutionMode,
  type UnifiedExecutionPlan,
} from "@/src/server/execution-management/execution-management.types";
import { persistPositionSizing } from "@/src/server/execution-management/execution-management.repository";

export async function resolveUnifiedExecutionPlan(input: {
  userId: string;
  executionId: string;
  symbol: string;
  side: "BUY" | "SELL";
  mode: TradingExecutionMode;
  estimatedEntryPrice: number;
  quoteAsset: string;
  baseAsset: string;
  openPositionCount: number;
  allowMultipleOpenPositions: boolean;
  hasManualSizing?: boolean;
  requestedQuantity?: number;
  useGlobalLeverageVenue?: boolean;
  ignorePauseState?: boolean;
}): Promise<UnifiedExecutionPlan> {
  if (input.useGlobalLeverageVenue) {
    const qty = input.requestedQuantity ?? 0.01;
    const validation = {
      ok: true,
      reasons: [] as string[],
      marketPrice: input.estimatedEntryPrice,
      notional: qty * input.estimatedEntryPrice,
      adjustedQuantity: qty,
      stages: [],
    };
    return {
      ok: true,
      quantity: qty,
      validation,
      sizing: {
        mode: ACTIVE_SIZING_MODE,
        sizedQty: qty,
        utilizationPct: 0,
        availableQuote: 0,
        availableBase: 0,
      },
    };
  }

  const balances = await resolveBalancesForMode({
    userId: input.userId,
    mode: input.mode,
    quoteAsset: input.quoteAsset,
    baseAsset: input.baseAsset,
  });

  const useAllIn = env.EXECUTION_FULL_BALANCE_ENABLED && !input.hasManualSizing;
  const sizing = resolvePositionSizing({
    mode: ACTIVE_SIZING_MODE,
    side: input.side,
    quoteAsset: input.quoteAsset,
    baseAsset: input.baseAsset,
    availableQuote: balances.availableQuote,
    availableBase: balances.availableBase,
    estimatedPrice: input.estimatedEntryPrice,
    requestedQuantity: input.requestedQuantity,
    hasManualSizing: !useAllIn || input.hasManualSizing,
  });

  if (sizing.sizedQty <= 0) {
    return {
      ok: false,
      rejectReason: input.side === "BUY" ? `${input.quoteAsset} balance insufficient` : `${input.baseAsset} holdings insufficient`,
      quantity: 0,
      validation: { ok: false, reasons: ["Zero sized quantity"], marketPrice: input.estimatedEntryPrice, notional: 0, adjustedQuantity: 0, stages: [] },
      sizing,
    };
  }

  await persistPositionSizing({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    side: input.side,
    sizing,
    quoteAsset: input.quoteAsset,
    baseAsset: input.baseAsset,
  }).catch(() => null);

  publishExecutionEvent({
    executionId: input.executionId,
    symbol: input.symbol,
    stage: "sizing",
    status: "SUCCESS",
    message: input.side === "BUY" ? "ALL-IN BUY sizing applied" : "ALL-OUT SELL sizing applied",
    level: "INFO",
    context: {
      mode: sizing.mode,
      sizedQty: sizing.sizedQty,
      quoteSpend: sizing.quoteSpend,
      availableQuote: balances.availableQuote,
      availableBase: balances.availableBase,
      utilizationPct: sizing.utilizationPct,
    },
  });

  const validation =
    input.side === "BUY"
      ? await validateBuyExecution({
          userId: input.userId,
          executionId: input.executionId,
          symbol: input.symbol,
          quantity: sizing.sizedQty,
          priceHint: input.estimatedEntryPrice,
          quoteAvailable: balances.availableQuote,
          openPositionCount: input.openPositionCount,
          allowMultipleOpenPositions: input.allowMultipleOpenPositions,
          ignorePauseState: input.ignorePauseState,
        })
      : await validateSellExecution({
          userId: input.userId,
          executionId: input.executionId,
          symbol: input.symbol,
          quantity: sizing.sizedQty,
          priceHint: input.estimatedEntryPrice,
          baseAvailable: balances.availableBase,
          baseLocked: balances.lockedBase,
          openPositionCount: input.openPositionCount,
          allowMultipleOpenPositions: input.allowMultipleOpenPositions,
          ignorePauseState: input.ignorePauseState,
        });

  const validQty = await calculateValidQuantity(input.symbol, validation.adjustedQuantity).catch(() => validation.adjustedQuantity);

  return {
    ok: validation.ok,
    rejectReason: validation.ok ? undefined : validation.reasons.join(", "),
    quantity: validQty,
    quoteSpend: sizing.quoteSpend,
    validation: { ...validation, adjustedQuantity: validQty },
    sizing,
  };
}
