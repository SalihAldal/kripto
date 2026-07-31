import type { CounterfactualScenario, StrategyArchetype } from "@prisma/client";
import { env } from "@/lib/config";
import {
  completeResearchRun,
  createResearchRun,
  ensureDefaultResearchProject,
  persistCounterfactualResults,
} from "@/src/server/quant-research/quant-research.repository";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { fetchCompletedTradesForCounterfactual, type ReplayTradeContext } from "@/src/server/quant-research/replay-bridge.service";

const ALL_SCENARIOS: CounterfactualScenario[] = [
  "ENTER_EARLIER",
  "ENTER_LATER",
  "EXIT_EARLIER",
  "EXIT_LATER",
  "ALT_STRATEGY",
  "IGNORE_TRADE",
  "DOUBLE_HOLD",
  "HALF_HOLD",
];

type ScenarioOutcome = {
  scenario: CounterfactualScenario;
  alternativeReturnPct: number;
  alternativeDrawdownPct: number;
  alternativeWinRate: number;
  alternativeRR: number;
  alternativeHoldSec: number;
  evidence: Record<string, unknown>;
};

export async function runCounterfactualAnalysis(input?: {
  experimentId?: string;
  limit?: number;
  windowDays?: number;
}) {
  return researchDbOnly(async () => {
    const project = await ensureDefaultResearchProject();
    const limit = input?.limit ?? env.QUANT_RESEARCH_COUNTERFACTUAL_LIMIT;

    const run = await createResearchRun({
      projectId: project.id,
      runType: "COUNTERFACTUAL_ANALYZE",
      windowDays: input?.windowDays ?? 90,
      metadata: { experimentId: input?.experimentId, limit },
    });

    const trades = await fetchCompletedTradesForCounterfactual({ limit, windowDays: input?.windowDays });
    if (trades.length === 0) {
      await completeResearchRun(run.id, "No completed trades for counterfactual analysis");
      return { runId: run.id, analyzed: 0, results: [] };
    }

    const persisted: Array<{
      tradeId: string;
      learningTradeId: string;
      decisionId: string | null;
      scenario: CounterfactualScenario;
      baselineReturnPct: number;
      alternativeReturnPct: number;
      alternativeDrawdownPct: number;
      alternativeWinRate: number;
      alternativeRR: number;
      alternativeHoldSec: number;
      metrics: Record<string, unknown>;
      evidence: Record<string, unknown>;
    }> = [];

    for (const trade of trades) {
      const scenarios = computeScenariosForTrade(trade);
      for (const outcome of scenarios) {
        persisted.push({
          tradeId: trade.tradeId,
          learningTradeId: trade.learningTradeId,
          decisionId: trade.decisionId,
          scenario: outcome.scenario,
          baselineReturnPct: trade.baselineReturnPct,
          alternativeReturnPct: outcome.alternativeReturnPct,
          alternativeDrawdownPct: outcome.alternativeDrawdownPct,
          alternativeWinRate: outcome.alternativeWinRate,
          alternativeRR: outcome.alternativeRR,
          alternativeHoldSec: outcome.alternativeHoldSec,
          metrics: {
            symbol: trade.symbol,
            baselineHoldSec: trade.baselineHoldSec,
          },
          evidence: outcome.evidence,
        });
      }
    }

    const rows = await persistCounterfactualResults(input?.experimentId, persisted);

    const altReturns = persisted.map((p) => p.alternativeReturnPct);
    const summary = computePerformanceMetrics(altReturns);
    await completeResearchRun(run.id, `Counterfactual: ${trades.length} trades, ${rows.length} scenarios`);

    return {
      runId: run.id,
      analyzed: trades.length,
      scenarioCount: rows.length,
      summary,
      results: rows.slice(0, 50),
    };
  });
}

function computeScenariosForTrade(trade: ReplayTradeContext): ScenarioOutcome[] {
  const baseline = trade.baselineReturnPct;
  const hold = trade.baselineHoldSec;
  const eval_ = trade.evaluation;
  const outcomes = trade.outcomes;

  const earlyHorizon = outcomes.find((o) => o.horizonMs <= 15 * 60 * 1000) ?? outcomes[0];
  const lateHorizon = outcomes.find((o) => o.horizonMs >= 4 * 60 * 60 * 1000) ?? outcomes[outcomes.length - 1];
  const shortExit = outcomes.find((o) => o.horizonMs <= 30 * 60 * 1000);
  const longExit = outcomes[outcomes.length - 1];

  return ALL_SCENARIOS.map((scenario) => {
    switch (scenario) {
      case "ENTER_EARLIER": {
        const alt = earlyHorizon ? earlyHorizon.returnPct : baseline * 1.08;
        const dd = earlyHorizon ? Math.abs(earlyHorizon.maePct) : Math.abs(baseline) * 0.5;
        return buildOutcome(scenario, alt, dd, hold * 0.7, { horizon: earlyHorizon?.horizonLabel });
      }
      case "ENTER_LATER": {
        const alt = lateHorizon ? lateHorizon.returnPct * 0.92 : baseline * 0.88;
        const dd = lateHorizon ? Math.abs(lateHorizon.maePct) : Math.abs(baseline) * 0.6;
        return buildOutcome(scenario, alt, dd, hold * 1.2, { horizon: lateHorizon?.horizonLabel });
      }
      case "EXIT_EARLIER": {
        const alt = shortExit ? shortExit.returnPct : baseline * 0.75;
        const dd = shortExit ? Math.abs(shortExit.maePct) : Math.abs(eval_?.maePct ?? baseline * 0.3);
        return buildOutcome(scenario, alt, dd, hold * 0.5, { horizon: shortExit?.horizonLabel });
      }
      case "EXIT_LATER": {
        const alt = longExit ? longExit.returnPct : baseline * 1.15;
        const dd = longExit ? Math.abs(longExit.maePct) : Math.abs(eval_?.maxDrawdownPct ?? baseline * 0.4);
        return buildOutcome(scenario, alt, dd, hold * 1.5, { horizon: longExit?.horizonLabel });
      }
      case "ALT_STRATEGY": {
        const alt = baseline * (0.85 + Math.random() * 0.3);
        return buildOutcome(scenario, alt, Math.abs(alt) * 0.35, hold, { strategyShift: "MOMENTUM" });
      }
      case "IGNORE_TRADE":
        return buildOutcome(scenario, 0, 0, 0, { skipped: true });
      case "DOUBLE_HOLD": {
        const alt = eval_?.peakProfitPct != null ? Math.min(eval_.peakProfitPct, baseline * 1.4) : baseline * 1.1;
        const dd = eval_?.maxDrawdownPct != null ? Math.abs(eval_.maxDrawdownPct) * 1.3 : Math.abs(baseline) * 0.5;
        return buildOutcome(scenario, alt, dd, hold * 2, { holdMultiplier: 2 });
      }
      case "HALF_HOLD": {
        const alt = baseline * 0.55;
        const dd = eval_?.maePct != null ? Math.abs(eval_.maePct) * 0.6 : Math.abs(baseline) * 0.25;
        return buildOutcome(scenario, alt, dd, Math.floor(hold * 0.5), { holdMultiplier: 0.5 });
      }
      default:
        return buildOutcome(scenario, baseline, 0, hold, {});
    }
  });
}

function buildOutcome(
  scenario: CounterfactualScenario,
  alternativeReturnPct: number,
  alternativeDrawdownPct: number,
  alternativeHoldSec: number,
  evidence: Record<string, unknown>,
): ScenarioOutcome {
  const win = alternativeReturnPct > 0 ? 100 : 0;
  const rr = alternativeDrawdownPct > 0 ? alternativeReturnPct / alternativeDrawdownPct : alternativeReturnPct;
  return {
    scenario,
    alternativeReturnPct: Number(alternativeReturnPct.toFixed(4)),
    alternativeDrawdownPct: Number(alternativeDrawdownPct.toFixed(4)),
    alternativeWinRate: win,
    alternativeRR: Number(rr.toFixed(4)),
    alternativeHoldSec: Math.max(0, Math.floor(alternativeHoldSec)),
    evidence,
  };
}

export async function getCounterfactualSummary(experimentId?: string) {
  return researchDbOnly(async () => {
    const { prisma } = await import("@/src/server/db/prisma");
    const where = experimentId ? { experimentId } : {};
    const rows = await prisma.counterfactualResult.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 500,
    });

    const byScenario = new Map<CounterfactualScenario, number[]>();
    for (const row of rows) {
      const bucket = byScenario.get(row.scenario) ?? [];
      bucket.push(Number(row.alternativeReturnPct ?? 0));
      byScenario.set(row.scenario, bucket);
    }

    return [...byScenario.entries()].map(([scenario, returns]) => ({
      scenario,
      count: returns.length,
      metrics: computePerformanceMetrics(returns),
    }));
  });
}

export const RESEARCH_STRATEGY_TYPES: StrategyArchetype[] = [
  "MOMENTUM",
  "BREAKOUT",
  "TREND_FOLLOWING",
  "MEAN_REVERSION",
  "VWAP",
  "VOLUME_PROFILE",
  "LIQUIDITY_SWEEP",
  "HYBRID",
];
