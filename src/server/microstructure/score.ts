import { clamp, signedScore } from "@/src/server/opportunity/normalize";
import type { OpportunityLane } from "@/src/server/opportunity/types";
import { MICRO_LANE_WEIGHTS } from "@/src/server/microstructure/config";
import type { MicroFeatures, MicroReasonCode, MicroScoreBreakdown } from "@/src/server/microstructure/types";

export function buildMicroBreakdown(features: MicroFeatures): MicroScoreBreakdown {
  const tinySpam = features.tradeRate5s > 20 && features.avgTradeNotional5s < Math.max(8, features.avgTradeNotional60s * 0.15);
  const tradeAccel = tinySpam ? signedScore(features.tradeRateAcceleration, 8) * 0.25 : signedScore(features.tradeRateAcceleration, 6);
  const whaleBuy = features.largeBuyNotional > 0 && features.largeBuyTradeRate < 0.4;
  return {
    takerBuyRatio: signedScore(features.takerBuyRatio5s - 0.5, 0.35),
    buyFlowAcceleration: signedScore(features.netFlowAcceleration, Math.max(40, features.takerBuyVolume15s / 15)),
    tradeAcceleration: tradeAccel,
    askDepletion: signedScore(features.askDepletionRate - features.askReloadRate, 0.35),
    bidSupport: signedScore(features.bidPersistence - 0.5 - features.bidWithdrawal, 0.4),
    depthImbalance: signedScore(
      features.depthImbalance10bps * 0.6 + features.topBookImbalance * 0.25 + features.depthImbalance25bps * 0.15,
      0.55,
    ),
    breakoutAcceptance: signedScore(features.breakoutRetestQuality + features.postBreakoutFlow * 0.4 - features.failedBreakout, 0.7),
    spreadQuality: signedScore(18 - features.spreadBps, 18),
    exhaustion: -Math.abs(
      signedScore(features.microExhaustion + features.failedBreakout * 0.5 + (whaleBuy ? 0 : 0), 0.55),
    ),
    divergence: -Math.abs(
      signedScore(features.priceFlowDivergence + features.priceVolumeDivergence + features.priceBookDivergence, 0.7),
    ),
  };
}

export function scoreMicro(lane: OpportunityLane, breakdown: MicroScoreBreakdown, features: MicroFeatures): number {
  const weights = MICRO_LANE_WEIGHTS[lane];
  let weighted = 0;
  (Object.keys(weights) as Array<keyof MicroScoreBreakdown>).forEach((key) => {
    weighted += breakdown[key] * weights[key];
  });
  const buyBias = features.flowImbalance5s > 0 ? 50 : 0;
  let raw = buyBias + weighted * 0.45;
  if (features.flowImbalance5s < 0 && features.flowImbalance15s < 0) {
    raw = Math.min(0, weighted);
  }
  raw += features.crossLayerConfirmation * 6;
  raw += features.buyAbsorption * 4;
  raw -= features.sellAbsorption * 8;
  raw -= features.largeAskAppearedThenRemoved * 4;
  raw -= features.largeBidAppearedThenRemoved * 3;
  return clamp(raw, -20, 100);
}

export function liquidityQualityScore(features: MicroFeatures): number {
  const spread = signedScore(18 - features.spreadBps, 18);
  const depth = signedScore(Math.log10(Math.max(1, features.bidLiquidity + features.askLiquidity)) - 2.5, 1.4);
  const activity = signedScore(features.takerBuyVolume15s + features.takerSellVolume15s, 8_000);
  const stability = signedScore(0.6 - features.liquidityVolatility, 0.5);
  const sizeFit = signedScore(Math.min(20, features.depthToIntendedSize) - 2, 6);
  return clamp(52 + (spread * 0.28 + depth * 0.22 + activity * 0.2 + stability * 0.15 + sizeFit * 0.15) * 0.4, 0, 100);
}

export function executionQualityScore(features: MicroFeatures, liquidity: number): number {
  const slip = signedScore(25 - features.expectedSlippageBps, 25);
  const spread = signedScore(18 - features.spreadBps, 18);
  return clamp(liquidity * 0.55 + (slip * 0.25 + spread * 0.2) * 0.45 + 40, 0, 100);
}

export function reasonCodesFor(features: MicroFeatures, breakdown: MicroScoreBreakdown): MicroReasonCode[] {
  const codes: MicroReasonCode[] = [];
  if (features.takerBuyRatio5s >= 0.68) codes.push("MICRO_STRONG_TAKER_BUY");
  if (features.flowImbalance5s < -0.2) codes.push("MICRO_SELL_FLOW_DOMINANT");
  if (breakdown.buyFlowAcceleration > 12) codes.push("MICRO_BUY_FLOW_ACCELERATION");
  if (features.tradeRateAcceleration > 1.2) codes.push("MICRO_TRADE_RATE_EXPANSION");
  if (features.askDepletionRate > 0.12) codes.push("MICRO_ASK_DEPLETION");
  if (features.askReloadRate > 0.18) codes.push("MICRO_ASK_RELOAD");
  if (features.bidPersistence > 0.7 && features.bidWithdrawal < 0.15) codes.push("MICRO_BID_SUPPORT");
  if (features.bidWithdrawal > 0.25) codes.push("MICRO_BID_WITHDRAWAL");
  if (features.breakoutRetestQuality > 0.3) codes.push("MICRO_BREAKOUT_ACCEPTED");
  if (features.failedBreakout > 0.3) codes.push("MICRO_FAILED_BREAKOUT");
  if (features.buyAbsorption > 0.2) codes.push("MICRO_POSITIVE_ABSORPTION");
  if (features.priceFlowDivergence > 0.2) codes.push("MICRO_FLOW_DIVERGENCE");
  if (features.microExhaustion > 0.45) codes.push("MICRO_EXHAUSTION");
  if (features.tradeCount < 6 || features.takerBuyVolume15s + features.takerSellVolume15s < 200) {
    codes.push("MICRO_LOW_ACTIVITY");
  }
  if (features.spreadBps > 80) codes.push("MICRO_WIDE_SPREAD");
  if (features.crossLayerConfirmation > 0.5) codes.push("MICRO_CROSS_LAYER_CONFIRM");
  return [...new Set(codes)];
}
