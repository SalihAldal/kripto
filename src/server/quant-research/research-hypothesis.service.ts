import type { StrategyArchetype } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import {
  completeResearchRun,
  createResearchRun,
  ensureDefaultResearchProject,
  persistResearchKnowledge,
} from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";

export type ResearchHypothesis = {
  id: string;
  title: string;
  description: string;
  strategyType: StrategyArchetype;
  featureCombination: string[];
  entryCondition: string;
  exitCondition: string;
  filter: string;
  threshold: Record<string, number>;
  priority: number;
};

export async function generateResearchHypotheses(limit = 10) {
  return researchDbOnly(async () => {
    const project = await ensureDefaultResearchProject();
    const run = await createResearchRun({
      projectId: project.id,
      runType: "HYPOTHESIS_GENERATE",
      metadata: { limit },
    });

    const [topFeatures, topStrategies, recentTrades] = await Promise.all([
      prisma.featureResearch.findMany({ where: { status: "HIGH_VALUE" }, orderBy: { importance: "desc" }, take: 10 }),
      prisma.strategyResearch.findMany({ where: { passedValidation: true }, orderBy: { benchmarkScore: "desc" }, take: 5 }),
      prisma.learningTrade.findMany({
        where: { closedAt: { not: null } },
        orderBy: { closedAt: "desc" },
        take: 200,
        select: { returnPercent: true, marketRegime: true, strategy: true },
      }),
    ]);

    const avgReturn = recentTrades.length > 0
      ? recentTrades.reduce((s, t) => s + Number(t.returnPercent ?? 0), 0) / recentTrades.length
      : 0;

    const hypotheses: ResearchHypothesis[] = [];
    const archetypes: StrategyArchetype[] = ["MOMENTUM", "BREAKOUT", "MEAN_REVERSION", "VWAP", "TREND_FOLLOWING", "HYBRID"];

    for (let i = 0; i < limit; i++) {
      const strategyType = topStrategies[i % topStrategies.length]?.strategyType ?? archetypes[i % archetypes.length]!;
      const features = topFeatures.slice(i, i + 3).map((f) => f.featureKey);
      if (features.length === 0) features.push("RSI", "VOLUME", "VWAP");

      hypotheses.push({
        id: `hyp_${Date.now()}_${i}`,
        title: `${strategyType} + ${features.join("/")} filter`,
        description: `Test ${strategyType} with ${features.join(", ")} under current regime conditions`,
        strategyType,
        featureCombination: features,
        entryCondition: buildEntryCondition(strategyType, features),
        exitCondition: buildExitCondition(strategyType),
        filter: `min_volume_spike=${1.2 + i * 0.1}, regime_filter=true`,
        threshold: {
          rsi: 45 + i * 2,
          volumeMult: 1.5 + i * 0.05,
          adxMin: 20 + i,
          expectedImprovement: Number((avgReturn * 0.1 + i * 0.05).toFixed(3)),
        },
        priority: limit - i,
      });
    }

    await persistResearchKnowledge({
      category: "HYPOTHESIS",
      title: `Generated ${hypotheses.length} research hypotheses`,
      content: JSON.stringify(hypotheses),
      tags: ["hypothesis", "auto-generated"],
      refType: "ResearchRun",
      refId: run.id,
    });

    await completeResearchRun(run.id, `Generated ${hypotheses.length} hypotheses`);
    return { runId: run.id, hypotheses };
  });
}

function buildEntryCondition(archetype: StrategyArchetype, features: string[]): string {
  const feat = features[0] ?? "RSI";
  switch (archetype) {
    case "MOMENTUM":
      return `${feat} > threshold AND volume > avg * 1.5`;
    case "BREAKOUT":
      return `price > range_high AND ${feat} confirms`;
    case "MEAN_REVERSION":
      return `${feat} oversold AND price < vwap`;
    case "VWAP":
      return `price crosses vwap AND ${feat} aligned`;
    default:
      return `${feat} signal AND trend aligned`;
  }
}

function buildExitCondition(archetype: StrategyArchetype): string {
  switch (archetype) {
    case "MOMENTUM":
      return "trailing_stop 1.5 ATR OR momentum fade";
    case "MEAN_REVERSION":
      return "target vwap OR stop 1 ATR";
    default:
      return "target 2R OR stop 1R";
  }
}
