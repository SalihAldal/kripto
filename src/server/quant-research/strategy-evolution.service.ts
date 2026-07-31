import { prisma } from "@/src/server/db/prisma";
import { persistStrategyEvolution, persistStrategyGenome } from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { computePerformanceMetrics, scoreMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { fetchHistoricalReturns } from "@/src/server/quant-research/backtesting-engine.service";
import { buildGenomeSpec } from "@/src/server/quant-research/strategy-generator.service";

export async function evolveStrategies(input?: { generation?: number; survivors?: number }) {
  return researchDbOnly(async () => {
    const generation = input?.generation ?? (await getMaxGeneration()) + 1;
    const survivorCount = input?.survivors ?? 5;
    const returns = await fetchHistoricalReturns(90);

    const parents = await prisma.strategyGenome.findMany({
      orderBy: { createdAt: "desc" },
      take: survivorCount * 2,
    });

    if (parents.length === 0) {
      const seed = buildGenomeSpec("MOMENTUM", 0, 1);
      await persistStrategyGenome(seed);
      parents.push(await prisma.strategyGenome.findFirstOrThrow({ where: { genomeKey: seed.genomeKey } }));
    }

    const scored = parents.map((p) => {
      const params = (p.parameters as Record<string, number> | null) ?? {};
      const bias = (params.momentumMin ?? 0.5) * 0.1;
      const metrics = computePerformanceMetrics(returns.map((r) => r + bias));
      return { parent: p, fitness: scoreMetrics(metrics), metrics };
    });
    scored.sort((a, b) => b.fitness - a.fitness);
    const survivors = scored.slice(0, survivorCount);

    const offspring: Array<{ genomeKey: string; fitness: number; survived: boolean }> = [];
    for (let i = 0; i < survivorCount * 2; i++) {
      const parent = survivors[i % survivors.length]!.parent;
      const mutated = mutateGenome(parent, generation, i);
      await persistStrategyGenome(mutated);
      const metrics = computePerformanceMetrics(returns.map((r) => r * (0.9 + Math.random() * 0.2)));
      const fitness = scoreMetrics(metrics);
      const survived = fitness >= (survivors[survivors.length - 1]?.fitness ?? 0);
      await persistStrategyEvolution({
        genomeId: (await prisma.strategyGenome.findUnique({ where: { genomeKey: mutated.genomeKey } }))!.id,
        generation,
        parentGenomeId: parent.id,
        mutationType: i % 2 === 0 ? "CROSSOVER" : "MUTATION",
        fitnessScore: fitness,
        survived,
      });
      offspring.push({ genomeKey: mutated.genomeKey, fitness, survived });
    }

    return { generation, survivors: survivors.length, offspring: offspring.filter((o) => o.survived).length, details: offspring.slice(0, 10) };
  });
}

async function getMaxGeneration() {
  const row = await prisma.strategyGenome.findFirst({ orderBy: { generation: "desc" }, select: { generation: true } });
  return row?.generation ?? 0;
}

function mutateGenome(parent: { archetype: Parameters<typeof buildGenomeSpec>[0]; genomeKey: string; parameters: unknown }, generation: number, index: number) {
  const baseParams = (parent.parameters as Record<string, number> | null) ?? {};
  const mutatedParams: Record<string, number> = {};
  for (const [key, val] of Object.entries(baseParams)) {
    mutatedParams[key] = Number((val * (0.85 + Math.random() * 0.3)).toFixed(3));
  }
  const spec = buildGenomeSpec(parent.archetype, index, generation, parent.genomeKey);
  spec.parameters = { ...spec.parameters, ...mutatedParams };
  spec.genomeKey = `${parent.archetype.toLowerCase()}_g${generation}_mut_${index}_${Date.now()}`;
  return spec;
}
