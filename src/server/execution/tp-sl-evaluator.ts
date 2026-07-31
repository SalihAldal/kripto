type Side = "LONG" | "SHORT";

export type ExitDecision = {
  shouldClose: boolean;
  reason?: "TAKE_PROFIT" | "STOP_LOSS";
};

export function evaluateTakeProfitStopLoss(
  side: Side,
  currentPrice: number,
  takeProfitPrice?: number,
  stopLossPrice?: number,
): ExitDecision {
  if (side === "LONG") {
    if (takeProfitPrice && currentPrice >= takeProfitPrice) return { shouldClose: true, reason: "TAKE_PROFIT" };
    if (stopLossPrice && currentPrice <= stopLossPrice) return { shouldClose: true, reason: "STOP_LOSS" };
    return { shouldClose: false };
  }

  if (takeProfitPrice && currentPrice <= takeProfitPrice) return { shouldClose: true, reason: "TAKE_PROFIT" };
  if (stopLossPrice && currentPrice >= stopLossPrice) return { shouldClose: true, reason: "STOP_LOSS" };
  return { shouldClose: false };
}
