import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import {
  beginDecisionTrace,
  createDecisionId,
  finalizeDecisionLog,
  observeScannerDecision,
} from "@/src/server/observability/decision-observability.service";
import { runWithDecisionTrace } from "@/src/server/observability/decision-trace-context";
import {
  discoveryProfilesToCandidateRank,
  runDiscoveryBatch,
} from "@/src/server/discovery/discovery-pipeline.engine";
import { getDiscoveryV2TopSymbolSet } from "@/src/server/trading-core-s2/discovery-v2.engine.service";
import { getCachedDiscoveryScore } from "@/src/server/trading-core-s2/trading-core-s2.cache";
import { filterHealthyOnly } from "@/src/server/discovery/stages/market-health-filter.service";
import { markOpportunityConsumed } from "@/src/server/discovery/discovery.repository";
import { rankCandidates } from "@/src/server/scanner/candidate-ranking.service";
import { formatAIRequest } from "@/src/server/scanner/ai-request-formatter";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import { persistCandidateSignal } from "@/src/server/scanner/signal-persistence.service";
import { discoverTopGainerSymbols } from "@/src/server/scanner/top-gainer-discovery.service";
import { resolveWatchlist } from "@/src/server/scanner/watchlist.service";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";
import { evaluateMomentumBreakout } from "@/src/server/scanner/momentum-breakout.service";
import type { ScannerApiRow, ScannerPipelineResult } from "@/src/types/scanner";

type ScanCursorState = {
  value: number;
  loaded: boolean;
};

type ScannerRunState = {
  running: boolean;
  lastResult?: ScannerPipelineResult;
  pending?: Promise<ScannerPipelineResult>;
};

function getScanCursorState(): ScanCursorState {
  const globalRef = globalThis as typeof globalThis & { __kineticScanCursorState?: ScanCursorState };
  if (!globalRef.__kineticScanCursorState) {
    globalRef.__kineticScanCursorState = { value: 0, loaded: false };
  }
  return globalRef.__kineticScanCursorState;
}

const scanCursorPath = path.join(process.cwd(), "data", "scanner-cursor.json");

async function ensureScanCursorLoaded() {
  const state = getScanCursorState();
  if (state.loaded) return state;
  try {
    const raw = await readFile(scanCursorPath, "utf8");
    const parsed = JSON.parse(raw) as { value?: number };
    if (Number.isFinite(parsed.value)) {
      state.value = Math.max(0, Math.floor(Number(parsed.value)));
    }
  } catch {
    // ignore
  }
  state.loaded = true;
  return state;
}

async function persistScanCursor(value: number) {
  try {
    await mkdir(path.dirname(scanCursorPath), { recursive: true });
    await writeFile(scanCursorPath, JSON.stringify({ value }), "utf8");
  } catch {
    // ignore
  }
}

function getScanRunState(): ScannerRunState {
  const globalRef = globalThis as typeof globalThis & { __kineticScanRunState?: ScannerRunState };
  if (!globalRef.__kineticScanRunState) {
    globalRef.__kineticScanRunState = { running: false };
  }
  return globalRef.__kineticScanRunState;
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
  options?: { deadlineMs?: number; onTimeout?: () => void },
): Promise<Array<R | null>> {
  const size = Math.max(1, Math.min(concurrency, items.length || 1));
  const results: Array<R | null> = new Array(items.length).fill(null);
  let next = 0;
  let timeoutSignaled = false;

  const runners = Array.from({ length: size }).map(async () => {
    while (true) {
      if (options?.deadlineMs && Date.now() > options.deadlineMs) {
        if (!timeoutSignaled) {
          timeoutSignaled = true;
          options.onTimeout?.();
        }
        break;
      }
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
  options?: {
    includeAi?: boolean;
    persistRejected?: boolean;
    persist?: boolean;
    executionMode?: "dry-run" | "paper" | "live";
  },
): Promise<ScannerPipelineResult> {
  const runState = getScanRunState();
  if (runState.running) {
    if (runState.pending) return runState.pending;
    if (runState.lastResult) return runState.lastResult;
    return {
      scannedAt: new Date().toISOString(),
      totalSymbols: 0,
      qualifiedSymbols: 0,
      aiEvaluatedSymbols: 0,
      candidates: [],
    };
  }
  runState.running = true;
  const execution = (async () => {
    markHeartbeat({ service: "scanner", status: "UP", message: "Scanner cycle started" });
    const includeAi = options?.includeAi ?? true;
    const persistRejected = options?.persistRejected ?? true;
    const persist = options?.persist ?? true;
    const scannerStartAt = Date.now();
    const maxCycleSec = Math.max(15, env.SCANNER_MAX_CYCLE_SEC ?? 0);
    const cycleDeadlineMs = maxCycleSec > 0 ? scannerStartAt + maxCycleSec * 1000 : undefined;
    const runtimeStrategy = await getRuntimeStrategyParams();
    const executionMode = options?.executionMode ?? env.EXECUTION_MODE;
    const watchlist = await resolveWatchlist(userId);
    const topGainers = await discoverTopGainerSymbols(36).catch(() => []);
    const topGainerMap = new Map(topGainers.map((row) => [row.symbol, row]));

  // Scan all symbols sequentially in fixed-size batches (e.g. 50 by 50).
  const cycleLimit = Math.max(1, Math.min(env.SCANNER_CYCLE_SYMBOL_LIMIT, watchlist.length));
  const baseUniverse = watchlist;
  const cursorState = await ensureScanCursorLoaded();
  const cursor = Math.max(0, cursorState.value % Math.max(baseUniverse.length, 1));
  const cycleSymbols =
    baseUniverse.length <= cycleLimit
      ? baseUniverse
      : Array.from({ length: cycleLimit }).map((_, idx) => baseUniverse[(cursor + idx) % baseUniverse.length]);
  cursorState.value = (cursor + cycleLimit) % Math.max(watchlist.length, 1);
  await persistScanCursor(cursorState.value);

  const contexts = await mapWithConcurrency(
    cycleSymbols,
    env.SCANNER_CONTEXT_CONCURRENCY,
    async (symbol) => {
      try {
        const context = await buildMarketContext(symbol, { lite: true });
        const topGainer = topGainerMap.get(context.symbol) ?? topGainerMap.get(symbol);
        if (topGainer) {
          context.metadata.topGainerDiscovery = true;
          context.metadata.topGainerChange24h = topGainer.change24h;
          context.metadata.topGainerPriorityScore = topGainer.priorityScore;
          context.metadata.topGainerReason = topGainer.reason;
        }
        const score = scoreContext(context);
        return { context, score };
      } catch (error) {
        logger.warn({ symbol, error: (error as Error).message }, "Scanner context failed");
        return null;
      }
    },
    cycleDeadlineMs
      ? {
          deadlineMs: cycleDeadlineMs,
          onTimeout: () => {
            pushLog("WARN", `Scanner tur sure limiti asildi. limit=${maxCycleSec}s`);
          },
        }
      : undefined,
  );

  const validRows = contexts.filter((x): x is NonNullable<typeof x> => Boolean(x));
  const aiScopeSymbols = new Set<string>();
  for (const row of validRows) {
    const decisionId = createDecisionId();
    row.context.metadata.decisionId = decisionId;
  }
  const healthFilteredRows = filterHealthyOnly(
    validRows.map((row) => ({ symbol: row.context.symbol, context: row.context, original: row })),
  ).map((entry) => entry.original);
  const discoveryHealthyRows = healthFilteredRows.length > 0 ? healthFilteredRows : validRows;
  const discoveryBatch = await runDiscoveryBatch(
    discoveryHealthyRows.map((row) => ({ symbol: row.context.symbol, context: row.context })),
    { persist: persist },
  );
  for (const profile of discoveryBatch.profiles) {
    const row = validRows.find((item) => item.context.symbol.toUpperCase() === profile.symbol.toUpperCase());
    if (!row) continue;
    row.context.metadata.discoveryProfile = profile;
    row.context.metadata.discoveryTier = profile.tier;
    row.context.metadata.discoveryOpportunityScore = profile.opportunityScore;
    row.context.metadata.discoveryConfidence = profile.confidence;
  }
  if (env.DISCOVERY_V2_INTEGRATE_SCANNER && env.TRADING_CORE_S2_ENABLED) {
    for (const row of validRows) {
      const v2Score = getCachedDiscoveryScore(row.context.symbol);
      if (v2Score != null) row.context.metadata.discoveryV2Score = v2Score;
    }
  }
  let rankingBaseRows = discoveryProfilesToCandidateRank(discoveryHealthyRows, discoveryBatch.profiles);
  if (env.DISCOVERY_V2_INTEGRATE_SCANNER && env.TRADING_CORE_S2_ENABLED) {
    const v2Top = getDiscoveryV2TopSymbolSet();
    if (v2Top.size > 0) {
      rankingBaseRows = [...rankingBaseRows].sort((a, b) => {
        const aIn = v2Top.has(a.context.symbol.toUpperCase()) ? 1 : 0;
        const bIn = v2Top.has(b.context.symbol.toUpperCase()) ? 1 : 0;
        if (aIn !== bIn) return bIn - aIn;
        const aScore = Number(a.context.metadata.discoveryV2Score ?? a.context.metadata.discoveryOpportunityScore ?? a.score.score);
        const bScore = Number(b.context.metadata.discoveryV2Score ?? b.context.metadata.discoveryOpportunityScore ?? b.score.score);
        return bScore - aScore;
      });
    }
  }
  if (rankingBaseRows.length === 0 && validRows.length > 0) {
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
      if (fallbackValid.length > 0) {
        rankingBaseRows = fallbackValid;
        pushLog("WARN", `Discovery resilience fallback aktif. recovered=${fallbackValid.length}`);
      }
    }
  }
  const maxPreAiSpreadPercent = Math.min(0.14, Math.max(0.08, env.SCANNER_MAX_SPREAD_PERCENT));
  const rankedAll = rankCandidates(rankingBaseRows, rankingBaseRows.length);
  const configuredTop = Math.max(1, Math.min(env.SCANNER_TOP_CANDIDATES, rankedAll.length));
  const fullCycleTarget = Math.max(1, Math.min(cycleSymbols.length, rankedAll.length));
  const aiScope = env.SCANNER_AI_EVALUATE_ALL
    ? rankedAll.slice(0, fullCycleTarget)
    : rankedAll.slice(0, configuredTop);
  for (const candidate of aiScope) {
    aiScopeSymbols.add(candidate.context.symbol.toUpperCase());
    void markOpportunityConsumed(candidate.context.symbol).catch(() => null);
  }
  const topCandidates = rankedAll.slice(0, configuredTop);

  for (const row of validRows) {
    const decisionId = String(row.context.metadata.decisionId ?? createDecisionId());
    if (aiScopeSymbols.has(row.context.symbol.toUpperCase())) continue;
    observeScannerDecision({
      decisionId,
      symbol: row.context.symbol,
      scannerScore: row.score.score,
      scannerConfidence: row.score.confidence,
      status: row.score.status,
      reasons: row.context.rejectReasons,
      metrics: {
        spreadPercent: row.context.spreadPercent,
        volume24h: row.context.volume24h,
        tradable: row.context.tradable,
      },
      contextMetadata: row.context.metadata as Record<string, unknown>,
    });
  }

  let aiEvaluated = 0;
  if (includeAi) {
    await mapWithConcurrency(
      aiScope,
      env.SCANNER_AI_CONCURRENCY,
      async (candidate) => {
        let attemptedAi = false;
        const decisionId = String(candidate.context.metadata.decisionId ?? createDecisionId());
        try {
          return await runWithDecisionTrace(
            beginDecisionTrace({
              decisionId,
              analysisId: decisionId,
              symbol: candidate.context.symbol,
              deferPersistence: true,
              source: "scanner",
            }),
            async () => {
              observeScannerDecision({
                decisionId,
                symbol: candidate.context.symbol,
                scannerScore: candidate.score.score,
                scannerConfidence: candidate.score.confidence,
                status: candidate.score.status,
                reasons: candidate.context.rejectReasons,
                metrics: {
                  spreadPercent: candidate.context.spreadPercent,
                  volume24h: candidate.context.volume24h,
                  tradable: candidate.context.tradable,
                },
                contextMetadata: candidate.context.metadata as Record<string, unknown>,
              });
              const fullContext = await buildMarketContext(candidate.context.symbol, { lite: false, forceLive: true });
              candidate.context = fullContext;
              const momentumBreakout = evaluateMomentumBreakout(fullContext);
              if (fullContext.spreadPercent > maxPreAiSpreadPercent && !momentumBreakout.ok) {
                fullContext.rejectReasons = Array.from(new Set([...fullContext.rejectReasons, "SPREAD_TOO_WIDE"]));
                if (persist) await persistCandidateSignal(candidate, undefined, userId);
                await finalizeDecisionLog({
                  decisionId,
                  symbol: candidate.context.symbol,
                  decision: "NO_TRADE",
                  executionAllowed: false,
                  humanSummary: `Trade rejected for ${candidate.context.symbol.toUpperCase()} because spread too wide before AI.`,
                });
                return null;
              }
              const aiInput = await formatAIRequest(
                candidate.context,
                {
                  scannerScore: candidate.score.score,
                  ...runtimeStrategy,
                  executionMode,
                },
                undefined,
              );
              attemptedAi = true;
              const ai = await runAIConsensusFromInput(aiInput);
              candidate.ai = ai;
              if (persist) await persistCandidateSignal(candidate, ai, userId);
              await finalizeDecisionLog({
                decisionId,
                symbol: candidate.context.symbol,
                decision: ai.finalDecision,
                executionAllowed: ai.finalDecision === "BUY",
              });
              return null;
            },
          );
        } catch (error) {
          logger.warn(
            { symbol: candidate.context.symbol, error: (error as Error).message },
            "AI evaluation skipped for candidate",
          );
          if (persist) await persistCandidateSignal(candidate, undefined, userId);
          await finalizeDecisionLog({
            decisionId,
            symbol: candidate.context.symbol,
            decision: "NO_TRADE",
            executionAllowed: false,
            humanSummary: `Trade rejected for ${candidate.context.symbol.toUpperCase()} because AI evaluation failed.`,
            metadata: { error: (error as Error).message },
          }).catch(() => null);
        } finally {
          if (attemptedAi) aiEvaluated += 1;
        }
        return null;
      },
      cycleDeadlineMs
        ? {
            deadlineMs: cycleDeadlineMs,
            onTimeout: () => {
              pushLog("WARN", `Scanner AI sure limiti asildi. limit=${maxCycleSec}s`);
            },
          }
        : undefined,
    );
  } else if (persist) {
    await mapWithConcurrency(
      aiScope,
      env.SCANNER_AI_CONCURRENCY,
      async (candidate) => {
        await persistCandidateSignal(candidate, undefined, userId);
        return null;
      },
      cycleDeadlineMs
        ? {
            deadlineMs: cycleDeadlineMs,
            onTimeout: () => {
              pushLog("WARN", `Scanner persist sure limiti asildi. limit=${maxCycleSec}s`);
            },
          }
        : undefined,
    );
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
      qualifiedSymbols: discoveryBatch.profiles.length,
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

    runState.lastResult = result;
    return result;
  })();
  runState.pending = execution;
  try {
    return await execution;
  } finally {
    runState.running = false;
    runState.pending = undefined;
  }
}

export function toScannerApiRows(result: ScannerPipelineResult): ScannerApiRow[] {
  return result.candidates.map((candidate) => ({
    symbol: candidate.context.symbol,
    price: candidate.context.lastPrice,
    change24h: candidate.context.change24h,
    volume24h: candidate.context.volume24h,
    volumeSpikePercent: candidate.context.volumeSpikePercent,
    pumpIntensity: candidate.context.pumpIntensity,
    pumpRisk: candidate.context.pumpRisk,
    socialSentimentScore: Number(candidate.context.metadata.socialSentimentScore ?? 50),
    newsSentiment: String(candidate.context.metadata.macroNewsSentiment ?? "NEUTRAL") as
      | "POSITIVE"
      | "NEGATIVE"
      | "NEUTRAL",
    aiScore: Number((candidate.ai?.finalConfidence ?? candidate.score.confidence).toFixed(2)),
    scannerScore: candidate.score.score,
    spreadPercent: candidate.context.spreadPercent,
    volatilityPercent: candidate.context.volatilityPercent,
    decision: candidate.ai?.finalDecision ?? "HOLD",
    marketRegime: String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS"),
    marketRegimeStrategy: String(candidate.context.metadata.marketRegimeStrategy ?? "RANGE_MEAN_REVERSION"),
  }));
}
