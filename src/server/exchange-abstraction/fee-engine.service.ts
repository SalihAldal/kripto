import type { CanonicalFeeInfo } from "@/src/server/exchange-abstraction/exchange-abstraction.types";
import type { FeeEstimate } from "@/src/types/exchange";

export function normalizeFeeEstimate(
  canonicalSymbol: string,
  estimate: FeeEstimate,
  extras?: { withdrawalFee?: number; depositFee?: number; bnbDiscount?: number },
): CanonicalFeeInfo {
  return {
    canonicalSymbol,
    makerFeeRate: estimate.makerFeeRate,
    takerFeeRate: estimate.takerFeeRate,
    withdrawalFee: extras?.withdrawalFee,
    depositFee: extras?.depositFee ?? 0,
    bnbDiscount: extras?.bnbDiscount,
  };
}

export function estimateTradeFee(
  quantity: number,
  price: number,
  takerFeeRate: number,
  isMaker = false,
  makerFeeRate?: number,
): number {
  const rate = isMaker ? (makerFeeRate ?? takerFeeRate) : takerFeeRate;
  return quantity * price * rate;
}
