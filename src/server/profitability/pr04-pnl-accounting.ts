import type { ExitFillRecord, ExitPnlSnapshot, ExitPolicyState } from "@/src/server/profitability/pr04-types";

export function computeWeightedEntryPrice(fills: Array<{ price: number; quantity: number }>) {
  let totalQty = 0;
  let totalCost = 0;
  for (const row of fills) {
    totalQty += row.quantity;
    totalCost += row.price * row.quantity;
  }
  if (totalQty <= 0) return null;
  return Number((totalCost / totalQty).toFixed(8));
}

export function buildExitPnlSnapshot(input: {
  state: ExitPolicyState;
  markPrice: number | null;
  side: "LONG" | "SHORT";
}): ExitPnlSnapshot {
  const reasonCodes: string[] = [];
  const entry = computeWeightedEntryPrice(input.state.entryFills) ?? input.state.riskReference.entryPrice;
  let realizedGross = 0;
  let realizedFees = 0;
  for (const fill of input.state.exitFills) {
    const sign = input.side === "LONG" ? 1 : -1;
    realizedGross += sign * (fill.price - entry) * fill.quantity;
    realizedFees += fill.fee;
  }
  const realizedNet = Number((realizedGross - realizedFees).toFixed(8));
  let unrealizedGross: number | null = null;
  let unrealizedNet: number | null = null;
  if (input.markPrice != null && input.state.remainingQuantity > 0) {
    const sign = input.side === "LONG" ? 1 : -1;
    unrealizedGross = sign * (input.markPrice - entry) * input.state.remainingQuantity;
    unrealizedNet = unrealizedGross;
  } else if (input.state.remainingQuantity > 0 && input.markPrice == null) {
    reasonCodes.push("UNREALIZED_MARK_MISSING");
  }
  const hasUnknownFee = input.state.exitFills.some((f) => f.feeAsset === "UNKNOWN");
  if (hasUnknownFee) reasonCodes.push("FEE_ASSET_UNKNOWN");
  const status =
    hasUnknownFee ? "UNKNOWN" : input.state.exitFills.length > 0 && input.state.remainingQuantity > 0 ? "PARTIAL" : realizedGross !== 0 || input.state.exitFills.length > 0 ? "KNOWN" : "KNOWN";
  return {
    realizedGrossPnl: Number(realizedGross.toFixed(8)),
    realizedFees: Number(realizedFees.toFixed(8)),
    realizedNetPnl: hasUnknownFee ? null : realizedNet,
    unrealizedGrossPnl: unrealizedGross != null ? Number(unrealizedGross.toFixed(8)) : null,
    unrealizedNetPnl: unrealizedNet != null && !hasUnknownFee ? Number(unrealizedNet.toFixed(8)) : null,
    status: hasUnknownFee ? "UNKNOWN" : status,
    reasonCodes,
  };
}

export function allocateFeeAcrossFills(input: {
  totalFee: number;
  fills: ExitFillRecord[];
  feeAsset: ExitFillRecord["feeAsset"];
}) {
  const totalQty = input.fills.reduce((acc, row) => acc + row.quantity, 0);
  if (totalQty <= 0) return input.fills;
  return input.fills.map((row) => ({
    ...row,
    fee: Number(((input.totalFee * row.quantity) / totalQty).toFixed(8)),
    feeAsset: input.feeAsset,
  }));
}

export function priceBreakEvenWithFees(input: {
  entryPrice: number;
  entryFeePerUnit: number;
  exitFeePerUnit: number;
}) {
  return Number((input.entryPrice + input.entryFeePerUnit + input.exitFeePerUnit).toFixed(8));
}
