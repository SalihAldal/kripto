import { resolveBinanceMakerFeeRate, resolveBinanceTakerFeeRate } from "@/src/server/execution/fee-profile";
import type { SimulatedFill } from "@/src/server/exchange-simulator/exchange-simulator.types";

export type FeeType = "MAKER" | "TAKER";

export function resolveFeeRate(type: FeeType = "TAKER") {
  return type === "MAKER" ? resolveBinanceMakerFeeRate() : resolveBinanceTakerFeeRate();
}

export function calculateFillFee(notional: number, type: FeeType = "TAKER") {
  const rate = resolveFeeRate(type);
  return {
    feeType: type,
    feeRate: rate,
    feeAmount: Number((notional * rate).toFixed(8)),
    notional,
  };
}

export function calculateFillsFees(fills: Array<{ quantity: number; price: number }>, type: FeeType = "TAKER"): SimulatedFill[] {
  return fills.map((fill, index) => {
    const notional = fill.quantity * fill.price;
    const feeInfo = calculateFillFee(notional, type);
    return {
      fillIndex: index + 1,
      quantity: fill.quantity,
      price: fill.price,
      notional,
      fee: feeInfo.feeAmount,
      slippagePct: 0,
      filledAt: new Date().toISOString(),
    };
  });
}

export function totalFeesFromFills(fills: SimulatedFill[]) {
  return Number(fills.reduce((sum, fill) => sum + fill.fee, 0).toFixed(8));
}

// Future-ready stubs
export function resolveVipFeeRate(_vipLevel: number, type: FeeType = "TAKER") {
  return resolveFeeRate(type);
}

export function applyBnbDiscount(fee: number, _enabled = false) {
  return fee;
}

export function applyReferralDiscount(fee: number, _referralPct = 0) {
  return fee;
}
