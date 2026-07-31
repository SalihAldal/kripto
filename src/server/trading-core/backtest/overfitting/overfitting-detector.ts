import { ProfessionalBacktestEngine } from "@/src/server/trading-core/backtest/backtest-engine";
import type { BacktestMarketData, BacktestMetrics, BacktestRequest } from "@/src/server/trading-core/backtest/backtest-types";
import { buildSyntheticMarketData } from "@/src/server/trading-core/backtest/sample-data";
import type { OverfittingCheckResult, OverfittingDetectionReport, OverfittingDetectionRequest, OverfittingRiskLevel } from "@/src/server/trading-core/backtest/overfitting/overfitting-types";
import { monteCarloCandles, randomizeCandles, regimeVariants, splitOutOfSample } from "@/src/server/trading-core/backtest/overfitting/market-data-variants";
import { WalkForwardAnalysis } from "@/src/server/trading-core/optimization/walk-forward-analysis";

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export class BacktestOverfittingDetector {
  private readonly engine = new ProfessionalBacktestEngine();
  private readonly walkForward = new WalkForwardAnalysis();

  async detect(request: OverfittingDetectionRequest): Promise<OverfittingDetectionReport> {
    const marketData =
      request.backtest.marketData ??
      buildSyntheticMarketData(request.backtest.symbols ?? ["BTCUSDT", "ETHUSDT"], request.backtest.candlesPerSymbol ?? 320);
    const base = this.buildBacktestRequest(request.backtest, marketData);
    const baseResult = await this.engine.run(base);
    const checks = [
      await this.walkForwardCheck(base, marketData, request.windows ?? 4),
      await this.outOfSampleCheck(base, marketData, baseResult.metrics),
      await this.monteCarloCheck(base, marketData, request.monteCarloRuns ?? 12),
      await this.regimeVariationCheck(base, marketData, baseResult.metrics),
      await this.randomizationCheck(base, marketData, baseResult.metrics, request.randomizationRuns ?? 8),
    ];
    const riskScore = Number(average(checks.map((check) => check.riskScore)).toFixed(2));
    const riskLevel = this.riskLevel(riskScore, checks);
    return {
      riskLevel,
      riskScore,
      passed: riskLevel === "LOW" || riskLevel === "MEDIUM",
      checks,
      recommendation: this.recommendation(riskLevel, checks),
      generatedAt: new Date().toISOString(),
    };
  }

  private async walkForwardCheck(base: BacktestRequest, marketData: BacktestMarketData[], windows: number): Promise<OverfittingCheckResult> {
    const rows = [];
    for (const window of this.walkForward.buildWindows(marketData, windows)) {
      const [train, test] = await Promise.all([
        this.engine.run({ ...base, marketData: window.train }),
        this.engine.run({ ...base, marketData: window.test }),
      ]);
      rows.push(this.walkForward.score(train.metrics, test.metrics));
    }
    const riskScore = Number(average(rows.map((row) => row.overfittingScore)).toFixed(2));
    const stability = Number(average(rows.map((row) => row.stabilityScore)).toFixed(2));
    return {
      name: "walk_forward",
      passed: riskScore <= 45 && stability >= 45,
      riskScore,
      message: `Walk-forward risk=${riskScore}, stability=${stability}`,
      details: { windows: rows.length, stability },
    };
  }

  private async outOfSampleCheck(base: BacktestRequest, marketData: BacktestMarketData[], baseMetrics: BacktestMetrics): Promise<OverfittingCheckResult> {
    const split = splitOutOfSample(marketData);
    const result = await this.engine.run({ ...base, marketData: split.test });
    const pnlDrop = baseMetrics.totalPnl > 0 ? Math.max(0, ((baseMetrics.totalPnl - result.metrics.totalPnl) / baseMetrics.totalPnl) * 100) : 0;
    const riskScore = Math.min(100, pnlDrop * 0.8 + Math.max(0, 1 - result.metrics.profitFactor) * 25 + Math.max(0, result.metrics.maxDrawdown - baseMetrics.maxDrawdown) * 2);
    return {
      name: "out_of_sample",
      passed: riskScore <= 50 && result.metrics.tradeCount >= 2,
      riskScore: Number(riskScore.toFixed(2)),
      message: `Out-of-sample PnL=${result.metrics.totalPnl}, pnlDrop=${pnlDrop.toFixed(2)}%`,
      metrics: result.metrics,
    };
  }

  private async monteCarloCheck(base: BacktestRequest, marketData: BacktestMarketData[], runs: number): Promise<OverfittingCheckResult> {
    const results = await Promise.all(
      Array.from({ length: runs }).map((_, index) => this.engine.run({ ...base, marketData: monteCarloCandles(marketData, index + 11) })),
    );
    const profitable = results.filter((result) => result.metrics.totalPnl > 0).length;
    const passRate = profitable / Math.max(1, results.length);
    const avgDrawdown = average(results.map((result) => result.metrics.maxDrawdown));
    const riskScore = Math.min(100, (1 - passRate) * 70 + Math.max(0, avgDrawdown - 15) * 2);
    return {
      name: "monte_carlo",
      passed: passRate >= 0.55 && riskScore <= 55,
      riskScore: Number(riskScore.toFixed(2)),
      message: `Monte Carlo passRate=${(passRate * 100).toFixed(2)}%, avgDrawdown=${avgDrawdown.toFixed(2)}%`,
      details: { runs, passRate, avgDrawdown },
    };
  }

  private async regimeVariationCheck(base: BacktestRequest, marketData: BacktestMarketData[], baseMetrics: BacktestMetrics): Promise<OverfittingCheckResult> {
    const variants = regimeVariants(marketData);
    const results = await Promise.all(variants.map((variant) => this.engine.run({ ...base, marketData: variant.data }).then((result) => ({ variant: variant.name, result }))));
    const profitable = results.filter((row) => row.result.metrics.totalPnl > 0).length;
    const passRate = results.length > 0 ? profitable / results.length : 0;
    const drawdownSpike = Math.max(0, ...results.map((row) => row.result.metrics.maxDrawdown - baseMetrics.maxDrawdown));
    const riskScore = Math.min(100, (1 - passRate) * 65 + drawdownSpike * 2);
    return {
      name: "regime_variation",
      passed: passRate >= 0.5 && riskScore <= 60,
      riskScore: Number(riskScore.toFixed(2)),
      message: `Regime variation passRate=${(passRate * 100).toFixed(2)}%`,
      details: { variants: results.map((row) => ({ name: row.variant, metrics: row.result.metrics })) },
    };
  }

  private async randomizationCheck(base: BacktestRequest, marketData: BacktestMarketData[], baseMetrics: BacktestMetrics, runs: number): Promise<OverfittingCheckResult> {
    const results = await Promise.all(
      Array.from({ length: runs }).map((_, index) => this.engine.run({ ...base, marketData: randomizeCandles(marketData, index + 101) })),
    );
    const avgRandomPnl = average(results.map((result) => result.metrics.totalPnl));
    const edge = baseMetrics.totalPnl - avgRandomPnl;
    const randomWins = results.filter((result) => result.metrics.totalPnl >= baseMetrics.totalPnl * 0.8).length;
    const riskScore = Math.min(100, randomWins * (100 / Math.max(1, runs)) + (edge <= 0 ? 45 : 0));
    return {
      name: "randomization",
      passed: riskScore <= 45,
      riskScore: Number(riskScore.toFixed(2)),
      message: `Randomization avgPnl=${avgRandomPnl.toFixed(4)}, edge=${edge.toFixed(4)}`,
      details: { runs, randomWins, avgRandomPnl, basePnl: baseMetrics.totalPnl },
    };
  }

  private buildBacktestRequest(input: OverfittingDetectionRequest["backtest"], marketData: BacktestMarketData[]): BacktestRequest {
    return {
      initialBalance: input.initialBalance,
      leverage: input.leverage,
      futures: input.futures,
      allowShort: input.allowShort,
      positionSizePercent: input.positionSizePercent,
      takeProfitPercent: input.takeProfitPercent,
      stopLossPercent: input.stopLossPercent,
      strategies: input.strategies,
      costModel: input.costModel,
      marketData,
    };
  }

  private riskLevel(score: number, checks: OverfittingCheckResult[]): OverfittingRiskLevel {
    if (checks.some((check) => !check.passed && check.riskScore >= 75) || score >= 75) return "CRITICAL";
    if (score >= 55 || checks.filter((check) => !check.passed).length >= 3) return "HIGH";
    if (score >= 35 || checks.some((check) => !check.passed)) return "MEDIUM";
    return "LOW";
  }

  private recommendation(level: OverfittingRiskLevel, checks: OverfittingCheckResult[]) {
    if (level === "LOW") return "Strategy passed overfitting checks. Still monitor live/paper performance before increasing capital.";
    if (level === "MEDIUM") return "Strategy has moderate overfitting signs. Reduce sizing and require more out-of-sample data.";
    const failed = checks.filter((check) => !check.passed).map((check) => check.name).join(", ");
    return `Strategy likely overfit. Do not deploy live until these checks improve: ${failed}`;
  }
}

export const backtestOverfittingDetector = new BacktestOverfittingDetector();
