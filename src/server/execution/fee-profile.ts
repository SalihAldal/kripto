import { env } from "@/lib/config";

export const BINANCE_TR_SILVER_FEE_PROFILE = {
  tier: "GUMUS",
  makerFeeRate: 0.0009,
  takerFeeRate: 0.0015,
  bnbDiscountedMakerFeeRate: 0.000675,
  bnbDiscountedTakerFeeRate: 0.001125,
} as const;

export function resolveBinanceTakerFeeRate() {
  if (env.BINANCE_BNB_FEE_DISCOUNT_ENABLED) {
    return BINANCE_TR_SILVER_FEE_PROFILE.bnbDiscountedTakerFeeRate;
  }
  return Number.isFinite(env.BINANCE_TAKER_FEE_RATE)
    ? env.BINANCE_TAKER_FEE_RATE
    : BINANCE_TR_SILVER_FEE_PROFILE.takerFeeRate;
}

export function resolveBinanceMakerFeeRate() {
  if (env.BINANCE_BNB_FEE_DISCOUNT_ENABLED) {
    return BINANCE_TR_SILVER_FEE_PROFILE.bnbDiscountedMakerFeeRate;
  }
  return Number.isFinite(env.BINANCE_MAKER_FEE_RATE)
    ? env.BINANCE_MAKER_FEE_RATE
    : BINANCE_TR_SILVER_FEE_PROFILE.makerFeeRate;
}

export function resolveRoundTripTakerFeePercent() {
  return Number((resolveBinanceTakerFeeRate() * 2 * 100).toFixed(4));
}

export function calculateTakerFee(notional: number) {
  const safeNotional = Number.isFinite(notional) && notional > 0 ? notional : 0;
  return Number((safeNotional * resolveBinanceTakerFeeRate()).toFixed(8));
}
