import { env } from "@/lib/config";
import type { FeeEdgeMetricsSnapshot } from "@/src/server/forensics/forensic.types";

function round(value: number, digits = 8) {
  return Number(value.toFixed(digits));
}

export function computeFeeEdgeMetrics(input: {
  entryPrice: number;
  quantity: number;
  takeProfitPercent: number;
  stopLossPercent: number;
  takerFeeRate?: number;
}): FeeEdgeMetricsSnapshot {
  const entryPrice = Number(input.entryPrice);
  const quantity = Number(input.quantity);
  const takeProfitPercent = Number(input.takeProfitPercent);
  const stopLossPercent = Number(input.stopLossPercent);
  const takerFeeRate = Number(input.takerFeeRate ?? env.BINANCE_TAKER_FEE_RATE ?? 0.0015);

  const notional = Math.max(0, entryPrice * quantity);
  const estimatedEntryFee = notional * takerFeeRate;
  const estimatedExitFee = notional * takerFeeRate;
  const estimatedRoundTripFees = estimatedEntryFee + estimatedExitFee;
  const estimatedRoundTripFee = estimatedRoundTripFees;
  const expectedGrossAtTp = notional * (takeProfitPercent / 100);
  const expectedGrossAtSl = notional * (stopLossPercent / 100);
  const expectedGrossPnL = expectedGrossAtTp;
  const expectedGrossToFeeRatio =
    estimatedRoundTripFees > 0 ? expectedGrossAtTp / estimatedRoundTripFees : Number.POSITIVE_INFINITY;
  const feeToExpectedGrossRatio =
    expectedGrossAtTp > 0 ? estimatedRoundTripFees / expectedGrossAtTp : Number.POSITIVE_INFINITY;
  const minimumGrossToCoverFees = estimatedRoundTripFees;
  const expectedNetAfterFeesAtTp = expectedGrossAtTp - estimatedRoundTripFees;
  const expectedNetAfterFeesAtSl = -expectedGrossAtSl - estimatedRoundTripFees;
  const expectedNetPnL = expectedNetAfterFeesAtTp;

  return {
    generatedAt: new Date().toISOString(),
    entryPrice: round(entryPrice),
    quantity: round(quantity, 8),
    notional: round(notional),
    takerFeeRate: round(takerFeeRate, 6),
    estimatedEntryFee: round(estimatedEntryFee),
    estimatedExitFee: round(estimatedExitFee),
    estimatedRoundTripFees: round(estimatedRoundTripFees),
    estimatedRoundTripFee: round(estimatedRoundTripFee),
    expectedGrossAtTp: round(expectedGrossAtTp),
    expectedGrossPnL: round(expectedGrossPnL),
    expectedGrossAtSl: round(expectedGrossAtSl),
    expectedGrossToFeeRatio: round(expectedGrossToFeeRatio, 4),
    feeToExpectedGrossRatio: round(feeToExpectedGrossRatio, 4),
    minimumGrossToCoverFees: round(minimumGrossToCoverFees),
    expectedNetAfterFeesAtTp: round(expectedNetAfterFeesAtTp),
    expectedNetAfterFeesAtSl: round(expectedNetAfterFeesAtSl),
    expectedNetPnL: round(expectedNetPnL),
    takeProfitPercent: round(takeProfitPercent, 4),
    stopLossPercent: round(stopLossPercent, 4),
  };
}

export function reconcileFeeStatus(input: {
  grossPnL: number;
  entryFee: number;
  exitFee: number;
  totalFee: number;
  netPnL: number;
  slippageCost?: number;
}): "PASS" | "FAIL" | "UNKNOWN" {
  const gross = Number(input.grossPnL);
  const entryFee = Number(input.entryFee);
  const exitFee = Number(input.exitFee);
  const totalFee = Number(input.totalFee);
  const netPnL = Number(input.netPnL);
  if (![gross, entryFee, exitFee, totalFee, netPnL].every((v) => Number.isFinite(v))) {
    return "UNKNOWN";
  }
  const expectedTotal = entryFee + exitFee + (input.slippageCost ?? 0);
  const totalDelta = Math.abs(totalFee - expectedTotal);
  const netDelta = Math.abs(netPnL - (gross - totalFee));
  return totalDelta <= 0.000001 && netDelta <= 0.000001 ? "PASS" : "FAIL";
}

export function computeClosedTradeFeeRatio(input: { grossPnL: number; totalFee: number }) {
  const grossAbs = Math.abs(Number(input.grossPnL));
  if (!Number.isFinite(grossAbs) || grossAbs <= 0) return grossAbs === 0 && input.totalFee > 0 ? Number.POSITIVE_INFINITY : 0;
  return Number((input.totalFee / grossAbs).toFixed(6));
}
