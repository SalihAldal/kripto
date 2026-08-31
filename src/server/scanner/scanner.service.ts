import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { runAIConsensusFromInput, resolveAiLaneProviders } from "@/src/server/ai/analysis-orchestrator";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import {
  beginDecisionTrace,
  createDecisionId,
  finalizeDecisionLog,
  observeScannerDecision,
  recordDecisionTimelineEvent,
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
import { recordLegacyScannerInvocation } from "@/src/server/scanner/legacy-scanner-telemetry.service";
import { getOpportunityEngine } from "@/src/server/opportunity/opportunity-engine";
import type { TopGainerMarketDataEvent } from "@/src/server/scanner/top-gainer-discovery.service";
import { resolveWatchlist } from "@/src/server/scanner/watchlist.service";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";
import { evaluateMomentumBreakout } from "@/src/server/scanner/momentum-breakout.service";
import {
  buildScannerRejectTelemetryBundle,
  evaluateScannerSpreadMomentumShadow,
} from "@/src/server/scanner/scanner-reject-telemetry.service";
import type {
  DiscoverySource,
  MarketContext,
  ScannerApiRow,
  ScannerCoverageMetrics,
  ScannerPipelineResult,
  ScannerScore,
} from "@/src/types/scanner";
import {
  createAsyncTelemetry,
  resolveAiConsensusTimeoutMs,
  resolveAiPhaseDeadlineMs,
  resolveAsyncWorkerTimeoutMs,
  resolveMarketContextTimeoutMs,
  resolveScannerAiWorkerTimeoutMs,
  runCooperativePool,
  withBoundedAwait,
  CooperativeAsyncTimeoutError,
  type AsyncRuntimeTelemetry,
} from "@/src/server/execution/cooperative-async.service";
import { throwIfAborted } from "@/src/server/execution/cancellable-work.service";
import { CooperativeAsyncCancelledError } from "@/src/server/execution/cooperative-async.types";
import {
  beginAiBatch,
  cancelAiCandidate,
  completeAiCandidate,
  failAiCandidate,
  startAiCandidate,
  writeAiProgressArtifact,
  writeMinimumAiStallArtifacts,
} from "@/src/server/forensics/ai-runtime.service";
import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";
import { getForensicSession } from "@/src/server/forensics/forensic-context";
import {
  bridgeScannerQualificationForensics,
  bridgeScannerCoverageSnapshot,
  bridgeScannerUniverseSnapshot,
} from "@/src/server/forensics/forensic-bridge.service";

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

function buildScannerObservabilityInput(
  row: { context: MarketContext; score: ScannerScore },
  maxPreAiSpreadPercent: number,
  decisionId: string,
) {
  const bundle = buildScannerRejectTelemetryBundle({
    context: row.context,
    score: row.score,
    maxPreAiSpreadPercent,
    candidateId: decisionId,
  });
  return {
    decisionId,
    symbol: row.context.symbol,
    scannerScore: row.score.score,
    scannerConfidence: row.score.confidence,
    status: row.score.status,
    reasons: row.score.reasons.length > 0 ? row.score.reasons : row.context.rejectReasons,
    metrics: {
      spreadPercent: row.context.spreadPercent,
      volume24h: row.context.volume24h,
      tradable: row.context.tradable,
      lastPrice: row.context.lastPrice,
      change24h: row.context.change24h,
      liquidityScore: row.context.metadata.liquidityScore,
    },
    contextMetadata: row.context.metadata as Record<string, unknown>,
    rejectTelemetry: bundle.telemetry,
    spreadMomentumShadow: bundle.shadow,
  };
}

type ScannerCyclePlan = {
  rotationSymbols: string[];
  prioritySymbols: string[];
  evaluationSymbols: string[];
  duplicatesRemoved: number;
  notDiscoveredCount: number;
};

export function buildScannerCyclePlan(input: {
  watchlist: string[];
  cursor: number;
  cycleLimit: number;
  prioritySymbols: Array<{ symbol: string; priorityScore: number; reason: string }>;
  priorityMaxPerCycle: number;
}): ScannerCyclePlan {
  const upperWatchlist = input.watchlist.map((symbol) => symbol.toUpperCase());
  const start = Math.max(0, input.cursor % Math.max(upperWatchlist.length, 1));
  const rotationSymbols =
    upperWatchlist.length <= input.cycleLimit
      ? upperWatchlist
      : Array.from({ length: input.cycleLimit }).map((_, idx) => upperWatchlist[(start + idx) % upperWatchlist.length]);

  const rotationSet = new Set(rotationSymbols);
  const dedupPriority: Array<{ symbol: string; priorityScore: number; reason: string }> = [];
  for (const row of input.prioritySymbols) {
    const symbol = row.symbol.toUpperCase();
    if (rotationSet.has(symbol)) continue;
    if (!upperWatchlist.includes(symbol)) continue;
    if (dedupPriority.some((item) => item.symbol === symbol)) continue;
    dedupPriority.push({ symbol, priorityScore: row.priorityScore, reason: row.reason });
    if (dedupPriority.length >= input.priorityMaxPerCycle) break;
  }

  const rawMerged = [...dedupPriority.map((row) => row.symbol), ...rotationSymbols];
  const evaluationSymbols = Array.from(new Set(rawMerged));
  return {
    rotationSymbols,
    prioritySymbols: dedupPriority.map((row) => row.symbol),
    evaluationSymbols,
    duplicatesRemoved: rawMerged.length - evaluationSymbols.length,
    notDiscoveredCount: Math.max(0, upperWatchlist.length - evaluationSymbols.length),
  };
}

export type ScannerPipelineRuntimeOptions = {
  attachIfRunning?: boolean;
  attachMaxWaitMs?: number;
  preferLastResultOnAttachTimeout?: boolean;
  maxCycleSec?: number;
  phaseDeadlineMs?: number;
  selectionDeadlineMs?: number;
  selectionBudgetMs?: number;
  abortSignal?: AbortSignal;
  roundId?: string;
  runId?: string;
  forbidLegacyScanner?: boolean;
  shouldAbort?: () => void;
  abortSignal?: AbortSignal;
  selectionDeadlineMs?: number;
  selectionBudgetMs?: number;
  onHeartbeat?: () => void | Promise<void>;
  onProgress?: () => void | Promise<void>;
  onRuntimeProgress?: (patch: {
    lastScannerProgressAt?: string;
    lastMarketDataProgressAt?: string;
    lastAIProgressAt?: string;
    scannerSymbolsProcessed?: number;
    marketDataRequests?: number;
    marketDataFailures?: number;
    fallbackCount?: number;
    degradedCandidates?: number;
    aiProcessed?: number;
  }) => void | Promise<void>;
  onMarketDataEvent?: (event: TopGainerMarketDataEvent) => void | Promise<void>;
  telemetry?: AsyncRuntimeTelemetry;
  onCheckpoint?: (info: {
    phase: "context" | "discovery" | "ranking" | "ai" | "consensus";
    processed: number;
    total: number;
    symbol?: string;
  }) => void | Promise<void>;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  options?: {
    deadlineMs?: number;
    onTimeout?: () => void;
    shouldAbort?: () => void;
    abortSignal?: AbortSignal;
    selectionDeadlineMs?: number;
    selectionBudgetMs?: number;
    onHeartbeat?: () => void | Promise<void>;
    telemetry?: AsyncRuntimeTelemetry;
    workerTimeoutMs?: number;
    label?: string;
    onItemStart?: (index: number, total: number) => void | Promise<void>;
    onItemComplete?: (index: number, total: number) => void | Promise<void>;
    onWorkerTimeout?: (index: number, total: number, item: T, error: Error) => void | Promise<void>;
  },
): Promise<Array<R | null>> {
  if (items.length === 0) return [];
  const stageTimeoutMs =
    options?.deadlineMs && options.deadlineMs > Date.now()
      ? options.deadlineMs - Date.now()
      : undefined;
  return runCooperativePool(
    items,
    worker,
    {
      label: options?.label ?? "scanner-map",
      concurrency,
      workerTimeoutMs: options?.workerTimeoutMs ?? resolveAsyncWorkerTimeoutMs(),
      deadlineMs: options?.deadlineMs,
      stageTimeoutMs,
      shouldAbort: options?.shouldAbort,
      abortSignal: options?.abortSignal,
      selectionDeadlineMs: options?.selectionDeadlineMs,
      selectionBudgetMs: options?.selectionBudgetMs,
      onHeartbeat: options?.onHeartbeat,
      telemetry: options?.telemetry,
      onWorkerTimeout: options?.onWorkerTimeout,
      onItemStart: async (index, total) => {
        await options?.onItemStart?.(index, total);
      },
      onItemComplete: async (processed, total) => {
        if (stageTimeoutMs && Date.now() > (options?.deadlineMs ?? 0) && processed === 1) {
          options?.onTimeout?.();
        }
        await options?.onItemComplete?.(processed, total);
      },
    },
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleOpportunityConsumed(symbols: string[]) {
  if (symbols.length === 0) return;
  void runCooperativePool(
    symbols,
    async (symbol, _index, _signal) => {
      await markOpportunityConsumed(symbol);
      return null;
    },
    {
      label: "mark-opportunity-consumed",
      concurrency: 2,
      workerTimeoutMs: 15_000,
    },
  ).catch(() => null);
}

async function waitForScannerAttach(
  pending: Promise<ScannerPipelineResult>,
  maxWaitMs: number,
  lastResult?: ScannerPipelineResult,
) {
  let resolved: ScannerPipelineResult | null = null;
  await Promise.race([
    pending.then((value) => {
      resolved = value;
    }),
    sleep(maxWaitMs),
  ]);
  return resolved ?? lastResult ?? null;
}

export async function runScannerPipeline(
  userId?: string,
  options?: {
    includeAi?: boolean;
    persistRejected?: boolean;
    persist?: boolean;
    executionMode?: "dry-run" | "paper" | "live";
    runtime?: ScannerPipelineRuntimeOptions;
  },
): Promise<ScannerPipelineResult> {
  const runState = getScanRunState();
  const runtime = options?.runtime;
  if (runtime?.forbidLegacyScanner) {
    throw new Error("LEGACY_SCANNER_FORBIDDEN_IN_CANONICAL_RUNTIME");
  }
  recordLegacyScannerInvocation({
    runId: runtime?.runId,
    roundId: runtime?.roundId,
    source: "runScannerPipeline",
  });
  if (runState.running) {
    if (runtime?.attachIfRunning) {
      const maxWaitMs = Math.max(1000, runtime.attachMaxWaitMs ?? env.AUTO_ROUND_SCANNER_ATTACH_MAX_WAIT_MS);
      if (runState.pending) {
        const attached = await waitForScannerAttach(runState.pending, maxWaitMs, runState.lastResult);
        if (attached) return attached;
      }
      if (runtime.preferLastResultOnAttachTimeout && runState.lastResult) {
        return runState.lastResult;
      }
    } else {
      const maxWaitMs = Math.max(1000, runtime?.attachMaxWaitMs ?? env.AUTO_ROUND_SCANNER_ATTACH_MAX_WAIT_MS);
      if (runState.pending) {
        const attached = await waitForScannerAttach(runState.pending, maxWaitMs, runState.lastResult);
        if (attached) return attached;
      }
      if (runState.lastResult) return runState.lastResult;
      return {
        scannedAt: new Date().toISOString(),
        totalSymbols: 0,
        qualifiedSymbols: 0,
        aiEvaluatedSymbols: 0,
        candidates: [],
      };
    }
  }
  runState.running = true;
  const execution = (async () => {
    markHeartbeat({ service: "scanner", status: "UP", message: "Scanner cycle started" });
    const includeAi = options?.includeAi ?? true;
    const persistRejected = options?.persistRejected ?? true;
    const persist = options?.persist ?? true;
    const scannerStartAt = Date.now();
    const maxCycleSec = Math.max(
      15,
      runtime?.maxCycleSec ?? env.SCANNER_MAX_CYCLE_SEC ?? 0,
    );
    const cycleDeadlineMs = maxCycleSec > 0 ? scannerStartAt + maxCycleSec * 1000 : undefined;
    const activeRuntime: ScannerPipelineRuntimeOptions = {
      ...(runtime ?? {}),
      telemetry: runtime?.telemetry ?? createAsyncTelemetry(),
    };
    const cooperativeOptions = {
      deadlineMs: cycleDeadlineMs,
      shouldAbort: activeRuntime.shouldAbort,
      abortSignal: activeRuntime.abortSignal,
      selectionDeadlineMs: activeRuntime.selectionDeadlineMs,
      selectionBudgetMs: activeRuntime.selectionBudgetMs,
      onHeartbeat: activeRuntime.onHeartbeat,
      telemetry: activeRuntime.telemetry,
      workerTimeoutMs: resolveAsyncWorkerTimeoutMs(),
      onTimeout: () => {
        pushLog("WARN", `Scanner tur sure limiti asildi. limit=${maxCycleSec}s`);
      },
    };
    const runtimeStrategy = await getRuntimeStrategyParams();
    const executionMode = options?.executionMode ?? env.EXECUTION_MODE;
    const watchlist = await resolveWatchlist(userId);
    const marketDataRuntime = {
      marketDataRequests: 0,
      marketDataFailures: 0,
      fallbackCount: 0,
      scannerSymbolsProcessed: 0,
      aiProcessed: 0,
    };
    const opportunity = getOpportunityEngine().scan();
    const opportunitySymbols = opportunity.ranked.map((row) => row.symbol);
    const topGainers: Array<{ symbol: string; priorityScore: number; reason: string; change24h?: number }> = opportunity.ranked.map(
      (row) => ({
        symbol: row.symbol,
        priorityScore: row.score,
        reason: row.primaryLane,
        change24h: row.features.change24h,
      }),
    );
    const topGainerMap = new Map(topGainers.map((row) => [row.symbol, row]));
    const priorityMaxPerCycleRaw = Number(process.env.SCANNER_PRIORITY_MAX_PER_CYCLE ?? 8);
    const priorityMaxPerCycle = Number.isFinite(priorityMaxPerCycleRaw)
      ? Math.max(1, Math.min(24, Math.floor(priorityMaxPerCycleRaw)))
      : 8;

  const cycleLimit = Math.max(1, Math.min(env.SCANNER_CYCLE_SYMBOL_LIMIT, Math.max(watchlist.length, 1)));
  const cursorState = await ensureScanCursorLoaded();
  const cursor = Math.max(0, cursorState.value % Math.max(watchlist.length, 1));
  const cyclePlan = opportunitySymbols.length
    ? {
        rotationSymbols: opportunitySymbols,
        prioritySymbols: opportunity.ranked
          .filter((row) => row.state === "HOT" || row.state === "PROMOTED")
          .map((row) => row.symbol),
        evaluationSymbols: opportunitySymbols,
      }
    : buildScannerCyclePlan({
        watchlist,
        cursor,
        cycleLimit,
        prioritySymbols: [],
        priorityMaxPerCycle,
      });
  const cycleSymbols = cyclePlan.rotationSymbols;
  const prioritySymbols = cyclePlan.prioritySymbols;
  const evaluationSymbols = cyclePlan.evaluationSymbols;
  cursorState.value = (cursor + cycleLimit) % Math.max(watchlist.length, 1);
  await persistScanCursor(cursorState.value);
  if (persist) {
    bridgeScannerUniverseSnapshot({ watchlist, cycleSymbols });
  }
  const rotationSet = new Set(cycleSymbols.map((row) => row.toUpperCase()));
  const prioritySet = new Set(prioritySymbols.map((row) => row.toUpperCase()));

  const contexts = await mapWithConcurrency(
    evaluationSymbols,
    env.SCANNER_CONTEXT_CONCURRENCY,
    async (symbol, _index, signal) => {
      try {
        activeRuntime.shouldAbort?.();
        const context = await withBoundedAwait(
          `context-lite:${symbol}`,
          (innerSignal) =>
            buildMarketContext(symbol, {
              lite: true,
              signal: innerSignal,
              timeoutMs: resolveMarketContextTimeoutMs(),
              allowBackgroundIntelCapture: false,
            }),
          resolveMarketContextTimeoutMs(),
          activeRuntime.telemetry,
          undefined,
          { signal },
        );
        if (typeof context.metadata.candidateTimestamp !== "string") {
          context.metadata.candidateTimestamp = new Date().toISOString();
        }
        const topGainer = topGainerMap.get(context.symbol) ?? topGainerMap.get(symbol);
        const source: DiscoverySource = prioritySet.has(context.symbol.toUpperCase())
          ? "PRIORITY"
          : rotationSet.has(context.symbol.toUpperCase())
            ? "ROTATION"
            : "OTHER";
        context.metadata.discoverySource = source;
        if (topGainer) {
          context.metadata.topGainerDiscovery = true;
          context.metadata.topGainerChange24h = topGainer.change24h;
          context.metadata.topGainerPriorityScore = topGainer.priorityScore;
          context.metadata.topGainerReason = topGainer.reason;
          if (source === "PRIORITY") {
            context.metadata.priorityReason = topGainer.reason;
            context.metadata.priorityScore = Number(topGainer.priorityScore ?? 0);
          }
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
          ...cooperativeOptions,
          label: "scanner-context",
          onItemComplete: async (processed, total) => {
            marketDataRuntime.scannerSymbolsProcessed = processed;
            await activeRuntime.onRuntimeProgress?.({
              scannerSymbolsProcessed: processed,
              lastScannerProgressAt: new Date().toISOString(),
            });
            await activeRuntime?.onCheckpoint?.({ phase: "context", processed, total });
          },
        }
      : {
          shouldAbort: activeRuntime?.shouldAbort,
          onHeartbeat: activeRuntime?.onHeartbeat,
          telemetry: activeRuntime?.telemetry,
          workerTimeoutMs: resolveMarketContextTimeoutMs(),
          label: "scanner-context",
          onItemComplete: async (processed, total) => {
            marketDataRuntime.scannerSymbolsProcessed = processed;
            await activeRuntime.onRuntimeProgress?.({
              scannerSymbolsProcessed: processed,
              lastScannerProgressAt: new Date().toISOString(),
            });
            await activeRuntime?.onCheckpoint?.({ phase: "context", processed, total });
          },
        },
  );

  const validRows = contexts.filter((x): x is NonNullable<typeof x> => Boolean(x));
  const evaluatedSymbolSet = new Set(evaluationSymbols.map((row) => row.toUpperCase()));
  const notEvaluatedSymbols = watchlist.map((row) => row.toUpperCase()).filter((symbol) => !evaluatedSymbolSet.has(symbol));
  const discoverySources = validRows.map((row) => ({
    symbol: row.context.symbol.toUpperCase(),
    discoverySource: String(row.context.metadata.discoverySource ?? "OTHER") as DiscoverySource,
    prioritySource:
      typeof row.context.metadata.topGainerDiscovery !== "undefined"
        ? "TOP_GAINER"
        : typeof row.context.metadata.pumpEarlyCatcher !== "undefined"
          ? "PUMP_CATCHER"
          : undefined,
    priorityReason:
      typeof row.context.metadata.priorityReason === "string"
        ? String(row.context.metadata.priorityReason)
        : undefined,
    priorityScore:
      Number.isFinite(Number(row.context.metadata.priorityScore ?? Number.NaN))
        ? Number(row.context.metadata.priorityScore)
        : undefined,
  }));
  const scannerCoverage: ScannerCoverageMetrics = {
    scannerUniverse: watchlist.length,
    priorityMaxPerCycle,
    rotationCandidates: cycleSymbols.length,
    priorityCandidates: prioritySymbols.length,
    rotationCount: cycleSymbols.length,
    priorityCount: prioritySymbols.length,
    duplicatesRemoved: cyclePlan.duplicatesRemoved,
    duplicateCount: cyclePlan.duplicatesRemoved,
    totalEvaluated: evaluationSymbols.length,
    totalEvaluationCount: evaluationSymbols.length,
    notDiscoveredCount: cyclePlan.notDiscoveredCount,
    priorityRescuedCount: validRows.filter(
      (row) => String(row.context.metadata.discoverySource ?? "OTHER") === "PRIORITY",
    ).length,
    discoverySources,
  };
  const aiScopeSymbols = new Set<string>();
  for (const row of validRows) {
    const decisionId = createDecisionId();
    row.context.metadata.decisionId = decisionId;
  }
  const healthFilteredRows = filterHealthyOnly(
    validRows.map((row) => ({ symbol: row.context.symbol, context: row.context, original: row })),
  ).map((entry) => entry.original);
  const discoveryHealthyRows = healthFilteredRows.length > 0 ? healthFilteredRows : validRows;
  activeRuntime?.shouldAbort?.();
  await activeRuntime?.onCheckpoint?.({
    phase: "discovery",
    processed: 0,
    total: discoveryHealthyRows.length,
  });
  const discoveryBatch = await runDiscoveryBatch(
    discoveryHealthyRows.map((row) => ({ symbol: row.context.symbol, context: row.context })),
    {
      persist,
      shouldAbort: activeRuntime?.shouldAbort,
      onHeartbeat: activeRuntime?.onHeartbeat,
      telemetry: activeRuntime?.telemetry,
      onCheckpoint: async (processed, total, symbol) => {
        await activeRuntime?.onCheckpoint?.({ phase: "discovery", processed, total, symbol });
      },
    },
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
        async (symbol, _index, signal) => {
          try {
            const context = await withBoundedAwait(
              `context-fallback:${symbol}`,
              (innerSignal) =>
                buildMarketContext(symbol, {
                  signal: innerSignal,
                  timeoutMs: resolveMarketContextTimeoutMs(),
                  allowBackgroundIntelCapture: false,
                }),
              resolveMarketContextTimeoutMs(),
              activeRuntime.telemetry,
              undefined,
              { signal },
            );
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
  activeRuntime?.shouldAbort?.();
  await activeRuntime?.onCheckpoint?.({
    phase: "ranking",
    processed: 0,
    total: rankingBaseRows.length,
  });
  const rankedAll = rankCandidates(rankingBaseRows, rankingBaseRows.length);
  await activeRuntime?.onCheckpoint?.({
    phase: "ranking",
    processed: rankedAll.length,
    total: rankedAll.length,
  });
  const configuredTop = Math.max(1, Math.min(env.SCANNER_TOP_CANDIDATES, rankedAll.length));
  const fullCycleTarget = Math.max(1, Math.min(evaluationSymbols.length, rankedAll.length));
  const canonicalSymbols = new Set(
    opportunity.ranked
      .filter((row) => row.state === "HOT" || row.state === "PROMOTED")
      .map((row) => row.symbol.toUpperCase()),
  );
  const aiScopeBase = canonicalSymbols.size > 0
    ? rankedAll.filter((row) => canonicalSymbols.has(row.context.symbol.toUpperCase()))
    : rankedAll;
  const aiScope = env.SCANNER_AI_EVALUATE_ALL
    ? aiScopeBase.slice(0, fullCycleTarget)
    : aiScopeBase.slice(0, configuredTop);
  for (const candidate of aiScope) {
    aiScopeSymbols.add(candidate.context.symbol.toUpperCase());
  }
  const topCandidates = rankedAll.slice(0, configuredTop);
  const rankedSymbolSet = new Set(rankingBaseRows.map((row) => row.context.symbol.toUpperCase()));

  if (persist) {
    bridgeScannerCoverageSnapshot({
      timestamp: new Date().toISOString(),
      ...scannerCoverage,
    });
    for (const row of validRows) {
      bridgeScannerQualificationForensics({
        context: row.context,
        score: row.score,
        inCycle: rotationSet.has(row.context.symbol.toUpperCase()),
        inUniverse: true,
        ranked: rankedSymbolSet.has(row.context.symbol.toUpperCase()),
        aiScope: aiScopeSymbols.has(row.context.symbol.toUpperCase()),
      });
    }
    for (const symbol of notEvaluatedSymbols.slice(0, 200)) {
      bridgeScannerQualificationForensics({
        context: {
          symbol,
          lastPrice: 0,
          change24h: 0,
          volume24h: 0,
          volumeSpikePercent: 0,
          spreadPercent: 0,
          volatilityPercent: 0,
          momentumPercent: 0,
          orderBookImbalance: 0,
          buyPressure: 0,
          shortCandleSignal: 0,
          fakeSpikeScore: 0,
          pumpIntensity: 0,
          pumpRisk: 0,
          tradable: false,
          rejectReasons: [],
          metadata: { discoverySource: "OTHER" },
        },
        score: {
          symbol,
          score: 0,
          confidence: 0,
          status: "REJECTED",
          reasons: [],
          metrics: {
            momentum: 0,
            microMomentum: 0,
            volume: 0,
            spread: 0,
            volatility: 0,
            orderBook: 0,
            pressure: 0,
            microFlow: 0,
            velocity: 0,
            candle: 0,
            fakeSpikePenalty: 0,
            liquidityPenalty: 0,
            pumpBoost: 0,
            pumpRiskPenalty: 0,
          },
        },
        inCycle: false,
        inUniverse: true,
        ranked: false,
        aiScope: false,
      });
    }
  }

  if (persist) {
    for (const row of validRows) {
      const decisionId = String(row.context.metadata.decisionId ?? createDecisionId());
      if (aiScopeSymbols.has(row.context.symbol.toUpperCase())) continue;
      observeScannerDecision(buildScannerObservabilityInput(row, maxPreAiSpreadPercent, decisionId));
    }
  }

  let aiEvaluated = 0;
  if (includeAi) {
    activeRuntime?.shouldAbort?.();
    const forensicSession = getForensicSession();
    const roundId = activeRuntime.roundId ?? forensicSession?.roundId ?? "scanner";
    const runId = activeRuntime.runId ?? forensicSession?.runId;
    beginAiBatch({
      roundId,
      runId,
      total: aiScope.length,
      concurrency: env.SCANNER_AI_CONCURRENCY,
    });
    await activeRuntime?.onCheckpoint?.({
      phase: "ai",
      processed: 0,
      total: aiScope.length,
    });
    scheduleOpportunityConsumed(aiScope.map((candidate) => candidate.context.symbol));
    const aiPhaseDeadlineMs = resolveAiPhaseDeadlineMs(activeRuntime.selectionDeadlineMs ?? activeRuntime.phaseDeadlineMs);
    const laneProviders = resolveAiLaneProviders();
    const providerLabel = laneProviders.primaryProvider;
    const modelLabel = [laneProviders.models.technical, laneProviders.models.momentum, laneProviders.models.risk]
      .filter(Boolean)
      .join(",");
    const aiPoolOptions = {
      shouldAbort: activeRuntime?.shouldAbort,
      abortSignal: activeRuntime?.abortSignal,
      selectionDeadlineMs: activeRuntime?.selectionDeadlineMs ?? activeRuntime?.phaseDeadlineMs,
      selectionBudgetMs: activeRuntime?.selectionBudgetMs,
      onHeartbeat: activeRuntime?.onHeartbeat,
      telemetry: activeRuntime?.telemetry,
      workerTimeoutMs: resolveScannerAiWorkerTimeoutMs(),
      label: "scanner-ai",
      deadlineMs: aiPhaseDeadlineMs,
      onTimeout: () => {
        pushLog("WARN", `Scanner AI faz suresi doldu. deadline=${new Date(aiPhaseDeadlineMs).toISOString()}`);
      },
      onWorkerTimeout: async (_index: number, _total: number, candidate: (typeof aiScope)[number], error: Error) => {
        const symbol = candidate.context.symbol.toUpperCase();
        failAiCandidate({
          roundId,
          runId,
          symbol,
          reasonCode: STALL_ERROR_CODES.AI_TIMEOUT,
          errorType: error.name,
          reasonDetail: error.message,
          timeout: true,
          timeoutAt: new Date().toISOString(),
          aborted: true,
          abortReason: error.message,
          signalPropagated: true,
          provider: providerLabel,
          model: modelLabel,
        });
        if (forensicSession?.sessionId) {
          writeAiProgressArtifact({ sessionId: forensicSession.sessionId, roundId, runId });
          writeMinimumAiStallArtifacts({
            sessionId: forensicSession.sessionId,
            roundId,
            runId,
            reason: error.message,
          });
        }
      },
      onItemStart: async (index: number, total: number) => {
        await activeRuntime?.onCheckpoint?.({
          phase: "ai",
          processed: index,
          total,
          symbol: aiScope[index]?.context.symbol,
        });
        await activeRuntime?.onProgress?.();
      },
      onItemComplete: async (processed: number, total: number) => {
        aiEvaluated = processed;
        marketDataRuntime.aiProcessed = processed;
        await activeRuntime?.onCheckpoint?.({
          phase: "ai",
          processed,
          total,
          symbol: aiScope[Math.max(0, processed - 1)]?.context.symbol,
        });
        await activeRuntime.onRuntimeProgress?.({
          aiProcessed: processed,
          lastAIProgressAt: new Date().toISOString(),
        });
        await activeRuntime?.onProgress?.();
        if (forensicSession?.sessionId) {
          writeAiProgressArtifact({ sessionId: forensicSession.sessionId, roundId, runId });
        }
      },
    };
    await mapWithConcurrency(
      aiScope,
      env.SCANNER_AI_CONCURRENCY,
      async (candidate, _index, signal) => {
        const symbol = candidate.context.symbol.toUpperCase();
        const aiRecord = startAiCandidate({
          roundId,
          runId,
          symbol,
          stage: "ai",
          timeoutMs: resolveAiConsensusTimeoutMs(),
          provider: providerLabel,
          model: modelLabel,
          executionMode,
        });
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
              observeScannerDecision(
                buildScannerObservabilityInput(candidate, maxPreAiSpreadPercent, decisionId),
              );
              throwIfAborted(signal, "AI pipeline aborted before market context");
              const fullContext = await withBoundedAwait(
                `context-full:${candidate.context.symbol}`,
                (innerSignal) =>
                  buildMarketContext(candidate.context.symbol, {
                    lite: false,
                    priority: "high",
                    signal: innerSignal,
                    timeoutMs: resolveMarketContextTimeoutMs(),
                    allowBackgroundIntelCapture: false,
                  }),
                resolveMarketContextTimeoutMs(),
                activeRuntime?.telemetry,
                undefined,
                { signal },
              );
              candidate.context = fullContext;
              const momentumBreakout = evaluateMomentumBreakout(fullContext);
              if (fullContext.spreadPercent > maxPreAiSpreadPercent && !momentumBreakout.ok) {
                const spreadShadow = evaluateScannerSpreadMomentumShadow({
                  context: fullContext,
                  score: candidate.score,
                  maxPreAiSpreadPercent,
                });
                recordDecisionTimelineEvent({
                  stage: "SCANNER",
                  outcome: "REJECTED",
                  message: "PRE_AI_SPREAD_REJECT",
                  details: {
                    rejectReasonCode: "PRE_AI_SPREAD_REJECT",
                    rejectReasonDetail: `spread ${fullContext.spreadPercent.toFixed(4)}% > ${maxPreAiSpreadPercent} && momentumBreakout.ok=false`,
                    spreadPercent: fullContext.spreadPercent,
                    maxPreAiSpreadPercent,
                    momentumBreakoutOk: momentumBreakout.ok,
                    spreadMomentumShadow: spreadShadow,
                  },
                });
                cancelAiCandidate({
                  roundId,
                  runId,
                  symbol,
                  reasonCode: "PRE_AI_SPREAD_REJECT",
                  reasonDetail: "Candidate rejected before AI due to spread gate",
                  signalPropagated: true,
                  provider: providerLabel,
                  model: modelLabel,
                });
                fullContext.rejectReasons = Array.from(new Set([...fullContext.rejectReasons, "SPREAD_TOO_WIDE"]));
                if (persist) {
                  await persistCandidateSignal(candidate, undefined, userId, {
                    runId: activeRuntime.runId,
                    roundId: activeRuntime.roundId,
                  });
                }
                await finalizeDecisionLog({
                  decisionId,
                  symbol: candidate.context.symbol,
                  decision: "NO_TRADE",
                  executionAllowed: false,
                  humanSummary: `Trade rejected for ${candidate.context.symbol.toUpperCase()} because spread too wide before AI.`,
                });
                return null;
              }
              throwIfAborted(signal, "AI pipeline aborted before format");
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
              await activeRuntime?.onCheckpoint?.({
                phase: "consensus",
                processed: aiEvaluated,
                total: aiScope.length,
                symbol: candidate.context.symbol,
              });
              const ai = await withBoundedAwait(
                `ai-consensus:${candidate.context.symbol}`,
                (abortSignal) =>
                  runAIConsensusFromInput(
                    { ...aiInput, runtimeControl: { abortSignal, executionMode } },
                    { signal: abortSignal },
                  ),
                resolveAiConsensusTimeoutMs(),
                activeRuntime?.telemetry,
                undefined,
                { signal },
              );
              candidate.ai = ai;
              completeAiCandidate({
                roundId,
                runId,
                symbol,
                status: "COMPLETED",
                consensusStage: "consensus",
                provider: providerLabel,
                model: modelLabel,
              });
              if (persist) {
                await persistCandidateSignal(candidate, ai, userId, {
                  runId: activeRuntime.runId,
                  roundId: activeRuntime.roundId,
                });
              }
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
          const message = (error as Error).message;
          const stack = (error as Error).stack;
          const isTimeout =
            error instanceof CooperativeAsyncTimeoutError ||
            message.toLowerCase().includes("timed out") ||
            message.includes(STALL_ERROR_CODES.CONSENSUS_TIMEOUT);
          const isCancelled =
            error instanceof CooperativeAsyncCancelledError || signal.aborted;
          const isStackDepthGuard =
            message.includes(STALL_ERROR_CODES.AI_STACK_DEPTH_GUARD) ||
            (error as Error).name === "AIStackDepthGuardError" ||
            message.includes("Maximum call stack size exceeded");
          if (isCancelled && !isTimeout) {
            cancelAiCandidate({
              roundId,
              runId,
              symbol,
              reasonCode: "AI_CANCELLED",
              reasonDetail: message,
              signalPropagated: true,
              abortReason: message,
              provider: providerLabel,
              model: modelLabel,
            });
          } else {
            failAiCandidate({
              roundId,
              runId,
              symbol,
              reasonCode: isStackDepthGuard
                ? STALL_ERROR_CODES.AI_STACK_DEPTH_GUARD
                : isTimeout
                  ? message.includes("consensus")
                    ? STALL_ERROR_CODES.CONSENSUS_TIMEOUT
                    : STALL_ERROR_CODES.AI_TIMEOUT
                  : STALL_ERROR_CODES.AI_FAILED,
              errorType: (error as Error).name,
              reasonDetail: message,
              timeout: isTimeout,
              timeoutAt: isTimeout ? new Date().toISOString() : undefined,
              aborted: isTimeout,
              abortReason: message,
              signalPropagated: isTimeout,
              provider: providerLabel,
              model: modelLabel,
            });
          }
          if ((isTimeout || isCancelled) && forensicSession?.sessionId) {
            writeMinimumAiStallArtifacts({
              sessionId: forensicSession.sessionId,
              roundId,
              runId,
              reason: message,
            });
          }
          logger.warn(
            {
              symbol: candidate.context.symbol,
              error: message,
              stackTop: stack?.split("\n").slice(0, 6).join(" | "),
              candidateId: aiRecord.candidateId,
            },
            "AI evaluation skipped for candidate",
          );
          if (persist) {
            await persistCandidateSignal(candidate, undefined, userId, {
              runId: activeRuntime.runId,
              roundId: activeRuntime.roundId,
            });
          }
          await finalizeDecisionLog({
            decisionId,
            symbol: candidate.context.symbol,
            decision: "NO_TRADE",
            executionAllowed: false,
            humanSummary: `Trade rejected for ${candidate.context.symbol.toUpperCase()} because AI evaluation failed.`,
            metadata: { error: (error as Error).message },
          }).catch(() => null);
        } finally {
          if (attemptedAi && aiEvaluated >= 0) {
            // progress tracked via onItemComplete
          }
        }
        return null;
      },
      aiPoolOptions,
    );
  } else if (persist) {
    await mapWithConcurrency(
      aiScope,
      env.SCANNER_AI_CONCURRENCY,
      async (candidate, _index, _signal) => {
        await persistCandidateSignal(candidate, undefined, userId, {
          runId: activeRuntime.runId,
          roundId: activeRuntime.roundId,
        });
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
        {
          runId: activeRuntime.runId,
          roundId: activeRuntime.roundId,
        },
      );
    }
  }

    const result: ScannerPipelineResult = {
      scannedAt: new Date().toISOString(),
      totalSymbols: evaluationSymbols.length,
      qualifiedSymbols: discoveryBatch.profiles.length,
      aiEvaluatedSymbols: aiEvaluated,
      candidates: topCandidates,
      coverage: scannerCoverage,
    };

  pushLog(
    "INFO",
    `Scanner tamamlandi. scanned=${result.totalSymbols}, universeTotal=${watchlist.length}, rotation=${scannerCoverage.rotationCandidates}, priority=${scannerCoverage.priorityCandidates}, notDiscovered=${scannerCoverage.notDiscoveredCount}, qualified=${result.qualifiedSymbols}, ai=${result.aiEvaluatedSymbols}, universe=${env.SCANNER_UNIVERSE}, cursor=${cursorState.value}`,
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
