import { executePaperOrderViaExchangeSimulator } from "@/src/server/exchange-simulator/paper-exchange-adapter.service";
import { resolveUnifiedExecutionPlan } from "@/src/server/execution-management/unified-execution-pipeline.service";
import type { TradingExecutionMode } from "@/src/server/execution-management/execution-management.types";

export async function simulatePaperExecution(input: {
  userId: string;
  executionId: string;
  symbol: string;
  side: "BUY" | "SELL";
  estimatedPrice: number;
  quoteAsset: string;
  baseAsset: string;
  openPositionCount: number;
  allowMultipleOpenPositions: boolean;
  hasManualSizing?: boolean;
  requestedQuantity?: number;
  quoteOrderQty?: number;
  bidDepth?: number;
  askDepth?: number;
  spreadPercent?: number;
}) {
  const plan = await resolveUnifiedExecutionPlan({
    userId: input.userId,
    executionId: input.executionId,
    symbol: input.symbol,
    side: input.side,
    mode: "paper",
    estimatedEntryPrice: input.estimatedPrice,
    quoteAsset: input.quoteAsset,
    baseAsset: input.baseAsset,
    openPositionCount: input.openPositionCount,
    allowMultipleOpenPositions: input.allowMultipleOpenPositions,
    hasManualSizing: input.hasManualSizing,
    requestedQuantity: input.requestedQuantity,
  });
  if (!plan.ok) throw new Error(plan.rejectReason ?? "Paper execution validation failed");

  const placed = await executePaperOrderViaExchangeSimulator({
    userId: input.userId,
    executionId: input.executionId,
    symbol: input.symbol,
    side: input.side,
    quantity: plan.quantity,
    quoteOrderQty: input.quoteOrderQty ?? plan.quoteSpend,
    priceHint: input.estimatedPrice,
    quoteAsset: input.quoteAsset,
    baseAsset: input.baseAsset,
    bidDepth: input.bidDepth,
    askDepth: input.askDepth,
    spreadPercent: input.spreadPercent,
  });

  return {
    plan,
    placed,
    fillPrice: placed.price ?? input.estimatedPrice,
    quantity: placed.executedQty,
    fee: placed.fee,
    slippagePct: Number((placed.metadata as Record<string, unknown> | null)?.slippagePct ?? 0),
    partialFill: placed.status === "PARTIALLY_FILLED",
    fillRatio: plan.quantity > 0 ? placed.executedQty / plan.quantity : 1,
  };
}

export type { TradingExecutionMode };
