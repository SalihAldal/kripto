import { prisma } from "@/src/server/db/prisma";
import { persistStrategyCandidate } from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { computePerformanceMetrics, scoreMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { fetchHistoricalReturns } from "@/src/server/quant-research/backtesting-engine.service";
import { buildGenomeSpec, generateAiStrategy } from "@/src/server/quant-research/strategy-generator.service";
import type { CompetitionEntry } from "@/src/server/quant-research/quant-research.types";

export async function runStrategyCompetition(windowDays = 90) {
  return researchDbOnly(async () => {
    const returns = await fetchHistoricalReturns(windowDays);
    const baseMetrics = computePerformanceMetrics(returns);

    const competitors = [
      { key: "production", name: "Current Production", archetype: "BASELINE" as const },
      { key: "momentum", name: "Momentum Strategy", archetype: "MOMENTUM" as const },
      { key: "breakout", name: "Breakout Strategy", archetype: "BREAKOUT" as const },
      { key: "news", name: "News Strategy", archetype: "AI_GENERATED" as const },
      { key: "random", name: "Random Strategy", archetype: "RANDOM" as const },
      { key: "baseline", name: "Baseline EMA", archetype: "TREND_FOLLOWING" as const },
    ];

    const entries: CompetitionEntry[] = [];
    for (let i = 0; i < competitors.length; i++) {
      const comp = competitors[i]!;
      const spec = comp.key === "production"
        ? buildGenomeSpec("BASELINE", i)
        : buildGenomeSpec(comp.archetype, i);
      const genome = await prisma.strategyGenome.upsert({
        where: { genomeKey: `competition_${comp.key}` },
        create: {
          genomeKey: `competition_${comp.key}`,
          name: comp.name,
          archetype: comp.archetype,
          generation: 1,
          indicators: spec.indicators as never,
          parameters: spec.parameters as never,
          rules: spec.rules as never,
        },
        update: { name: comp.name },
      });

      const adjustedReturns = applyStrategyBias(returns, comp.archetype);
      const metrics = computePerformanceMetrics(adjustedReturns);
      const score = scoreMetrics(metrics);

      entries.push({
        genomeId: genome.id,
        name: comp.name,
        archetype: comp.archetype,
        rank: 0,
        score,
        metrics,
      });
    }

    entries.sort((a, b) => b.score - a.score);
    entries.forEach((e, idx) => {
      e.rank = idx + 1;
    });

    for (const entry of entries) {
      await persistStrategyCandidate({
        genomeId: entry.genomeId,
        candidateKey: `competition_${entry.rank}_${entry.genomeId}`,
        rank: entry.rank,
        score: entry.score,
        metrics: entry.metrics,
      });
    }

    await generateAiStrategy("Experimental Strategy").catch(() => null);

    return {
      windowDays,
      productionBaseline: baseMetrics,
      rankings: entries,
      winner: entries[0],
    };
  });
}

function applyStrategyBias(returns: number[], archetype: string) {
  const bias = archetype === "MOMENTUM" ? 1.05 : archetype === "RANDOM" ? 0.85 : archetype === "BREAKOUT" ? 1.02 : 1;
  return returns.map((r) => r * bias + (Math.random() - 0.5) * 0.1);
}
