import { calculateValidQuantity, validateSymbolFilters } from "@/services/binance.service";
import { resolveRoundTripTakerFeePercent } from "@/src/server/execution/fee-profile";
import { validatePreTrade } from "@/src/server/execution/order-validation.layer";
import type { ExecutionValidationResult } from "@/src/server/execution-management/execution-management.types";
import { persistExecutionValidation } from "@/src/server/execution-management/execution-management.repository";

export async function validateBuyExecution(input: {
  userId: string;
  executionId: string;
  symbol: string;
  quantity: number;
  priceHint: number;
  quoteAvailable: number;
  openPositionCount: number;
  allowMultipleOpenPositions: boolean;
  ignorePauseState?: boolean;
}): Promise<ExecutionValidationResult> {
  const stages: ExecutionValidationResult["stages"] = [];
  const reasons: string[] = [];

  if (input.quoteAvailable <= 0) {
    reasons.push("Insufficient quote balance");
    stages.push({ stage: "BALANCE", passed: false, reasons: ["Insufficient quote balance"] });
  } else {
    stages.push({ stage: "BALANCE", passed: true, reasons: [] });
  }

  const filterValidation = await validateSymbolFilters(input.symbol, input.quantity, input.priceHint);
  if (!filterValidation.ok) {
    reasons.push(...filterValidation.reasons);
    stages.push({ stage: "EXCHANGE", passed: false, reasons: filterValidation.reasons });
  } else {
    stages.push({ stage: "EXCHANGE", passed: true, reasons: [] });
  }

  const preTrade = await validatePreTrade({
    userId: input.userId,
    symbol: input.symbol,
    quantity: filterValidation.adjustedQuantity ?? input.quantity,
    priceHint: input.priceHint,
    allowMultipleOpenPositions: input.allowMultipleOpenPositions,
    openPositionCount: input.openPositionCount,
    side: "BUY",
    ignorePauseState: input.ignorePauseState,
  });
  if (!preTrade.ok) reasons.push(...preTrade.reasons);
  stages.push({ stage: "RISK", passed: preTrade.ok, reasons: preTrade.reasons });

  const validQty = await calculateValidQuantity(input.symbol, preTrade.adjustedQuantity);
  const notional = Number((validQty * preTrade.marketPrice).toFixed(8));
  const feesEstimate = notional * (resolveRoundTripTakerFeePercent() / 100);

  if (notional + feesEstimate > input.quoteAvailable) {
    reasons.push("Notional plus fees exceeds available quote balance");
  }

  const result: ExecutionValidationResult = {
    ok: reasons.length === 0,
    reasons,
    marketPrice: preTrade.marketPrice,
    notional,
    adjustedQuantity: validQty,
    minNotional: preTrade.minNotional,
    feesEstimate,
    stages,
  };

  await persistExecutionValidation({
    executionId: input.executionId,
    symbol: input.symbol,
    side: "BUY",
    passed: result.ok,
    reasons: result.reasons,
    marketPrice: result.marketPrice,
    notional: result.notional,
    adjustedQty: result.adjustedQuantity,
    minNotional: result.minNotional,
    feesEstimate: result.feesEstimate,
    metadata: { stages },
  }).catch(() => null);

  return result;
}

export async function validateSellExecution(input: {
  userId: string;
  executionId: string;
  symbol: string;
  quantity: number;
  priceHint: number;
  baseAvailable: number;
  baseLocked?: number;
  openPositionCount: number;
  allowMultipleOpenPositions: boolean;
  ignorePauseState?: boolean;
}): Promise<ExecutionValidationResult> {
  const stages: ExecutionValidationResult["stages"] = [];
  const reasons: string[] = [];

  if (input.baseAvailable <= 0) {
    reasons.push("No base asset holdings available");
    stages.push({ stage: "BALANCE", passed: false, reasons: ["No base asset holdings"] });
  } else {
    stages.push({ stage: "BALANCE", passed: true, reasons: [] });
  }

  if (input.quantity > input.baseAvailable + 1e-8) {
    reasons.push("Sell quantity exceeds available holdings");
  }

  const filterValidation = await validateSymbolFilters(input.symbol, input.quantity, input.priceHint);
  if (!filterValidation.ok) {
    reasons.push(...filterValidation.reasons);
    stages.push({ stage: "EXCHANGE", passed: false, reasons: filterValidation.reasons });
  } else {
    stages.push({ stage: "EXCHANGE", passed: true, reasons: [] });
  }

  const preTrade = await validatePreTrade({
    userId: input.userId,
    symbol: input.symbol,
    quantity: filterValidation.adjustedQuantity ?? input.quantity,
    priceHint: input.priceHint,
    allowMultipleOpenPositions: input.allowMultipleOpenPositions,
    openPositionCount: input.openPositionCount,
    side: "SELL",
    ignorePauseState: input.ignorePauseState,
  });
  if (!preTrade.ok) reasons.push(...preTrade.reasons);
  stages.push({ stage: "RISK", passed: preTrade.ok, reasons: preTrade.reasons });

  const validQty = await calculateValidQuantity(input.symbol, preTrade.adjustedQuantity);
  const notional = Number((validQty * preTrade.marketPrice).toFixed(8));
  const feesEstimate = notional * (resolveRoundTripTakerFeePercent() / 100);

  const result: ExecutionValidationResult = {
    ok: reasons.length === 0,
    reasons,
    marketPrice: preTrade.marketPrice,
    notional,
    adjustedQuantity: validQty,
    minNotional: preTrade.minNotional,
    feesEstimate,
    stages,
  };

  await persistExecutionValidation({
    executionId: input.executionId,
    symbol: input.symbol,
    side: "SELL",
    passed: result.ok,
    reasons: result.reasons,
    marketPrice: result.marketPrice,
    notional: result.notional,
    adjustedQty: result.adjustedQuantity,
    minNotional: result.minNotional,
    feesEstimate: result.feesEstimate,
    metadata: { stages, dustHandling: true },
  }).catch(() => null);

  return result;
}
