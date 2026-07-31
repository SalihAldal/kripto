import { randomUUID } from "node:crypto";
import type { ExchangeVenue, SmartOrderPlan, SmartOrderRequest, SmartOrderSlice } from "@/src/server/trading-core/smart-execution/execution-types";

export class SplitOrderPlanner {
  plan(request: SmartOrderRequest, venue: ExchangeVenue): SmartOrderPlan {
    const splitCount = Math.max(1, Math.min(20, Math.floor(request.splitCount ?? this.defaultSplitCount(request.quantity))));
    const baseQty = request.quantity / splitCount;
    const slices: SmartOrderSlice[] = Array.from({ length: splitCount }).map((_, index) => ({
      sliceId: randomUUID(),
      symbol: request.symbol.toUpperCase(),
      side: request.side,
      type: request.type,
      quantity: Number((index === splitCount - 1 ? request.quantity - baseQty * index : baseQty).toFixed(8)),
      limitPrice: request.price,
      venue: venue.name,
      status: "PLANNED",
    }));
    const notional = request.quantity * (request.price ?? 1);
    const feeRate = request.type === "LIMIT" ? venue.makerFeeRate : venue.takerFeeRate;
    return {
      planId: randomUUID(),
      request,
      selectedVenue: venue,
      slices,
      expectedFee: Number((notional * feeRate).toFixed(8)),
      maxSlippageBps: request.maxSlippageBps,
      createdAt: new Date().toISOString(),
    };
  }

  private defaultSplitCount(quantity: number) {
    if (quantity >= 1000) return 8;
    if (quantity >= 250) return 5;
    if (quantity >= 50) return 3;
    return 1;
  }
}
