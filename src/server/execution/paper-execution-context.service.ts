import type { ScannerCandidate } from "@/src/types/scanner";
import { resolvePaperExecutionSymbol } from "./paper-execution-symbol.service";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import { formatAIRequest } from "@/src/server/scanner/ai-request-formatter";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";

/** A quote change needs new prices, book, quantity inputs and absolute AI targets. */
export async function preparePaperExecutionContext(candidate: ScannerCandidate): Promise<
  { ok: true; candidate: ScannerCandidate } | { ok: false; reason: string }
> {
  const resolution = await resolvePaperExecutionSymbol(candidate.context.symbol);
  if (!resolution.resolved) return { ok: false, reason: `SYMBOL_FILTER:${resolution.reasonCode}` };
  if (resolution.executionSymbol === candidate.context.symbol) return { ok: true, candidate };
  const source = candidate.context;
  const context = await buildMarketContext(resolution.executionSymbol, { forceLive: true, priority: "high" });
  if (context.symbol !== resolution.executionSymbol || !Number.isFinite(context.lastPrice) || context.lastPrice <= 0 ||
      context.metadata.liveDataHealthy !== true || context.metadata.dataQualityOk === false) {
    return { ok: false, reason: "MARKET_DATA:EXECUTION_CONTEXT_UNAVAILABLE" };
  }
  // Keep provenance, never copy USDT prices, levels, book or targets into TRY context.
  context.metadata = {
    ...context.metadata,
    opportunityCandidateId: source.metadata.opportunityCandidateId,
    canonicalHandoff: source.metadata.canonicalHandoff,
    signalSymbol: source.symbol,
    executionSymbol: context.symbol,
    executionContextRebuilt: true,
  };
  const score = scoreContext(context);
  const runtime = await getRuntimeStrategyParams();
  const aiInput = await formatAIRequest(context, { ...runtime, scannerScore: score.score, executionMode: "paper" });
  const ai = await runAIConsensusFromInput(aiInput);
  return { ok: true, candidate: { rank: candidate.rank, context, score, ai } };
}
