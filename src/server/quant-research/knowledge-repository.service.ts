import { prisma } from "@/src/server/db/prisma";
import { persistResearchKnowledge, searchResearchKnowledge } from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";

export async function syncResearchKnowledge(limit = 100) {
  return researchDbOnly(async () => {
    const [genomes, experiments, benchmarks, simulations] = await Promise.all([
      prisma.strategyGenome.findMany({ orderBy: { updatedAt: "desc" }, take: limit }),
      prisma.experiment.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
      prisma.benchmark.findMany({ orderBy: { recordedAt: "desc" }, take: limit }),
      prisma.simulationRun.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
    ]);

    let synced = 0;
    for (const genome of genomes.slice(0, 50)) {
      await persistResearchKnowledge({
        category: "STRATEGY",
        title: genome.name,
        content: JSON.stringify({ indicators: genome.indicators, parameters: genome.parameters, archetype: genome.archetype }),
        tags: ["strategy", genome.archetype, `gen${genome.generation}`],
        refType: "StrategyGenome",
        refId: genome.id,
      }).catch(() => null);
      synced += 1;
    }
    for (const exp of experiments.slice(0, 30)) {
      await persistResearchKnowledge({
        category: "EXPERIMENT",
        title: exp.name,
        content: exp.hypothesis ?? JSON.stringify(exp.config),
        tags: ["experiment", exp.status],
        refType: "Experiment",
        refId: exp.id,
      }).catch(() => null);
      synced += 1;
    }
    for (const bench of benchmarks.slice(0, 30)) {
      await persistResearchKnowledge({
        category: "BENCHMARK",
        title: `Benchmark ${bench.benchmarkType}`,
        content: JSON.stringify(bench.metrics),
        tags: ["benchmark", bench.benchmarkType],
        refType: "Benchmark",
        refId: bench.id,
      }).catch(() => null);
      synced += 1;
    }
    for (const sim of simulations.slice(0, 30)) {
      await persistResearchKnowledge({
        category: "SIMULATION",
        title: `Simulation ${sim.windowDays}d`,
        content: JSON.stringify(sim.metrics),
        tags: ["simulation", `${sim.windowDays}d`],
        refType: "SimulationRun",
        refId: sim.id,
      }).catch(() => null);
      synced += 1;
    }

    return { synced };
  });
}

export { searchResearchKnowledge };

export async function lookupResearch(refType: string, refId: string) {
  return prisma.quantResearchKnowledge.findMany({
    where: { refType, refId },
    orderBy: { createdAt: "desc" },
  });
}
