import { scoreAllStrategies } from "@/src/server/strategy-selector/strategy-scoring.service";
import { detectMarketRegime } from "@/src/server/strategy-selector/regime-detection.service";
import { classifyCoin } from "@/src/server/strategy-selector/coin-classification.service";
import { persistStrategyBenchmark } from "@/src/server/strategy-selector/strategy-selector.repository";
import { emitStrategySelectorEvent, STRATEGY_SELECTOR_EVENT } from "@/src/server/strategy-selector/strategy-selector.events";
import { getAllStrategyProfiles } from "@/src/server/strategy-selector/strategy-library.service";
import type { StrategySelectorType } from "@prisma/client";

export async function generateStrategyBenchmark(symbol = "BTCUSDT") {
  const regime = await detectMarketRegime(symbol);
  const coinClass = await classifyCoin(symbol);
  const scores = await scoreAllStrategies(symbol, regime, coinClass);

  const comparisons = [];
  const types: StrategySelectorType[] = ["MOMENTUM", "BREAKOUT", "RANGE_TRADING", "NEWS", "WHALE", "PULLBACK", "TREND_FOLLOWING"];
  for (let i = 0; i < types.length; i++) {
    for (let j = i + 1; j < types.length; j++) {
      const a = scores.find((s) => s.strategyType === types[i]);
      const b = scores.find((s) => s.strategyType === types[j]);
      if (a && b) {
        comparisons.push({
          a: types[i], b: types[j],
          winner: a.totalScore >= b.totalScore ? types[i] : types[j],
          delta: Number(Math.abs(a.totalScore - b.totalScore).toFixed(1)),
        });
      }
    }
  }

  const benchmark = await persistStrategyBenchmark(
    scores.map((s, i) => ({ rank: i + 1, ...s })),
    comparisons,
    scores[0]?.strategyType,
  );

  emitStrategySelectorEvent(STRATEGY_SELECTOR_EVENT.BENCHMARK_GENERATED, { benchmarkKey: benchmark.benchmarkKey });
  return { benchmark, rankings: scores, comparisons, profiles: getAllStrategyProfiles().length };
}
