import { backtestOverfittingDetector } from "@/src/server/trading-core/backtest/overfitting";
import { tradingConfig } from "@/src/server/trading-core/config";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { strategyOptimizer } from "@/src/server/trading-core/optimization";
import type { StrategyEvolutionPatch, StrategyEvolutionRequest, StrategyEvolutionResult, StrategyEvolutionStage } from "@/src/server/trading-core/strategy-evolution/strategy-evolution-types";

export class StrategyEvolutionEngine {
  private lastResult: StrategyEvolutionResult | null = null;

  async evolve(request: StrategyEvolutionRequest): Promise<StrategyEvolutionResult> {
    const simulation = await strategyOptimizer.optimize({
      strategy: request.strategy,
      marketData: request.marketData,
      initialBalance: request.initialBalance,
      futures: request.futures,
      allowShort: request.allowShort,
      positionSizePercent: request.positionSizePercent,
      maxCandidates: request.maxCandidates ?? 16,
      apply: false,
    });
    const best = simulation.best;
    const proposedPatch = best ? this.patchFromSimulation(simulation) : undefined;
    const overfittingReport = best
      ? await backtestOverfittingDetector.detect({
          backtest: {
            initialBalance: request.initialBalance,
            leverage: proposedPatch?.global.leverage ?? best.params.leverage,
            futures: request.futures,
            allowShort: request.allowShort,
            positionSizePercent: request.positionSizePercent,
            takeProfitPercent: proposedPatch?.global.takeProfitPercent ?? best.params.takeProfitPercent,
            stopLossPercent: proposedPatch?.global.stopLossPercent ?? best.params.stopLossPercent,
            strategies: [{ name: request.strategy, enabled: true }],
            costModel: { makerFeeRate: 0.0002, takerFeeRate: 0.0004, slippageBps: 6, latencyMs: 250 },
            marketData: request.marketData,
          },
          windows: 4,
          monteCarloRuns: 10,
          randomizationRuns: 6,
        })
      : undefined;
    const safetyPassed = Boolean(simulation.recommendation.applySafe) && (request.requireOverfittingPass === false || overfittingReport?.passed === true);
    const promoted = Boolean(request.promote && safetyPassed && proposedPatch);
    if (promoted && proposedPatch) this.promote(request.strategy, proposedPatch);
    const stage: StrategyEvolutionStage = !best
      ? "REJECTED"
      : !safetyPassed
        ? "REJECTED"
        : promoted
          ? "PROMOTED"
          : "READY_FOR_PROMOTION";
    const result: StrategyEvolutionResult = {
      strategy: request.strategy,
      stage,
      bestCandidate: best,
      optimizedParams: best?.params,
      simulation,
      overfittingReport,
      proposedPatch,
      promoted,
      promotionReason: this.promotionReason(safetyPassed, promoted, simulation.recommendation.reason, overfittingReport?.recommendation),
      generatedAt: new Date().toISOString(),
    };
    this.lastResult = result;
    tradingLogger.info({
      category: "AI",
      source: "trading-core.strategy-evolution",
      message: `Strategy evolution ${request.strategy}: ${stage}`,
      status: promoted ? "SUCCESS" : safetyPassed ? "SKIPPED" : "FAILED",
      metricName: "strategy_evolution.optimization_score",
      metricValue: best?.optimizationScore ?? 0,
      context: { promoted, safetyPassed, overfittingPassed: overfittingReport?.passed },
    });
    return result;
  }

  status() {
    return {
      lastResult: this.lastResult,
      updatedAt: new Date().toISOString(),
    };
  }

  private patchFromSimulation(simulation: Awaited<ReturnType<typeof strategyOptimizer.optimize>>): StrategyEvolutionPatch | undefined {
    const best = simulation.best;
    if (!best) return undefined;
    const existingConfidence = tradingConfig.getGlobal("aiConfidenceThreshold");
    return {
      global: {
        takeProfitPercent: simulation.recommendation.configPatch?.global.takeProfitPercent ?? best.params.takeProfitPercent,
        stopLossPercent: simulation.recommendation.configPatch?.global.stopLossPercent ?? best.params.stopLossPercent,
        leverage: simulation.recommendation.configPatch?.global.leverage ?? best.params.leverage,
        aiConfidenceThreshold: Math.max(45, Math.min(85, Math.round((existingConfidence + best.params.minScore) / 2))),
      },
      strategy: {
        minScore: simulation.recommendation.configPatch?.strategy.minScore ?? best.params.minScore,
        params: {
          rsiOversold: best.params.rsiOversold,
          rsiOverbought: best.params.rsiOverbought,
          volatilityThreshold: best.params.volatilityThreshold,
          entryFilterStrength: best.params.entryFilterStrength,
        },
      },
    };
  }

  private promote(strategy: string, patch: StrategyEvolutionPatch) {
    tradingConfig.updateGlobal("takeProfitPercent", patch.global.takeProfitPercent);
    tradingConfig.updateGlobal("stopLossPercent", patch.global.stopLossPercent);
    tradingConfig.updateGlobal("leverage", patch.global.leverage);
    tradingConfig.updateGlobal("aiConfidenceThreshold", patch.global.aiConfidenceThreshold);
    tradingConfig.updateStrategy(strategy, {
      minScore: patch.strategy.minScore,
      params: {
        ...tradingConfig.getStrategy(strategy).params,
        ...patch.strategy.params,
      },
    });
  }

  private promotionReason(safe: boolean, promoted: boolean, optimizerReason: string, overfittingReason?: string) {
    if (promoted) return "Simulation and overfitting checks passed; patch promoted to production runtime config";
    if (!safe) return `Promotion blocked: ${optimizerReason}; ${overfittingReason ?? "overfitting report unavailable"}`;
    return "Patch is safe but kept in simulation/dry-run mode";
  }
}

const globalEvolution = globalThis as typeof globalThis & { __strategyEvolutionEngine?: StrategyEvolutionEngine };
export const strategyEvolutionEngine = globalEvolution.__strategyEvolutionEngine ?? new StrategyEvolutionEngine();
globalEvolution.__strategyEvolutionEngine = strategyEvolutionEngine;
