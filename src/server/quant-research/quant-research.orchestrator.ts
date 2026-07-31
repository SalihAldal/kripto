import { ensureDefaultResearchProject, completeResearchRun, createResearchRun } from "@/src/server/quant-research/quant-research.repository";
import { generateStrategies } from "@/src/server/quant-research/strategy-generator.service";
import { generateIndicatorCombinations } from "@/src/server/quant-research/indicator-generator.service";
import { optimizeParameters } from "@/src/server/quant-research/parameter-optimizer.service";
import { runBacktest, runMultiWindowBacktests } from "@/src/server/quant-research/backtesting-engine.service";
import { runWalkForwardAnalysis } from "@/src/server/quant-research/walk-forward.service";
import { runMonteCarloSimulation } from "@/src/server/quant-research/monte-carlo.service";
import { runRegimeBenchmark } from "@/src/server/quant-research/regime-benchmark.service";
import { runStrategyCompetition } from "@/src/server/quant-research/strategy-competition.service";
import { evolveStrategies } from "@/src/server/quant-research/strategy-evolution.service";
import { runFeatureSelection } from "@/src/server/quant-research/feature-selection.service";
import { generateResearchReport } from "@/src/server/quant-research/research-reports.service";
import { runInstitutionalBenchmark } from "@/src/server/quant-research/institutional-benchmark.service";
import { syncResearchKnowledge } from "@/src/server/quant-research/knowledge-repository.service";
import { runSelfDiscovery } from "@/src/server/quant-research/self-discovery.service";
import { assertResearchIsolation } from "@/src/server/quant-research/research-environment.service";
import { emitQuantResearchEvent, QUANT_RESEARCH_EVENT } from "@/src/server/quant-research/quant-research.events";
import type { QuantResearchJobPayload } from "@/src/server/quant-research/quant-research.types";
import { runFullExperiment } from "@/src/server/quant-research/experiment-runner.service";
import { runCounterfactualAnalysis } from "@/src/server/quant-research/counterfactual-analysis.service";
import { runWalkForwardValidation } from "@/src/server/quant-research/walk-forward-validation.service";
import { runStrategyBenchmark } from "@/src/server/quant-research/strategy-benchmark.service";
import { runFeatureResearch } from "@/src/server/quant-research/feature-research.service";
import { runFeatureElimination } from "@/src/server/quant-research/feature-elimination.service";
import { runStatisticalValidation } from "@/src/server/quant-research/statistical-validation.service";
import { generateRecommendations } from "@/src/server/quant-research/recommendation-engine.service";
import { generateResearchHypotheses } from "@/src/server/quant-research/research-hypothesis.service";

export async function runQuantResearchJob(payload: QuantResearchJobPayload) {
  assertResearchIsolation();
  emitQuantResearchEvent(QUANT_RESEARCH_EVENT.PROJECT_STARTED, { type: payload.type });

  let result: unknown;
  switch (payload.type) {
    case "RESEARCH_RUN": {
      const project = payload.projectId
        ? { id: payload.projectId }
        : await ensureDefaultResearchProject();
      const run = await createResearchRun({
        projectId: project.id,
        runType: "FULL_RESEARCH_CYCLE",
        windowDays: payload.windowDays,
      });
      const backtests = await runMultiWindowBacktests();
      await completeResearchRun(run.id, `Full cycle: ${backtests.windows} windows`);
      result = { runId: run.id, backtests };
      break;
    }
    case "STRATEGY_GENERATE":
      result = await generateStrategies(payload.count, payload.archetypes);
      emitQuantResearchEvent(QUANT_RESEARCH_EVENT.STRATEGY_GENERATED, result as Record<string, unknown>);
      break;
    case "INDICATOR_GENERATE":
      result = await generateIndicatorCombinations(payload.count);
      break;
    case "PARAMETER_OPTIMIZE":
      result = await optimizeParameters({ genomeId: payload.genomeId, limit: payload.limit });
      break;
    case "BACKTEST":
      result = payload.windowDays
        ? await runBacktest({ genomeId: payload.genomeId, windowDays: payload.windowDays, projectId: payload.projectId })
        : await runMultiWindowBacktests(payload.genomeId);
      emitQuantResearchEvent(QUANT_RESEARCH_EVENT.BACKTEST_COMPLETED, result as Record<string, unknown>);
      break;
    case "WALK_FORWARD":
      result = await runWalkForwardAnalysis(payload);
      break;
    case "MONTE_CARLO":
      result = await runMonteCarloSimulation(payload);
      break;
    case "REGIME_BENCHMARK":
      result = await runRegimeBenchmark(payload);
      break;
    case "STRATEGY_COMPETITION":
      result = await runStrategyCompetition(payload.windowDays);
      break;
    case "STRATEGY_EVOLVE":
      result = await evolveStrategies(payload);
      emitQuantResearchEvent(QUANT_RESEARCH_EVENT.EVOLUTION_GENERATION, result as Record<string, unknown>);
      break;
    case "FEATURE_SELECT":
      result = await runFeatureSelection(payload.windowDays);
      break;
    case "INSTITUTIONAL_BENCHMARK":
      result = await runInstitutionalBenchmark(payload);
      break;
    case "RESEARCH_REPORT":
      result = await generateResearchReport(payload.cadence, payload.date ? new Date(payload.date) : new Date());
      emitQuantResearchEvent(QUANT_RESEARCH_EVENT.REPORT_GENERATED, result as Record<string, unknown>);
      break;
    case "SELF_DISCOVERY":
      result = await runSelfDiscovery();
      break;
    case "KNOWLEDGE_SYNC":
      result = await syncResearchKnowledge(payload.limit);
      break;
    case "EXPERIMENT_RUN":
      result = await runFullExperiment(payload);
      emitQuantResearchEvent(QUANT_RESEARCH_EVENT.EXPERIMENT_COMPLETED, result as Record<string, unknown>);
      break;
    case "COUNTERFACTUAL_ANALYZE":
      result = await runCounterfactualAnalysis(payload);
      break;
    case "WALK_FORWARD_VALIDATE":
      result = await runWalkForwardValidation(payload);
      break;
    case "STRATEGY_BENCHMARK":
      result = await runStrategyBenchmark(payload);
      break;
    case "FEATURE_RESEARCH":
      result = await runFeatureResearch(payload);
      break;
    case "FEATURE_ELIMINATE":
      result = await runFeatureElimination(payload);
      break;
    case "STATISTICAL_VALIDATE":
      result = await runStatisticalValidation(payload);
      break;
    case "RECOMMENDATION_GENERATE":
      result = await generateRecommendations(payload.experimentId);
      emitQuantResearchEvent(QUANT_RESEARCH_EVENT.RECOMMENDATION_GENERATED, result as Record<string, unknown>);
      break;
    case "HYPOTHESIS_GENERATE":
      result = await generateResearchHypotheses(payload.limit);
      break;
    default:
      result = { skipped: true };
  }

  emitQuantResearchEvent(QUANT_RESEARCH_EVENT.RUN_COMPLETED, { type: payload.type, result });
  return result;
}
