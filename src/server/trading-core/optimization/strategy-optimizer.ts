import type { BacktestRequest } from "@/src/server/trading-core/backtest/backtest-types";
import { ProfessionalBacktestEngine } from "@/src/server/trading-core/backtest/backtest-engine";
import { tradingConfig } from "@/src/server/trading-core/config";
import { AdaptiveParameterTuner } from "@/src/server/trading-core/optimization/adaptive-parameter-tuner";
import { OverfittingGuard } from "@/src/server/trading-core/optimization/overfitting-guard";
import type {
  StrategyOptimizationCandidate,
  StrategyOptimizationRequest,
  StrategyOptimizationResult,
  WalkForwardResult,
} from "@/src/server/trading-core/optimization/optimization-types";
import { StrategyParameterSearch } from "@/src/server/trading-core/optimization/parameter-search";
import { WalkForwardAnalysis } from "@/src/server/trading-core/optimization/walk-forward-analysis";

export class StrategyOptimizer {
  private readonly search = new StrategyParameterSearch();
  private readonly walkForward = new WalkForwardAnalysis();
  private readonly guard = new OverfittingGuard();
  private readonly tuner = new AdaptiveParameterTuner();
  private readonly backtest = new ProfessionalBacktestEngine();

  async optimize(request: StrategyOptimizationRequest): Promise<StrategyOptimizationResult> {
    const candidates = this.search.buildCandidates(request.strategy, request.maxCandidates ?? 12);
    const windows = this.walkForward.buildWindows(request.marketData);
    const results: WalkForwardResult[] = [];

    for (const candidate of candidates) {
      const windowResults: WalkForwardResult[] = [];
      for (const window of windows) {
        const [train, test] = await Promise.all([
          this.runCandidate(candidate, { ...request, marketData: window.train }),
          this.runCandidate(candidate, { ...request, marketData: window.test }),
        ]);
        const scores = this.walkForward.score(train.metrics, test.metrics);
        windowResults.push({
          candidateId: candidate.id,
          params: candidate.params,
          trainMetrics: train.metrics,
          testMetrics: test.metrics,
          ...scores,
        });
      }
      const aggregate = this.walkForward.aggregate(windowResults);
      if (aggregate) results.push(aggregate);
    }

    const ranked = results.sort((a, b) => b.optimizationScore - a.optimizationScore);
    const best = ranked[0] ?? null;
    const safety = best ? this.guard.isSafe(best) : { safe: false, reason: "No valid optimization result" };
    const configPatch = best ? this.tuner.buildPatch(best) : undefined;

    if (request.apply && best && safety.safe && configPatch) {
      tradingConfig.updateGlobal("takeProfitPercent", configPatch.global.takeProfitPercent);
      tradingConfig.updateGlobal("stopLossPercent", configPatch.global.stopLossPercent);
      tradingConfig.updateGlobal("leverage", configPatch.global.leverage);
      tradingConfig.updateStrategy(request.strategy, {
        minScore: configPatch.strategy.minScore,
        params: {
          ...tradingConfig.getStrategy(request.strategy).params,
          ...configPatch.strategy.params,
        },
      });
    }

    return {
      strategy: request.strategy,
      best,
      candidates: ranked,
      recommendation: {
        applySafe: safety.safe,
        reason: safety.reason,
        configPatch,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  private async runCandidate(candidate: StrategyOptimizationCandidate, request: StrategyOptimizationRequest) {
    const backtestRequest: BacktestRequest = {
      initialBalance: request.initialBalance,
      leverage: candidate.params.leverage,
      futures: request.futures,
      allowShort: request.allowShort,
      positionSizePercent: request.positionSizePercent,
      takeProfitPercent: candidate.params.takeProfitPercent,
      stopLossPercent: candidate.params.stopLossPercent,
      strategies: [{ name: candidate.strategy, enabled: true }],
      costModel: {
        makerFeeRate: 0.0002,
        takerFeeRate: 0.0004,
        slippageBps: 5 + candidate.params.entryFilterStrength * 2,
        latencyMs: 250,
      },
      marketData: request.marketData,
    };
    return this.backtest.run(backtestRequest);
  }
}

export const strategyOptimizer = new StrategyOptimizer();
