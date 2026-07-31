import { env } from "@/lib/config";

export function estimateSlippage(input: {
  spreadPercent: number;
  liquidityScore: number;
  orderType: string;
  urgency: "normal" | "high" | "emergency";
}) {
  let slippage = input.spreadPercent * 0.5;
  if (input.liquidityScore < 40) slippage += 0.08;
  if (input.orderType === "MARKET") slippage += 0.04;
  if (input.urgency === "emergency") slippage += 0.06;
  return Number(slippage.toFixed(4));
}

export function validateSlippage(expectedSlippagePct: number) {
  const max = env.EXECUTION_ENGINE_V2_MAX_SLIPPAGE_PERCENT;
  if (expectedSlippagePct > max) {
    return { allowed: false, reason: `Expected slippage ${expectedSlippagePct.toFixed(3)}% exceeds max ${max}%` };
  }
  return { allowed: true as const };
}

export function computeActualSlippage(requestedPrice: number, fillPrice: number, side: "BUY" | "SELL") {
  if (requestedPrice <= 0 || fillPrice <= 0) return 0;
  const raw = side === "BUY" ? ((fillPrice - requestedPrice) / requestedPrice) * 100 : ((requestedPrice - fillPrice) / requestedPrice) * 100;
  return Number(Math.max(0, raw).toFixed(4));
}
