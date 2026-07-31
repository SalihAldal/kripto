import { runStrategySelection } from "@/src/server/strategy-selector/strategy-selector.pipeline.service";
import { detectMarketRegime } from "@/src/server/strategy-selector/regime-detection.service";
import { classifyCoin } from "@/src/server/strategy-selector/coin-classification.service";
import { scoreAllStrategies } from "@/src/server/strategy-selector/strategy-scoring.service";
import { validateStrategySelection } from "@/src/server/strategy-selector/selection-validation.service";
import { replayRecentSelections, replayStrategySelection } from "@/src/server/strategy-selector/strategy-replay.service";
import { generateStrategyBenchmark } from "@/src/server/strategy-selector/strategy-benchmark.service";
import { learnStrategyPerformance } from "@/src/server/strategy-selector/strategy-learning.service";
import { checkStrategySwitch, scanStrategySwitches } from "@/src/server/strategy-selector/strategy-switching.service";
import { syncStrategyPerformance, updateStrategyKnowledgeBase } from "@/src/server/strategy-selector/strategy-knowledge.service";
import { prisma } from "@/src/server/db/prisma";
import type { StrategySelectorJobPayload } from "@/src/server/strategy-selector/strategy-selector.types";

export async function runStrategySelectorJob(payload: StrategySelectorJobPayload) {
  switch (payload.type) {
    case "DETECT_REGIME":
      return detectMarketRegime(payload.symbol);
    case "CLASSIFY_COIN":
      return classifyCoin(payload.symbol);
    case "SCORE_STRATEGIES": {
      const regime = payload.regimeId
        ? await prisma.adaptiveMarketRegime.findUnique({ where: { id: payload.regimeId } })
        : await detectMarketRegime(payload.symbol);
      const coinClass = await classifyCoin(payload.symbol);
      const regimeResult = regime
        ? { regimeLabel: regime.regimeLabel, regimeConfidence: regime.regimeConfidence, bullScore: regime.bullScore ?? 0, bearScore: regime.bearScore ?? 0, rangeScore: regime.rangeScore ?? 0, volatilityScore: regime.volatilityScore ?? 0, newsScore: regime.newsScore ?? 0, whaleScore: regime.whaleScore ?? 0, evidence: (regime.evidence ?? {}) as Record<string, unknown> }
        : await detectMarketRegime(payload.symbol);
      const regimeForScore = "id" in regimeResult
        ? { regimeLabel: regimeResult.regimeLabel, regimeConfidence: regimeResult.regimeConfidence, bullScore: regimeResult.bullScore, bearScore: regimeResult.bearScore, rangeScore: regimeResult.rangeScore, volatilityScore: regimeResult.volatilityScore, newsScore: regimeResult.newsScore, whaleScore: regimeResult.whaleScore, evidence: regimeResult.evidence }
        : regimeResult;
      return scoreAllStrategies(payload.symbol, regimeForScore, coinClass);
    }
    case "SELECT_STRATEGY":
      return runStrategySelection(payload.symbol);
    case "VALIDATE_SELECTION": {
      if (!payload.selectionId) return { skipped: true };
      const sel = await prisma.adaptiveStrategySelection.findUnique({ where: { id: payload.selectionId }, include: { regime: true } });
      if (!sel || !sel.regime) return { skipped: true };
      const rankings = (sel.rankings ?? []) as Array<{ strategyType: string; confidence: number; historicalAccuracy: number; marketCompatibility: number }>;
      const primary = rankings[0];
      if (!primary) return { skipped: true };
      return validateStrategySelection(
        { regimeLabel: sel.regime.regimeLabel, regimeConfidence: sel.regime.regimeConfidence, bullScore: sel.regime.bullScore ?? 0, bearScore: sel.regime.bearScore ?? 0, rangeScore: sel.regime.rangeScore ?? 0, volatilityScore: sel.regime.volatilityScore ?? 0, newsScore: sel.regime.newsScore ?? 0, whaleScore: sel.regime.whaleScore ?? 0, evidence: {} },
        primary as never,
        60_000,
      );
    }
    case "REPLAY_STRATEGY":
      if (payload.symbol) {
        const sel = await prisma.adaptiveStrategySelection.findFirst({ where: { symbol: payload.symbol.toUpperCase() }, orderBy: { selectedAt: "desc" } });
        if (!sel) return { skipped: true };
        return replayStrategySelection(sel.id);
      }
      return replayRecentSelections(payload.limit ?? 10);
    case "BENCHMARK_STRATEGIES":
      return generateStrategyBenchmark();
    case "LEARN_STRATEGIES":
      return learnStrategyPerformance();
    case "SWITCH_CHECK":
      if (payload.symbol) return checkStrategySwitch(payload.symbol);
      return scanStrategySwitches();
    case "UPDATE_KNOWLEDGE":
      return updateStrategyKnowledgeBase();
    case "PERFORMANCE_SYNC":
      return syncStrategyPerformance();
    default:
      return { skipped: true };
  }
}
