import { executionSignalMetadata } from "./execution-signal-metadata.service";
import type { ScannerCandidate } from "@/src/types/scanner";
import { resolvePaperExecutionSymbol } from "./paper-execution-symbol.service";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import { formatAIRequest } from "@/src/server/scanner/ai-request-formatter";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";
import { executionSnapshotIssues, loadExecutionMarketSnapshot } from "./execution-market-snapshot.service";

/** Source identity is checked by the orchestrator; execution data and AI share one actual venue snapshot. */
export async function preparePaperExecutionContext(candidate: ScannerCandidate, quoteBudget?: number): Promise<
  { ok: true; candidate: ScannerCandidate } | { ok: false; reason: string; details?: Record<string, unknown> }
> {
  const controller = new AbortController();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("EXECUTION_PREPARATION_TIMEOUT"));
    }, 45_000);
  });
  const prepare = async () => {
    const resolution = await resolvePaperExecutionSymbol(candidate.context.symbol);
    if (!resolution.resolved) return { ok: false as const, reason: `SYMBOL_FILTER:${resolution.reasonCode}` };
    controller.signal.throwIfAborted();
    const snapshot = await loadExecutionMarketSnapshot(resolution.executionSymbol, controller.signal);
    const issues = executionSnapshotIssues(snapshot);
    if (issues.length) return { ok: false as const, reason: `MARKET_DATA:${issues[0]}`, details: { issues, executionSymbol: resolution.executionSymbol } };
    const source = candidate.context;
    const context = await buildMarketContext(resolution.executionSymbol, {
      forceLive: true, priority: "high", executionBundle: snapshot.bundle, allowBackgroundIntelCapture: false,
    });
    controller.signal.throwIfAborted();
    if (context.symbol !== resolution.executionSymbol || !Number.isFinite(context.lastPrice) || context.lastPrice <= 0 ||
        context.metadata.liveDataHealthy !== true || context.metadata.dataQualityOk === false) {
      return { ok: false as const, reason: "MARKET_DATA:EXECUTION_CONTEXT_UNAVAILABLE", details: {
        executionSymbol: resolution.executionSymbol, liveDataHealthy: context.metadata.liveDataHealthy,
        dataQualityOk: context.metadata.dataQualityOk, issues: context.metadata.dataQualityIssues,
        rejectReasons: context.rejectReasons, marketDataCode: context.metadata.marketDataCode,
      } };
    }
    context.metadata = {
      ...context.metadata, ...executionSignalMetadata(source, snapshot, quoteBudget, context), opportunityCandidateId: source.metadata.opportunityCandidateId,
      canonicalHandoff: source.metadata.canonicalHandoff, signalSymbol: source.symbol,
      executionSymbol: context.symbol, executionContextRebuilt: true,
      venue: snapshot.venue, exchangeVenue: snapshot.venue, executionSnapshotAt: snapshot.fetchedAt,
      executionTimeframeCounts: Object.fromEntries(Object.entries(snapshot.timeframes).map(([tf, rows]) => [tf, rows.length])),
    };
    const score = scoreContext(context);
    const runtime = await getRuntimeStrategyParams();
    controller.signal.throwIfAborted();
    const aiInput = await formatAIRequest(context, { ...runtime, scannerScore: score.score, executionMode: "paper" }, undefined, snapshot);
    controller.signal.throwIfAborted();
    const ai = await runAIConsensusFromInput(aiInput, { signal: controller.signal });
    controller.signal.throwIfAborted();
    context.metadata.executionPreparationMs = Date.now() - startedAt;
    return { ok: true as const, candidate: { rank: candidate.rank, context, score, ai } };
  };
  try { return await Promise.race([prepare(), deadline]); }
  catch (error) {
    return { ok: false, reason: controller.signal.aborted ? "MARKET_DATA:EXECUTION_PREPARATION_TIMEOUT" : "MARKET_DATA:EXECUTION_PREPARATION_FAILED",
      details: { errorClass: error instanceof Error ? error.name : "Unknown", elapsedMs: Date.now() - startedAt } };
  } finally { if (timer) clearTimeout(timer); }
}
