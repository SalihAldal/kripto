import type { SmartOrderRequest } from "@/src/server/trading-core/smart-execution/execution-types";

export class SlippageProtection {
  validate(request: SmartOrderRequest, referencePrice: number) {
    if (request.type === "MARKET" || !request.price || referencePrice <= 0) {
      return { ok: true, reason: "Market order or no reference price; slippage checked at execution" };
    }
    const slippageBps = Math.abs((request.price - referencePrice) / referencePrice) * 10_000;
    if (slippageBps > request.maxSlippageBps) {
      return {
        ok: false,
        reason: `Slippage protection blocked order: ${slippageBps.toFixed(2)}bps > ${request.maxSlippageBps}bps`,
      };
    }
    return { ok: true, reason: `Slippage within limit: ${slippageBps.toFixed(2)}bps` };
  }
}
