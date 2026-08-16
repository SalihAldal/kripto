import type { AIAnalysisInput, AIConsensusResult } from "@/src/types/ai";
import { resolveIndicatorSnapshot } from "@/src/server/ai/indicator-suite";

export type ShortTermScoreBreakdown = {
  structure: number;
  liquidity: number;
  volume: number;
  smartMoney: number;
  riskReward: number;
  momentum: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function computeShortTermScore(input: AIAnalysisInput, consensus: AIConsensusResult) {
  const ind = resolveIndicatorSnapshot(input);
  const mtf = input.multiTimeframe;
  const rr = Number(consensus.decisionPayload?.riskRewardRatio ?? 0);
  const volumeBoost = Number(ind.volumeBoost ?? 1);
  const liquidity = ind.liquidity;
  const smcConfluence =
    Boolean(liquidity.liquiditySweepDetected) &&
    Boolean(ind.orderBlock) &&
    (ind.marketStructure.bosUp || ind.marketStructure.bosDown);

  const structure =
    mtf && mtf.trendAligned && !mtf.conflict
      ? ind.marketStructure.bosUp || ind.marketStructure.bosDown
        ? 18
        : 14
      : 6;
  const liquidityScore = liquidity.liquiditySweepDetected
    ? 18
    : liquidity.nearUpperLiquidity || liquidity.nearLowerLiquidity || liquidity.nearSessionHigh || liquidity.nearSessionLow
      ? 12
      : 6;
  const volumeScore =
    volumeBoost >= 1.2 ? 18 : volumeBoost >= 1.05 ? 12 : volumeBoost >= 0.9 ? 8 : 4;
  const smartMoney =
    smcConfluence
      ? ind.fvg
        ? 20
        : 16
      : ind.orderBlock || ind.fvg
        ? 12
        : 6;
  const riskReward =
    rr >= 2.5 ? 10 : rr >= 2 ? 8 : rr >= 1.5 ? 6 : rr >= 1.2 ? 4 : 2;
  const momentumAligned =
    (consensus.finalDecision === "BUY" && ind.rsi14 >= 48 && ind.rsi14 <= 70 && ind.macd >= ind.signalLine) ||
    (consensus.finalDecision === "SELL" && ind.rsi14 <= 55 && ind.rsi14 >= 30 && ind.macd <= ind.signalLine);
  const divergencePenalty =
    (consensus.finalDecision === "BUY" && ind.divergence.bearish) ||
    (consensus.finalDecision === "SELL" && ind.divergence.bullish);
  const momentum = clamp(
    (momentumAligned ? 9 : 5) + (divergencePenalty ? -4 : 0) + (ind.expansionCandle ? 2 : 0),
    0,
    10,
  );

  const total = clamp(structure + liquidityScore + volumeScore + smartMoney + riskReward + momentum, 0, 100);

  return {
    total: Number(total.toFixed(2)),
    breakdown: {
      structure,
      liquidity: liquidityScore,
      volume: volumeScore,
      smartMoney,
      riskReward,
      momentum,
    } as ShortTermScoreBreakdown,
  };
}
