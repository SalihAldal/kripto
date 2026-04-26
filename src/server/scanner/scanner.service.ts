import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import { rankCandidates } from "@/src/server/scanner/candidate-ranking.service";
import { formatAIRequest } from "@/src/server/scanner/ai-request-formatter";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import { persistCandidateSignal } from "@/src/server/scanner/signal-persistence.service";
import { resolveWatchlist } from "@/src/server/scanner/watchlist.service";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";
import type { ScannerApiRow, ScannerPipelineResult } from "@/src/types/scanner";

type ScanCursorState = {
  value: number;
};

function getScanCursorState(): ScanCursorState {
  const globalRef = globalThis as typeof globalThis & { __kineticScanCursorState?: ScanCursorState };
  if (!globalRef.__kineticScanCursorState) {
    globalRef.__kineticScanCursorState = { value: 0 };
  }
  return globalRef.__kineticScanCursorState;
}

function getPreferredSymbols() {
  return env.SCANNER_WATCHLIST.split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 12);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = Math.max(1, Math.min(concurrency, items.length || 1));
  const results: R[] = new Array(items.length);
  let next = 0;

  const runners = Array.from({ length: size }).map(async () => {
    while (true) {
      const idx = next;
      next += 1;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function runScannerPipeline(
  userId?: string,
  options?: { includeAi?: boolean; persistRejected?: boolean; persist?: boolean },
): Promise<ScannerPipelineResult> {
  markHeartbeat({ service: "scanner", status: "UP", message: "Scanner cycle started" });
  const includeAi = options?.includeAi ?? true;
  const persistRejected = options?.persistRejected ?? true;
  const persist = options?.persist ?? true;
  const runtimeStrategy = await getRuntimeStrategyParams();
  const watchlist = await resolveWatchlist(userId);

  // Scan all symbols sequentially in fixed-size batches (e.g. 50 by 50).
  const cycleLimit = Math.max(1, Math.min(env.SCANNER_CYCLE_SYMBOL_LIMIT, watchlist.length));
  const baseUniverse = watchlist;
  const cursorState = getScanCursorState();
  const cursor = Math.max(0, cursorState.value % Math.max(baseUniverse.length, 1));
  const cycleSymbols =
    baseUniverse.length <= cycleLimit
      ? baseUniverse
      : Array.from({ length: cycleLimit }).map((_, idx) => baseUniverse[(cursor + idx) % baseUniverse.length]);
  cursorState.value = (cursor + cycleLimit) % Math.max(watchlist.length, 1);

  const contexts = await mapWithConcurrency(
    cycleSymbols,
    env.SCANNER_CONTEXT_CONCURRENCY,
    async (symbol) => {
      try {
        const context = await buildMarketContext(symbol);
        const score = scoreContext(context);
        return { context, score };
      } catch (error) {
        logger.warn({ symbol, error: (error as Error).message }, "Scanner context failed");
        return null;
      }
    },
  );

  const validRows = contexts.filter((x): x is NonNullable<typeof x> => Boolean(x));
  const healthyRows = validRows.filter((row) => !row.context.rejectReasons.includes("Market data degraded"));
  let qualified = validRows.filter((row) => row.score.status === "QUALIFIED");
  // If strict filters eliminate all symbols, keep the best liquid tradable rows
  // so fast-entry can still evaluate candidates instead of ending with 0/0.
  if (qualified.length === 0) {
    const relaxed = healthyRows
      .filter((row) => row.context.tradable)
      .sort((a, b) => b.score.score - a.score.score)
      .slice(0, Math.max(10, Math.min(env.SCANNER_TOP_CANDIDATES, healthyRows.length)));
    qualified = relaxed;
  }
  if (qualified.length === 0 && validRows.length > 0) {
    // Never return an empty AI scope when market data exists.
    // Keep strongest rows so AI can still evaluate and execution can decide.
    const fallbackPool = healthyRows.length > 0 ? healthyRows : validRows;
    qualified = [...fallbackPool]
      .sort((a, b) => b.score.score - a.score.score)
      .slice(0, Math.max(1, Math.min(env.SCANNER_TOP_CANDIDATES, fallbackPool.length)));
    pushLog(
      "WARN",
      `Scanner qualify fallback aktif. strict=0, forced=${qualified.length}`,
    );
  }
  // Network/cooldown resilience:
  // If the broad universe yields 0 qualified rows, force a compact re-check on preferred watchlist
  // so fast-entry can still attempt AI on core symbols.
  if (qualified.length === 0) {
    const preferred = getPreferredSymbols();
    const existing = new Set(validRows.map((x) => x.context.symbol));
    const fallbackSymbols = preferred.filter((symbol) => !existing.has(symbol)).slice(0, 6);
    if (fallbackSymbols.length > 0) {
      const fallbackRows = await mapWithConcurrency(
        fallbackSymbols,
        Math.max(1, Math.min(env.SCANNER_CONTEXT_CONCURRENCY, 4)),
        async (symbol) => {
          try {
            const context = await buildMarketContext(symbol);
            const score = scoreContext(context);
            return { context, score };
          } catch {
            return null;
          }
        },
      );
      const fallbackValid = fallbackRows.filter((x): x is NonNullable<typeof x> => Boolean(x));
      const resilientTradable = fallbackValid
        .filter((row) => row.context.tradable && row.context.volume24h > 0)
        .sort((a, b) => b.score.score - a.score.score)
        .slice(0, Math.max(1, Math.min(6, fallbackValid.length)));
      if (resilientTradable.length > 0) {
        qualified = resilientTradable;
        pushLog(
          "WARN",
          `Scanner resilience fallback aktif. preferred=${fallbackSymbols.length}, recovered=${resilientTradable.length}`,
        );
      }
    }
  }
  const rankingBaseRows = healthyRows.length > 0 ? healthyRows : validRows;
  const rankedAll = rankCandidates(rankingBaseRows, rankingBaseRows.length);
  const configuredTop = Math.max(1, Math.min(env.SCANNER_TOP_CANDIDATES, rankedAll.length));
  const fullCycleTarget = Math.max(1, Math.min(cycleSymbols.length, rankedAll.length));
  const aiScope = env.SCANNER_AI_EVALUATE_ALL
    ? rankedAll.slice(0, fullCycleTarget)
    : rankedAll.slice(0, configuredTop);
  const topCandidates = rankedAll.slice(0, configuredTop);

  let aiEvaluated = 0;
  if (includeAi) {
    await mapWithConcurrency(aiScope, env.SCANNER_AI_CONCURRENCY, async (candidate) => {
      try {
        const aiInput = await formatAIRequest(
          candidate.context,
          {
            scannerScore: candidate.score.score,
            ...runtimeStrategy,
          },
          undefined,
        );
        const ai = await runAIConsensusFromInput(aiInput);
        candidate.ai = ai;
        if (persist) await persistCandidateSignal(candidate, ai, userId);
      } catch (error) {
        logger.warn(
          { symbol: candidate.context.symbol, error: (error as Error).message },
          "AI evaluation skipped for candidate",
        );
        if (persist) await persistCandidateSignal(candidate, undefined, userId);
      } finally {
        aiEvaluated += 1;
      }
    });
  } else if (persist) {
    await mapWithConcurrency(aiScope, env.SCANNER_AI_CONCURRENCY, async (candidate) => {
      await persistCandidateSignal(candidate, undefined, userId);
    });
  }

  if (persist && persistRejected) {
    for (const rejected of validRows.filter((row) => row.score.status === "REJECTED").slice(0, 30)) {
      await persistCandidateSignal(
        {
          rank: 0,
          context: rejected.context,
          score: rejected.score,
        },
        undefined,
        userId,
      );
    }
  }

  const result: ScannerPipelineResult = {
    scannedAt: new Date().toISOString(),
    totalSymbols: cycleSymbols.length,
    qualifiedSymbols: qualified.length,
    aiEvaluatedSymbols: aiEvaluated,
    candidates: topCandidates,
  };

  pushLog(
    "INFO",
    `Scanner tamamlandi. scanned=${result.totalSymbols}, universeTotal=${watchlist.length}, qualified=${result.qualifiedSymbols}, ai=${result.aiEvaluatedSymbols}, universe=${env.SCANNER_UNIVERSE}, cursor=${cursorState.value}`,
  );
  markHeartbeat({
    service: "scanner",
    status: "UP",
    message: "Scanner cycle completed",
    details: {
      total: result.totalSymbols,
      qualified: result.qualifiedSymbols,
      aiEvaluated: result.aiEvaluatedSymbols,
    },
  });

  return result;
}

export function toScannerApiRows(result: ScannerPipelineResult): ScannerApiRow[] {
  return result.candidates.map((candidate) => ({
    symbol: candidate.context.symbol,
    price: candidate.context.lastPrice,
    change24h: candidate.context.change24h,
    volume24h: candidate.context.volume24h,
    aiScore: Number((candidate.ai?.finalConfidence ?? candidate.score.confidence).toFixed(2)),
    scannerScore: candidate.score.score,
    spreadPercent: candidate.context.spreadPercent,
    volatilityPercent: candidate.context.volatilityPercent,
    decision: candidate.ai?.finalDecision ?? "HOLD",
    marketRegime: String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS"),
    marketRegimeStrategy: String(candidate.context.metadata.marketRegimeStrategy ?? "RANGE_MEAN_REVERSION"),
  }));
}
