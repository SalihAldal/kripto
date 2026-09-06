export function roundQuantityDown(quantity: number, stepSize: number) {
  if (!Number.isFinite(stepSize) || stepSize <= 0) return Number(quantity.toFixed(8));
  const steps = Math.floor(quantity / stepSize);
  return Number((steps * stepSize).toFixed(8));
}

export function computePartialLegQuantity(input: {
  legId: string;
  fractionOfInitial: number;
  initialQuantity: number;
  remainingQuantity: number;
  completedLegs: string[];
  stepSize: number;
  minNotional: number;
  markPrice: number;
}) {
  if (input.completedLegs.includes(input.legId)) {
    return { quantity: 0, reasonCode: "LEG_ALREADY_COMPLETED", applicable: false };
  }
  const baseQty = roundQuantityDown(input.initialQuantity * input.fractionOfInitial, input.stepSize);
  const capped = Math.min(baseQty, input.remainingQuantity);
  if (capped <= 0) return { quantity: 0, reasonCode: "ZERO_LEG_QUANTITY", applicable: false };
  const notional = capped * input.markPrice;
  if (notional < input.minNotional) {
    return { quantity: 0, reasonCode: "MIN_NOTIONAL_UNMET", applicable: false };
  }
  return { quantity: capped, reasonCode: "LEG_READY", applicable: true };
}

export function applyPartialFill(input: {
  requestedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
}) {
  const filled = Math.min(input.filledQuantity, input.requestedQuantity, input.remainingQuantity);
  const nextRemaining = Math.max(0, Number((input.remainingQuantity - filled).toFixed(8)));
  const partial = filled > 0 && filled < input.requestedQuantity;
  return { filled, nextRemaining, partial, legComplete: filled >= input.requestedQuantity };
}

export function totalSellWouldExceed(input: {
  reservedSellQuantity: number;
  requestedQuantity: number;
  remainingQuantity: number;
}) {
  return input.reservedSellQuantity + input.requestedQuantity > input.remainingQuantity;
}
