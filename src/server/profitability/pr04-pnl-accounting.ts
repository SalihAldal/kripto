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
  const entryQuantity = input.state.entryFills.reduce((sum, fill) => sum + fill.quantity, 0);
  const entryFees = input.state.entryFills.reduce((sum, fill) => sum + fill.fee, 0);
  const exitedQuantity = input.state.exitFills.reduce((sum, fill) => sum + fill.quantity, 0);
  const entryFeeInvalid = input.state.entryFills.length === 0 || !(entryQuantity > 0) || input.state.entryFills.some(fill => !Number.isFinite(fill.fee) || fill.fee < 0);
  const allocatedEntryFee = entryFeeInvalid ? 0 : entryFees * Math.min(1, exitedQuantity / entryQuantity);
  const remainingEntryFee = entryFeeInvalid ? 0 : entryFees - allocatedEntryFee;
  for (const fill of input.state.exitFills) {
    const sign = input.side === "LONG" ? 1 : -1;
    realizedGross += sign * (fill.price - entry) * fill.quantity;
    // Non-quote fees need canonical settlement normalization/inventory reconciliation.
    // Never subtract a BASE amount from quote-currency PnL as if units matched.
    if (fill.feeAsset === "QUOTE" && Number.isFinite(fill.fee) && fill.fee >= 0) realizedFees += fill.fee;
  }
  const realizedNet = Number((realizedGross - realizedFees - allocatedEntryFee).toFixed(8));
  let unrealizedGross: number | null = null;
  let unrealizedNet: number | null = null;
  if (input.markPrice != null && input.state.remainingQuantity > 0) {
    const sign = input.side === "LONG" ? 1 : -1;
    unrealizedGross = sign * (input.markPrice - entry) * input.state.remainingQuantity;
    unrealizedNet = unrealizedGross - remainingEntryFee;
    reasonCodes.push("UNREALIZED_EXCLUDES_FUTURE_EXIT_COSTS");
  } else if (input.state.remainingQuantity > 0 && input.markPrice == null) {
    reasonCodes.push("UNREALIZED_MARK_MISSING");
  }
  const hasUnknownFee = entryFeeInvalid || input.state.exitFills.some((f) => f.feeAsset !== "QUOTE" || !Number.isFinite(f.fee) || f.fee < 0);
  if (entryFeeInvalid) reasonCodes.push("ENTRY_FEE_EVIDENCE_INVALID_OR_MISSING");
  if (input.state.exitFills.some(f => f.feeAsset === "BASE")) reasonCodes.push("BASE_FEE_REQUIRES_SETTLEMENT_NORMALIZATION");
  if (hasUnknownFee) reasonCodes.push("FEE_ASSET_UNKNOWN");
  const status =
    hasUnknownFee ? "UNKNOWN" : input.state.exitFills.length > 0 && input.state.remainingQuantity > 0 ? "PARTIAL" : realizedGross !== 0 || input.state.exitFills.length > 0 ? "KNOWN" : "KNOWN";
  return {
    realizedGrossPnl: Number(realizedGross.toFixed(8)),
    realizedFees: Number(realizedFees.toFixed(8)),
    realizedEntryFees: entryFeeInvalid ? undefined : Number(allocatedEntryFee.toFixed(8)),
    remainingEntryFees: entryFeeInvalid ? undefined : Number(remainingEntryFee.toFixed(8)),
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
