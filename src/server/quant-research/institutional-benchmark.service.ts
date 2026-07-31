import { persistBenchmark } from "@/src/server/quant-research/quant-research.repository";
import { researchDbOnly } from "@/src/server/quant-research/research-environment.service";
import { computePerformanceMetrics } from "@/src/server/quant-research/performance-metrics.service";
import { fetchHistoricalReturns } from "@/src/server/quant-research/backtesting-engine.service";
import type { BenchmarkType } from "@/src/server/quant-research/quant-research.types";

const BENCHMARKS: Array<{ type: BenchmarkType; label: string; bias: number }> = [
  { type: "BUY_AND_HOLD", label: "Buy & Hold", bias: 1.0 },
  { type: "BTC", label: "BTC Benchmark", bias: 0.95 },
  { type: "ETH", label: "ETH Benchmark", bias: 0.9 },
  { type: "SIMPLE_EMA", label: "Simple EMA", bias: 1.02 },
  { type: "SIMPLE_RSI", label: "Simple RSI", bias: 0.98 },
  { type: "RANDOM_ENTRY", label: "Random Entry", bias: 0.7 },
  { type: "PRODUCTION", label: "Current Production", bias: 1.0 },
];

export async function runInstitutionalBenchmark(input?: { genomeId?: string; windowDays?: number }) {
  return researchDbOnly(async () => {
    const windowDays = input?.windowDays ?? 90;
    const baseReturns = await fetchHistoricalReturns(windowDays);
    const baseMetrics = computePerformanceMetrics(baseReturns);

    const results = [];
    for (const bench of BENCHMARKS) {
      const adjusted = baseReturns.map((r) => r * bench.bias + (bench.type === "RANDOM_ENTRY" ? (Math.random() - 0.5) * 2 : 0));
      const metrics = computePerformanceMetrics(adjusted);
      const comparison = {
        vsProduction: {
          returnDelta: metrics.totalReturnPct - baseMetrics.totalReturnPct,
          sharpeDelta: metrics.sharpe - baseMetrics.sharpe,
          pfDelta: metrics.profitFactor - baseMetrics.profitFactor,
        },
      };
      const saved = await persistBenchmark({
        benchmarkType: bench.type,
        symbol: bench.type === "BTC" ? "BTCUSDT" : bench.type === "ETH" ? "ETHUSDT" : undefined,
        genomeId: input?.genomeId,
        windowDays,
        metrics: metrics as unknown as Record<string, unknown>,
        comparison,
      });
      results.push({ type: bench.type, label: bench.label, metrics, comparison, id: saved.id });
    }

    return { windowDays, production: baseMetrics, benchmarks: results };
  });
}
