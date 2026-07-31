import type { BacktestMarketData, BacktestMetrics } from "@/src/server/trading-core/backtest/backtest-types";
import type { WalkForwardResult, WalkForwardWindow } from "@/src/server/trading-core/optimization/optimization-types";

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class WalkForwardAnalysis {
  buildWindows(marketData: BacktestMarketData[], windows = 3): WalkForwardWindow[] {
    const minCandles = Math.min(...marketData.map((item) => item.candles.length));
    if (!Number.isFinite(minCandles) || minCandles < 80) {
      return [{ index: 0, train: marketData, test: marketData }];
    }
    const windowSize = Math.floor(minCandles / (windows + 1));
    return Array.from({ length: windows }).map((_, index) => {
      const trainEnd = windowSize * (index + 1);
      const testEnd = Math.min(minCandles, trainEnd + windowSize);
      return {
        index,
        train: marketData.map((item) => ({ symbol: item.symbol, candles: item.candles.slice(0, trainEnd) })),
        test: marketData.map((item) => ({ symbol: item.symbol, candles: item.candles.slice(trainEnd, testEnd) })),
      };
    });
  }

  aggregate(results: WalkForwardResult[]): WalkForwardResult | null {
    if (results.length === 0) return null;
    const first = results[0];
    const trainMetrics = this.averageMetrics(results.map((row) => row.trainMetrics));
    const testMetrics = this.averageMetrics(results.map((row) => row.testMetrics));
    const stabilityScore = average(results.map((row) => row.stabilityScore));
    const overfittingScore = average(results.map((row) => row.overfittingScore));
    const optimizationScore = average(results.map((row) => row.optimizationScore));
    return {
      candidateId: first.candidateId,
      params: first.params,
      trainMetrics,
      testMetrics,
      stabilityScore: Number(stabilityScore.toFixed(4)),
      overfittingScore: Number(overfittingScore.toFixed(4)),
      optimizationScore: Number(optimizationScore.toFixed(4)),
    };
  }

  score(train: BacktestMetrics, test: BacktestMetrics) {
    const pnlGap = Math.abs(train.totalPnl - test.totalPnl);
    const sharpeGap = Math.abs(train.sharpeRatio - test.sharpeRatio);
    const winrateGap = Math.abs(train.winrate - test.winrate);
    const overfittingScore = Math.min(100, pnlGap * 0.35 + sharpeGap * 18 + winrateGap * 0.7);
    const stabilityScore = Math.max(0, 100 - overfittingScore - Math.max(0, test.maxDrawdown - train.maxDrawdown) * 2);
    const optimizationScore =
      test.totalPnl * 0.25 +
      test.sharpeRatio * 12 +
      test.expectancy * 4 +
      test.profitFactor * 8 +
      test.winrate * 0.25 -
      test.maxDrawdown * 1.8 -
      overfittingScore * 0.35;
    return {
      stabilityScore: Number(stabilityScore.toFixed(4)),
      overfittingScore: Number(overfittingScore.toFixed(4)),
      optimizationScore: Number(optimizationScore.toFixed(4)),
    };
  }

  private averageMetrics(rows: BacktestMetrics[]): BacktestMetrics {
    return {
      tradeCount: Math.round(average(rows.map((row) => row.tradeCount))),
      wins: Math.round(average(rows.map((row) => row.wins))),
      losses: Math.round(average(rows.map((row) => row.losses))),
      winrate: Number(average(rows.map((row) => row.winrate)).toFixed(2)),
      totalPnl: Number(average(rows.map((row) => row.totalPnl)).toFixed(8)),
      endingBalance: Number(average(rows.map((row) => row.endingBalance)).toFixed(8)),
      sharpeRatio: Number(average(rows.map((row) => row.sharpeRatio)).toFixed(4)),
      maxDrawdown: Number(average(rows.map((row) => row.maxDrawdown)).toFixed(4)),
      expectancy: Number(average(rows.map((row) => row.expectancy)).toFixed(8)),
      profitFactor: Number(average(rows.map((row) => row.profitFactor)).toFixed(4)),
    };
  }
}
