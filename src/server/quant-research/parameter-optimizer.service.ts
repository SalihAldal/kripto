import { prisma } from "@/src/server/db/prisma";
import { persistStrategyGenome } from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { computePerformanceMetrics, scoreMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { fetchHistoricalReturns } from "@/src/server/quant-research/backtesting-engine.service";

const PARAM_RANGES: Record<string, [number, number, number]> = {
  rsiPeriod: [7, 21, 2],
  emaPeriod: [9, 50, 5],
  atrMult: [1, 3, 0.25],
  macdFast: [8, 16, 2],
  volumeSpike: [1.2, 3, 0.2],
  momentumMin: [0.2, 0.8, 0.1],
  stopLossPct: [0.5, 3, 0.25],
  takeProfitPct: [1, 6, 0.5],
  trailingPct: [0.3, 2, 0.2],
};

export async function optimizeParameters(input?: { genomeId?: string; limit?: number; windowDays?: number }) {
  return researchDbOnly(async () => {
    const genome = input?.genomeId
      ? await prisma.strategyGenome.findUnique({ where: { id: input.genomeId } })
      : await prisma.strategyGenome.findFirst({ orderBy: { createdAt: "desc" } });
    if (!genome) return { optimized: 0 };

    const baseParams = (genome.parameters as Record<string, number> | null) ?? {};
    const returns = await fetchHistoricalReturns(input?.windowDays ?? 90);
    const candidates: Array<{ params: Record<string, number>; score: number; metrics: ReturnType<typeof computePerformanceMetrics> }> = [];

    for (const [key, [min, max, step]] of Object.entries(PARAM_RANGES)) {
      for (let v = min; v <= max; v += step) {
        const params = { ...baseParams, [key]: Number(v.toFixed(2)) };
        const filtered = applyParamFilter(returns, params);
        const metrics = computePerformanceMetrics(filtered);
        candidates.push({ params, score: scoreMetrics(metrics), metrics });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates.slice(0, input?.limit ?? 5);
    const optimizedKey = `${genome.genomeKey}_opt_${Date.now()}`;
    await persistStrategyGenome({
      genomeKey: optimizedKey,
      name: `${genome.name} Optimized`,
      archetype: genome.archetype,
      generation: genome.generation,
      indicators: (genome.indicators as string[]) ?? [],
      parameters: best[0]?.params ?? baseParams,
      rules: (genome.rules as Record<string, unknown>) ?? {},
      parentGenome: genome.genomeKey,
    });

    return { optimized: best.length, best: best[0], candidates: best };
  });
}

function applyParamFilter(returns: number[], params: Record<string, number>) {
  const threshold = (params.momentumMin ?? 0.5) * 100;
  const filtered = returns.filter((r) => Math.abs(r) >= threshold / 100 || r > 0);
  return filtered.length >= 10 ? filtered : returns;
}
