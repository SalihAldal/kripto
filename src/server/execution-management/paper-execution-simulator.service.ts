import { resolveUnifiedExecutionPlan } from "@/src/server/execution-management/unified-execution-pipeline.service";
import type { TradingExecutionMode } from "@/src/server/execution-management/execution-management.types";
import { resolveExecutionAdapter } from "@/src/server/paper-runtime/execution-port";

export async function simulatePaperExecution(input: {
  userId: string;
  executionId: string;
  candidateId?: string;
  executionIntentId?: string;
  symbol: string;
  lane?: string;
  side: "BUY" | "SELL";
  estimatedPrice: number;
  quoteAsset: string;
  baseAsset: string;
  executionVenue?: string;
  marketDataVenue?: string;
  riskDecisionId?: string;
  decisionAt?: string;
  riskAllowedAt?: string;
  configHash?: string;
  openPositionCount: number;
  allowMultipleOpenPositions: boolean;
  hasManualSizing?: boolean;
  requestedQuantity?: number;
  quoteOrderQty?: number;
  bidDepth?: number;
  askDepth?: number;
  spreadPercent?: number;
}) {
  const candidateId = String(input.candidateId ?? "").trim();
  const executionIntentId = String(input.executionIntentId ?? input.executionId).trim();
  if (!candidateId) throw new Error("HANDOFF_IDENTITY_MISSING");
  if (!executionIntentId) throw new Error("HANDOFF_IDENTITY_MISSING");
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

  const adapter = resolveExecutionAdapter("paper");
  const placed = await adapter.submitEntry({
    userId: input.userId,
    executionId: input.executionId,
    candidateId,
    executionIntentId,
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
    lane: input.lane ?? "SCANNER",
    executionVenue: input.executionVenue,
    marketDataVenue: input.marketDataVenue,
    riskDecisionId: input.riskDecisionId,
    decisionAt: input.decisionAt,
    riskAllowedAt: input.riskAllowedAt,
    configHash: input.configHash,
  });

  return {
    plan,
    placed: {
      orderId: placed.orderId,
      clientOrderId: placed.orderId,
      symbol: input.symbol,
      status: placed.state,
      side: input.side,
      type: "MARKET",
      executedQty: placed.executedQty,
      price: placed.avgFillPrice,
      dryRun: true,
      fee: placed.fee,
      metadata: placed.metadata,
    },
    fillPrice: placed.avgFillPrice || input.estimatedPrice,
    quantity: placed.executedQty,
    fee: placed.fee,
    slippagePct: Number((placed.metadata as Record<string, unknown> | null)?.slippagePct ?? 0),
    partialFill: placed.state === "PARTIALLY_FILLED",
    fillRatio: plan.quantity > 0 ? placed.executedQty / plan.quantity : 1,
  };
}

export type { TradingExecutionMode };
