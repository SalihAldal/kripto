import { env } from "@/lib/config";
import type { FeeEdgeMetricsSnapshot } from "@/src/server/forensics/forensic.types";
import { resolveBinanceTakerFeeRate } from "@/src/server/execution/fee-profile";

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
  const takerFeeRate = resolveEffectiveTakerFeeRate(input.takerFeeRate);

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
    expectedGrossEdge: round(expectedGrossAtTp),
    expectedNetEdge: round(expectedNetAfterFeesAtTp),
    feeToGrossEdgeRatio: round(feeToExpectedGrossRatio, 4),
    minimumGrossMoveToCoverFees: round(minimumGrossToCoverFees),
    edgeAfterFees: round(expectedNetAfterFeesAtTp),
    takeProfitPercent: round(takeProfitPercent, 4),
    stopLossPercent: round(stopLossPercent, 4),
    feeEdgeClass: classifyFeeEdge({
      expectedGross: expectedGrossAtTp,
      expectedNet: expectedNetAfterFeesAtTp,
      fee: estimatedRoundTripFees,
      ratio: expectedGrossToFeeRatio,
    }),
    feeClassification: classifyFeeEdge({
      expectedGross: expectedGrossAtTp,
      expectedNet: expectedNetAfterFeesAtTp,
      fee: estimatedRoundTripFees,
      ratio: expectedGrossToFeeRatio,
    }),
  };
}

export type FeeEdgeClass = "FEE_SAFE" | "FEE_BORDERLINE" | "FEE_EROSION" | "UNKNOWN";

export function classifyFeeEdge(input: {
  expectedGross: number;
  expectedNet: number;
  fee: number;
  ratio?: number;
}): FeeEdgeClass {
  const expectedGross = Number(input.expectedGross);
  const expectedNet = Number(input.expectedNet);
  const fee = Number(input.fee);
  const ratio = Number(
    Number.isFinite(Number(input.ratio))
      ? input.ratio
      : fee > 0
        ? expectedGross / fee
        : Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(expectedGross) || !Number.isFinite(expectedNet) || !Number.isFinite(fee) || !Number.isFinite(ratio)) {
    return "UNKNOWN";
  }
  if (expectedGross <= 0 || expectedNet <= 0 || ratio < 1) return "FEE_EROSION";
  if (ratio < 1.5) return "FEE_BORDERLINE";
  return "FEE_SAFE";
}

export function resolveEffectiveTakerFeeRate(override?: number) {
  if (Number.isFinite(Number(override)) && Number(override) > 0) {
    return Number(override);
  }
  const profileRate = resolveBinanceTakerFeeRate();
  if (Number.isFinite(profileRate) && profileRate > 0) return profileRate;
  return Number(env.BINANCE_TAKER_FEE_RATE ?? 0.0015);
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
