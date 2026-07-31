type Side = "LONG" | "SHORT";

export type PnlBreakdown = {
  realizedPnl: number;
  grossPnl: number;
  netPnl: number;
  feeTotal: number;
  slippageCost: number;
  roePercent: number;
};

export function calculateUnrealizedPnl(side: Side, entryPrice: number, markPrice: number, quantity: number) {
  const pnl =
    side === "LONG"
      ? (markPrice - entryPrice) * quantity
      : (entryPrice - markPrice) * quantity;
  return Number(pnl.toFixed(8));
}

export function calculateRealizedPnl(input: {
  side: Side;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  openFee: number;
  closeFee: number;
  slippageCost: number;
}): PnlBreakdown {
  const gross =
    input.side === "LONG"
      ? (input.exitPrice - input.entryPrice) * input.quantity
      : (input.entryPrice - input.exitPrice) * input.quantity;
  const feeTotal = input.openFee + input.closeFee;
  const net = gross - feeTotal - input.slippageCost;
  const capital = Math.max(input.entryPrice * input.quantity, 0.0001);
  const roe = (net / capital) * 100;
  return {
    realizedPnl: Number(net.toFixed(8)),
    grossPnl: Number(gross.toFixed(8)),
    netPnl: Number(net.toFixed(8)),
    feeTotal: Number(feeTotal.toFixed(8)),
    slippageCost: Number(input.slippageCost.toFixed(8)),
    roePercent: Number(roe.toFixed(4)),
  };
}
