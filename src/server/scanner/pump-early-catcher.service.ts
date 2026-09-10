import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { evaluateMomentumBreakout } from "@/src/server/scanner/momentum-breakout.service";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import {
  discoverTopGainerSymbols,
  getTopGainerCacheMeta,
  type TopGainerDiscoveryItem,
} from "@/src/server/scanner/top-gainer-discovery.service";
import { marketDataGateway } from "@/src/server/market-data/market-data-gateway";
import { resolveWatchlist } from "@/src/server/scanner/watchlist.service";
import {
  resolveMarketContextTimeoutMs,
  runCooperativePool,
  withBoundedAwait,
} from "@/src/server/execution/cooperative-async.service";
import type { MomentumBreakoutAssessment } from "@/src/server/scanner/momentum-breakout.service";
import type { ScannerCandidate } from "@/src/types/scanner";
import { recordPumpScanEvent } from "@/src/server/scanner/pump-scan-lifecycle.service";
import { schedulePumpScan, attemptedPumpCursor } from "./pump-scan-scheduler";
import { isKnownLeveragedToken } from "../market-data/leveraged-token-symbol";

type PumpEarlyWatcherState = {
  running: boolean;
  startedAt?: string;
  lastRunAt?: string;
  lastRunOk?: boolean;
  lastError?: string;
  intervalMs: number;
  cursor: number;
  activeCandidate?: PumpEarlyCandidate;
  lastScanStats?: {
    scanned: number;
    topGainerCount: number;
    earlyHits: number;
    continuationHits: number;
    activeSymbol?: string;
    activeMode?: "early" | "continuation" | "intraday";
    intradayHits?: number;
  };
};

export type PumpEarlyCandidate = {
  candidate: ScannerCandidate;
  assessment: MomentumBreakoutAssessment;
  detectedAt: string;
  expiresAt: string;
  priorityScore: number;
  reason: string;
  mode: "early" | "continuation" | "intraday";
};

let timer: ReturnType<typeof setInterval> | null = null;
let runLock = false;
let livePumpCache: { at: number; value: PumpEarlyCandidate | null } = { at: 0, value: null };
let livePumpListCache: { at: number; value: PumpEarlyCandidate[] } = { at: 0, value: [] };
let lastNoCandidateLogAt = 0;
const state: PumpEarlyWatcherState = {
  running: false,
  intervalMs: env.PUMP_EARLY_CATCHER_INTERVAL_MS,
  cursor: 0,
};

function finite(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function activeCandidateTtlMs() {
  return Math.max(30_000, env.PUMP_EARLY_ACTIVE_TTL_MS);
}

function livePumpCacheTtlMs() {
  const configured = Math.max(8_000, env.PUMP_LIVE_SCAN_CACHE_MS);
  const watcherAwareFloor = Math.max(30_000, Math.floor(Math.max(state.intervalMs, 5_000) * 2));
  return Math.max(configured, watcherAwareFloor);
}

function pumpCandidateListCap(requested: number) {
  return Math.max(1, Math.min(32, requested));
}

function attachTopGainerMeta(context: ScannerCandidate["context"], topGainer?: TopGainerDiscoveryItem) {
  if (!topGainer) return context;
  return {
    ...context,
    metadata: {
      ...context.metadata,
      topGainerDiscovery: true,
      topGainerChange24h: topGainer.change24h,
      topGainerPriorityScore: topGainer.priorityScore,
      topGainerReason: topGainer.reason,
    },
  };
}

function buildPumpCandidate(input: {
  candidate: ScannerCandidate;
  assessment: MomentumBreakoutAssessment;
  priorityScore: number;
  reason: string;
  mode: "early" | "continuation" | "intraday";
  topGainer?: TopGainerDiscoveryItem;
  maxMove?: number;
}) {
  const now = new Date();
  const enriched = attachTopGainerMeta(input.candidate.context, input.topGainer);
  return {
    candidate: {
      ...input.candidate,
      context: {
        ...enriched,
        metadata: {
          ...enriched.metadata,
          pumpEarlyCatcher: true,
          pumpContinuationMode: input.mode !== "early",
          pumpIntradaySpike: input.mode === "intraday",
          pumpEarlyPriorityScore: input.priorityScore,
          pumpEarlyMaxMovePercent: input.maxMove ?? finite(input.candidate.context.metadata.shortMomentumPercent),
        },
      },
    },
    assessment: input.assessment,
    detectedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + activeCandidateTtlMs()).toISOString(),
    priorityScore: input.priorityScore,
    reason: input.reason,
    mode: input.mode,
  } as PumpEarlyCandidate;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  options?: {
    abortSignal?: AbortSignal;
    selectionDeadlineMs?: number;
    onItemComplete?: (processed: number, total: number) => void | Promise<void>;
    workerTimeoutMs?: number;
    label?: string;
  },
) {
  if (items.length === 0) return [];
  return runCooperativePool(
    items,
    async (item, index, signal) => {
      try {
        return await worker(item, index, signal);
      } catch {
        return null;
      }
    },
    {
      label: options?.label ?? "pump-scan-map",
      concurrency: Math.max(1, Math.min(concurrency, items.length || 1)),
      workerTimeoutMs: options?.workerTimeoutMs ?? resolveMarketContextTimeoutMs(),
      abortSignal: options?.abortSignal,
      selectionDeadlineMs: options?.selectionDeadlineMs,
      onItemComplete: async (processed, total) => {
        await options?.onItemComplete?.(processed, total);
      },
    },
  );
}

function evaluatePumpPriority(candidate: ScannerCandidate) {
  const context = candidate.context;
  const assessment = evaluateMomentumBreakout(context);
  const shortMomentum = finite(context.metadata.shortMomentumPercent);
  const fiveMinuteMomentum = finite(context.momentumPercent);
  const flow = finite(context.metadata.shortFlowImbalance);
  const velocity = finite(context.metadata.tradeVelocity);
  const volumeSpike = finite(context.metadata.volumeSpikePercent);
  const pumpIntensity = finite(context.metadata.pumpIntensity ?? context.pumpIntensity);
  const maxMove = Math.max(Math.abs(shortMomentum), Math.abs(fiveMinuteMomentum));
  const buyPressure = finite(context.buyPressure);
  const score = Math.max(
    0,
    Math.min(
      100,
      assessment.score * 0.48 +
        Math.max(0, shortMomentum) * 9 +
        Math.max(0, fiveMinuteMomentum) * 5 +
        Math.max(0, flow) * 110 +
        velocity * 8 +
        Math.min(18, Math.max(0, volumeSpike) * 0.08) +
        pumpIntensity * 0.25 +
        Math.max(0, buyPressure - 0.52) * 60 -
        context.spreadPercent * 75 -
        context.fakeSpikeScore * 10 -
        Math.max(0, context.pumpRisk - 64) * 0.8,
    ),
  );
  const liveDataHealthy = Boolean(context.metadata.liveDataHealthy ?? false);
  const earlyEnough = maxMove <= env.PUMP_EARLY_CATCHER_MAX_CHASE_PERCENT;
  const started =
    shortMomentum >= env.PUMP_EARLY_CATCHER_MIN_MOVE_PERCENT ||
    fiveMinuteMomentum >= env.PUMP_EARLY_CATCHER_MIN_MOVE_PERCENT;
  const buyOnly = assessment.direction === "BUY" || (shortMomentum > 0 && flow > 0.05);
  // TRY çiftlerinde velocity scale düşük; 0.25 → 0.04 (Binance TR gerçeği)
  const safeMicrostructure =
    context.spreadPercent <= 0.28 &&
    context.fakeSpikeScore <= 2.4 &&
    context.pumpRisk <= 78 &&
    flow >= 0.03 &&
    velocity >= 0.04;
  const ok =
    liveDataHealthy &&
    buyOnly &&
    started &&
    earlyEnough &&
    safeMicrostructure &&
    score >= env.PUMP_EARLY_CATCHER_MIN_SCORE &&
    assessment.stage !== "LATE";
  const reasons = [
    !liveDataHealthy ? "live data zayif" : "",
    !buyOnly ? "BUY yonu net degil" : "",
    !started ? `hareket erken tetik altinda (${Math.max(shortMomentum, fiveMinuteMomentum).toFixed(2)}%)` : "",
    !earlyEnough ? `pump kovalamasi gec (${maxMove.toFixed(2)}%)` : "",
    !safeMicrostructure ? "flow/velocity/spread/fake riski uygun degil" : "",
    score < env.PUMP_EARLY_CATCHER_MIN_SCORE ? `score ${score.toFixed(2)} < ${env.PUMP_EARLY_CATCHER_MIN_SCORE}` : "",
    assessment.stage === "LATE" ? "momentum gec evre" : "",
  ].filter(Boolean);
  return {
    ok,
    score: Number(score.toFixed(2)),
    assessment,
    reasons,
    maxMove: Number(maxMove.toFixed(4)),
  };
}

function evaluateTopGainerContinuation(candidate: ScannerCandidate, topGainer: TopGainerDiscoveryItem) {
  const context = candidate.context;
  const assessment = evaluateMomentumBreakout(context);
  const shortMomentum = finite(context.metadata.shortMomentumPercent);
  const hourMomentum = finite(context.metadata.hourMomentumPercent);
  const flow = finite(context.metadata.shortFlowImbalance);
  const velocity = finite(context.metadata.tradeVelocity);
  const change24h = finite(topGainer.change24h);
  const buyBias = shortMomentum > 0 && flow > 0;
  const stillMoving =
    (shortMomentum >= env.PUMP_CONTINUATION_MIN_SHORT_MOMENTUM && flow >= env.PUMP_CONTINUATION_MIN_FLOW) ||
    (hourMomentum >= 1.5 && shortMomentum >= 0.03 && flow >= 0.05) ||
    (hourMomentum >= 2.2 && flow >= 0.08);
  const liveDataHealthy = Boolean(context.metadata.liveDataHealthy ?? true);
  const allowLateStage =
    assessment.stage === "LATE" &&
    change24h >= env.PUMP_CONTINUATION_MIN_CHANGE_24H &&
    shortMomentum >= env.PUMP_CONTINUATION_MIN_SHORT_MOMENTUM &&
    flow >= env.PUMP_CONTINUATION_MIN_FLOW;
  const score = Math.max(
    0,
    Math.min(
      100,
      Math.min(55, change24h * 0.42) +
        Math.max(0, shortMomentum) * 14 +
        Math.max(0, flow) * 95 +
        velocity * 10 +
        topGainer.priorityScore * 0.22 -
        context.spreadPercent * 60 -
        context.fakeSpikeScore * 8 -
        Math.max(0, context.pumpRisk - 70) * 0.55,
    ),
  );
  const minVelocity = change24h >= 25 ? 0.03 : change24h >= 18 ? 0.04 : 0.06;
  const ok =
    env.PUMP_TOP_GAINER_CONTINUATION_ENABLED &&
    (change24h >= env.PUMP_CONTINUATION_MIN_CHANGE_24H || (hourMomentum >= 1.8 && change24h >= 6)) &&
    change24h <= env.PUMP_CONTINUATION_MAX_CHANGE_24H &&
    liveDataHealthy &&
    buyBias &&
    stillMoving &&
    context.spreadPercent <= 0.28 &&
    context.fakeSpikeScore <= 2.8 &&
    context.pumpRisk <= 85 &&
    velocity >= minVelocity &&
    flow >= env.PUMP_CONTINUATION_MIN_FLOW &&
    score >= env.PUMP_CONTINUATION_MIN_SCORE &&
    (assessment.stage !== "LATE" || allowLateStage);
  const reasons = [
    !env.PUMP_TOP_GAINER_CONTINUATION_ENABLED ? "continuation lane kapali" : "",
    change24h < env.PUMP_CONTINUATION_MIN_CHANGE_24H ? `24h change ${change24h.toFixed(2)}% dusuk` : "",
    change24h > env.PUMP_CONTINUATION_MAX_CHANGE_24H ? `24h change ${change24h.toFixed(2)}% cok yuksek` : "",
    !buyBias ? "BUY baskisi yok" : "",
    !stillMoving
      ? `momentum devam etmiyor (short>=${env.PUMP_CONTINUATION_MIN_SHORT_MOMENTUM}, flow>=${env.PUMP_CONTINUATION_MIN_FLOW})`
      : "",
    assessment.stage === "LATE" && !allowLateStage ? "late stage devam teyidi yok" : "",
    score < env.PUMP_CONTINUATION_MIN_SCORE ? `score ${score.toFixed(2)} < ${env.PUMP_CONTINUATION_MIN_SCORE}` : "",
  ].filter(Boolean);
  return {
    ok,
    score: Number(score.toFixed(2)),
    assessment,
    reasons,
    maxMove: Number(Math.max(Math.abs(shortMomentum), Math.abs(context.momentumPercent)).toFixed(4)),
  };
}

function evaluateIntradaySpikeContinuation(candidate: ScannerCandidate, leader: TopGainerDiscoveryItem) {
  const context = candidate.context;
  const assessment = evaluateMomentumBreakout(context);
  const shortMomentum = finite(context.metadata.shortMomentumPercent);
  const hourMomentum = finite(context.metadata.hourMomentumPercent);
  const flow = finite(context.metadata.shortFlowImbalance);
  const velocity = finite(context.metadata.tradeVelocity);
  const volumeSpike = finite(context.metadata.volumeSpikePercent);
  const change24h = finite(leader.change24h);
  const buyBias = shortMomentum > 0 && flow > 0;
  const momentumHot =
    shortMomentum >= env.PUMP_INTRADAY_MIN_SHORT_MOMENTUM ||
    (hourMomentum >= 1.5 && shortMomentum >= 0.04 && flow >= 0.05) ||
    (hourMomentum >= 2.2 && flow >= 0.08) ||
    (volumeSpike >= 25 && shortMomentum >= 0.08);
  const score = Math.max(
    0,
    Math.min(
      100,
      change24h * 0.65 +
        Math.max(0, shortMomentum) * 20 +
        Math.max(0, flow) * 90 +
        velocity * 12 +
        Math.min(20, Math.max(0, volumeSpike) * 0.12) -
        context.spreadPercent * 55 -
        context.fakeSpikeScore * 7,
    ),
  );
  const ok =
    env.PUMP_INTRADAY_ENABLED &&
    change24h >= env.PUMP_INTRADAY_MIN_CHANGE_24H &&
    change24h <= env.PUMP_CONTINUATION_MAX_CHANGE_24H &&
    buyBias &&
    momentumHot &&
    flow >= env.PUMP_INTRADAY_MIN_FLOW &&
    velocity >= 0.04 &&
    context.spreadPercent <= 0.3 &&
    context.fakeSpikeScore <= 3 &&
    context.pumpRisk <= 88 &&
    score >= Math.max(45, env.PUMP_CONTINUATION_MIN_SCORE - 6);
  return {
    ok,
    score: Number(score.toFixed(2)),
    assessment,
    reasons: [
      !env.PUMP_INTRADAY_ENABLED ? "intraday lane kapali" : "",
      change24h < env.PUMP_INTRADAY_MIN_CHANGE_24H ? `24h ${change24h.toFixed(2)}% dusuk` : "",
      !momentumHot ? `intraday momentum zayif (${shortMomentum.toFixed(2)}%)` : "",
      !buyBias ? "BUY baskisi yok" : "",
    ].filter(Boolean),
    maxMove: Number(Math.max(Math.abs(shortMomentum), Math.abs(context.momentumPercent)).toFixed(4)),
  };
}

async function discoverIntradaySpikeLeaders(
  limit = 32,
  options?: { abortSignal?: AbortSignal; selectionDeadlineMs?: number },
): Promise<TopGainerDiscoveryItem[]> {
  if (!env.PUMP_INTRADAY_ENABLED) return [];
  const rows = await marketDataGateway.listTickers24h();
  const quoteSuffix = env.BINANCE_PLATFORM === "tr" ? "TRY" : "USDT";
  const minVolume = Math.max(80_000, env.SCANNER_MIN_VOLUME_24H * 0.25);
  const seeds = rows
    .filter((row) => row.symbol.endsWith(quoteSuffix))
    .filter((row) => !isKnownLeveragedToken(row.symbol))
    .filter((row) => row.volume24h >= minVolume && row.change24h >= env.PUMP_INTRADAY_MIN_CHANGE_24H)
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, Math.max(limit * 2, 72));

  const hits = await mapWithConcurrency(
    seeds,
    Math.max(3, Math.min(10, env.SCANNER_CONTEXT_CONCURRENCY)),
    async (row, _index, signal): Promise<TopGainerDiscoveryItem | null> => {
      const context = await withBoundedAwait(
        `intraday-lite:${row.symbol}`,
        (innerSignal) =>
          buildMarketContext(row.symbol, {
            lite: true,
            priority: "high",
            signal: innerSignal,
            timeoutMs: resolveMarketContextTimeoutMs(),
            allowBackgroundIntelCapture: false,
          }),
        resolveMarketContextTimeoutMs(),
        undefined,
        undefined,
        { signal },
      ).catch(() => null);
      if (!context) return null;
      const shortMomentum = finite(context.metadata.shortMomentumPercent);
      const hourMomentum = finite(context.metadata.hourMomentumPercent);
      const flow = finite(context.metadata.shortFlowImbalance);
      const volumeSpike = finite(context.metadata.volumeSpikePercent);
      const isPaper = env.EXECUTION_MODE === "paper";
      const momentumHot =
        shortMomentum >= (isPaper ? 0.01 : env.PUMP_INTRADAY_MIN_SHORT_MOMENTUM) ||
        (isPaper && row.change24h >= 6 && (shortMomentum >= -0.05 || hourMomentum >= 0.3)) ||
        (hourMomentum >= 1.5 && shortMomentum >= 0.04 && flow >= 0.05) ||
        (hourMomentum >= 2.2 && flow >= 0.08) ||
        (volumeSpike >= 25 && shortMomentum >= 0.08);
      const minFlow = isPaper ? Math.min(0.003, env.PUMP_INTRADAY_MIN_FLOW) : env.PUMP_INTRADAY_MIN_FLOW;
      const directionDead = !isPaper && shortMomentum <= 0 && hourMomentum < 1.2;
      if (!momentumHot || flow < minFlow || directionDead) return null;
      return {
        symbol: row.symbol,
        price: row.price,
        change24h: row.change24h,
        volume24h: row.volume24h,
        priorityScore: Number((row.change24h * 0.55 + shortMomentum * 18 + flow * 80).toFixed(2)),
        reason: `intraday-spike 24h=${row.change24h.toFixed(2)}% short=${shortMomentum.toFixed(2)}% flow=${flow.toFixed(3)}`,
        discoveredAt: new Date().toISOString(),
        source: "TOP_GAINER_24H",
      };
    },
    {
      abortSignal: options?.abortSignal,
      selectionDeadlineMs: options?.selectionDeadlineMs,
      workerTimeoutMs: resolveMarketContextTimeoutMs(),
      label: "intraday-spike-discovery",
    },
  );

  return hits
    .filter((row): row is TopGainerDiscoveryItem => Boolean(row))
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, limit);
}

function evaluateStrongGainerFastTrack(candidate: ScannerCandidate, leader: TopGainerDiscoveryItem) {
  const context = candidate.context;
  const assessment = evaluateMomentumBreakout(context);
  const shortMomentum = finite(context.metadata.shortMomentumPercent);
  const flow = finite(context.metadata.shortFlowImbalance);
  const velocity = finite(context.metadata.tradeVelocity);
  const volumeSpike = finite(context.metadata.volumeSpikePercent);
  const change24h = finite(leader.change24h);
  const buyBias = shortMomentum > 0 || flow > 0.015;
  const stillHot =
    shortMomentum >= 0.02 ||
    flow >= 0.02 ||
    (volumeSpike >= 12 && shortMomentum >= -0.08) ||
    (change24h >= 25 && velocity >= 0.02);
  const score = Math.max(
    0,
    Math.min(
      100,
      change24h * 0.72 +
        Math.max(0, shortMomentum) * 16 +
        Math.max(0, flow) * 85 +
        Math.min(18, Math.max(0, volumeSpike) * 0.15) -
        context.spreadPercent * 50 -
        context.fakeSpikeScore * 6,
    ),
  );
  const ok =
    env.PUMP_TOP_GAINER_CONTINUATION_ENABLED &&
    change24h >= 15 &&
    change24h <= env.PUMP_CONTINUATION_MAX_CHANGE_24H &&
    leader.volume24h >= Math.max(80_000, env.SCANNER_MIN_VOLUME_24H * 0.2) &&
    buyBias &&
    stillHot &&
    context.spreadPercent <= 0.32 &&
    context.fakeSpikeScore <= 3.2 &&
    context.pumpRisk <= 88 &&
    score >= 45;
  return {
    ok,
    score: Number(score.toFixed(2)),
    assessment,
    reasons: [
      change24h < 15 ? `24h ${change24h.toFixed(2)}% fast-track dusuk` : "",
      !stillHot ? "strong gainer momentum soguk" : "",
      !buyBias ? "BUY baskisi yok" : "",
    ].filter(Boolean),
    maxMove: Number(Math.max(Math.abs(shortMomentum), Math.abs(context.momentumPercent)).toFixed(4)),
  };
}

async function scanTopPumpCandidates(options?: {
  limit?: number;
  abortSignal?: AbortSignal;
  selectionDeadlineMs?: number;
  maxSymbolsToEvaluate?: number;
  onProgress?: (processed: number, total: number) => void | Promise<void>;
}) {
  const effectiveLimit = pumpCandidateListCap(options?.limit ?? 6);
  const [topGainers, intradaySpikes] = await Promise.all([
    discoverTopGainerSymbols(Math.max(36, env.PUMP_CONTINUATION_SCAN_LIMIT)).catch(() => [] as TopGainerDiscoveryItem[]),
    discoverIntradaySpikeLeaders(env.PUMP_INTRADAY_SCAN_LIMIT, {
      abortSignal: options?.abortSignal,
      selectionDeadlineMs: options?.selectionDeadlineMs,
    }).catch(() => [] as TopGainerDiscoveryItem[]),
  ]);
  const symbols = await resolveWatchlist().catch(() => [] as string[]);
  const leaderMap = new Map<string, TopGainerDiscoveryItem>();
  for (const row of [...topGainers, ...intradaySpikes]) {
    const existing = leaderMap.get(row.symbol);
    if (!existing || row.priorityScore > existing.priorityScore) {
      leaderMap.set(row.symbol, row);
    }
  }
  const hotLeaders = [...leaderMap.values()].sort((a, b) => b.change24h - a.change24h);
  const hotSymbols = hotLeaders.slice(0, Math.max(effectiveLimit * 3, 36)).map((row) => row.symbol);
  const leaderExtras = [...leaderMap.keys()].slice(0, Math.max(effectiveLimit * 2, 24));
  const maxSymbolsToEvaluate =
    typeof options?.maxSymbolsToEvaluate === "number"
      ? Math.max(1, Math.min(96, Math.floor(options.maxSymbolsToEvaluate)))
      : Math.max(effectiveLimit, Math.min(96, Math.max(36, effectiveLimit * 4)));
  const startingCursor = state.cursor, attempted = new Set<string>();
  const scheduled = schedulePumpScan({ leaders: [...hotSymbols, ...leaderExtras], watchlist: symbols,
    cursor: state.cursor, limit: maxSymbolsToEvaluate, discoveryBatchSize: env.PUMP_EARLY_CATCHER_BATCH_SIZE });
  const batch = scheduled.symbols;
  let earlyHits = 0;
  let continuationHits = 0;
  let intradayHits = 0;

  const rows = await mapWithConcurrency(
    batch,
    Math.max(2, Math.min(8, env.SCANNER_CONTEXT_CONCURRENCY)),
    async (symbol, _index, signal): Promise<PumpEarlyCandidate | null> => {
      attempted.add(symbol);
      state.cursor = attemptedPumpCursor(symbols, startingCursor, scheduled.discoverySymbols, attempted);
      const leader = leaderMap.get(symbol);
      const isIntradayLeader = leader?.reason.includes("intraday-spike") ?? false;
      const context = await withBoundedAwait(
        `pump-context:${symbol}`,
        (innerSignal) =>
          buildMarketContext(symbol, {
            lite: false,
            priority: "high",
            signal: innerSignal,
            timeoutMs: resolveMarketContextTimeoutMs(),
            allowBackgroundIntelCapture: false,
          }),
        resolveMarketContextTimeoutMs(),
        undefined,
        undefined,
        { signal },
      );
      const enrichedContext = attachTopGainerMeta(context, leader);
      const score = scoreContext(enrichedContext);
      const candidate: ScannerCandidate = { rank: 1, context: enrichedContext, score };

      const early = evaluatePumpPriority(candidate);
      if (early.ok) {
        earlyHits += 1;
        return buildPumpCandidate({
          candidate,
          assessment: early.assessment,
          priorityScore: early.score,
          reason: `pump-early score=${early.score}, move<=${early.maxMove}%`,
          mode: "early",
          topGainer: leader,
          maxMove: early.maxMove,
        });
      }

      if (leader && leader.change24h >= 15) {
        const strong = evaluateStrongGainerFastTrack(candidate, leader);
        if (strong.ok) {
          continuationHits += 1;
          return buildPumpCandidate({
            candidate,
            assessment: strong.assessment,
            priorityScore: strong.score + 8,
            reason: `pump-strong-gainer 24h=${leader.change24h.toFixed(2)}%, score=${strong.score}`,
            mode: "continuation",
            topGainer: leader,
            maxMove: strong.maxMove,
          });
        }
      }

      if (leader && isIntradayLeader) {
        const intraday = evaluateIntradaySpikeContinuation(candidate, leader);
        if (intraday.ok) {
          intradayHits += 1;
          return buildPumpCandidate({
            candidate,
            assessment: intraday.assessment,
            priorityScore: intraday.score,
            reason: `pump-intraday ${leader.reason}, score=${intraday.score}`,
            mode: "intraday",
            topGainer: leader,
            maxMove: intraday.maxMove,
          });
        }
      }

      if (leader && !isIntradayLeader) {
        const continuation = evaluateTopGainerContinuation(candidate, leader);
        if (continuation.ok) {
          continuationHits += 1;
          return buildPumpCandidate({
            candidate,
            assessment: continuation.assessment,
            priorityScore: continuation.score,
            reason: `pump-continuation 24h=${leader.change24h.toFixed(2)}%, score=${continuation.score}`,
            mode: "continuation",
            topGainer: leader,
            maxMove: continuation.maxMove,
          });
        }
      }
      return null;
    },
    {
      abortSignal: options?.abortSignal,
      selectionDeadlineMs: options?.selectionDeadlineMs,
      workerTimeoutMs: resolveMarketContextTimeoutMs(),
      label: "pump-top-candidates",
      onItemComplete: async (processed, total) => {
        await options?.onProgress?.(processed, total);
      },
    },
  );

  if (attempted.size === batch.length) state.cursor = scheduled.nextCursor;
  const ranked = rows
    .filter((row): row is PumpEarlyCandidate => row !== null)
    .sort((a, b) => b.priorityScore - a.priorityScore);
  const best = ranked[0] ?? null;

  state.lastScanStats = {
    scanned: attempted.size,
    topGainerCount: topGainers.length,
    earlyHits,
    continuationHits,
    intradayHits,
    activeSymbol: best?.candidate.context.symbol,
    activeMode: best?.mode,
  };

  return ranked.slice(0, effectiveLimit);
}

async function scanBestPumpCandidate() {
  const ranked = await scanTopPumpCandidates({ limit: 1 });
  return ranked[0] ?? null;
}

export function resolvePumpRoundMaxWaitSec(input: {
  baseMaxWaitSec: number;
  context: ScannerCandidate["context"];
  explanation?: string;
}) {
  const explanation = String(input.explanation ?? "");
  const isPump =
    Boolean(input.context.metadata.pumpContinuationMode) ||
    Boolean(input.context.metadata.pumpEarlyConfirmed) ||
    Boolean(input.context.metadata.pumpEarlyCatcher) ||
    explanation.includes("PUMP_CONTINUATION") ||
    explanation.includes("PUMP_INTRADAY") ||
    explanation.includes("pump-intraday") ||
    Boolean(input.context.metadata.pumpIntradaySpike);
  if (!isPump) return input.baseMaxWaitSec;

  const change24h = Number(input.context.metadata.topGainerChange24h ?? input.context.change24h ?? 0);
  const pumpPriority = Number(
    input.context.metadata.topGainerPriorityScore ?? input.context.metadata.pumpEarlyPriorityScore ?? 0,
  );
  if (change24h >= env.PUMP_CONTINUATION_EXTREME_CHANGE_24H || pumpPriority >= 92) {
    return Math.max(input.baseMaxWaitSec, env.PUMP_CONTINUATION_EXTREME_DURATION_SEC);
  }
  if (change24h >= env.PUMP_CONTINUATION_STRONG_CHANGE_24H || pumpPriority >= 78) {
    return Math.max(input.baseMaxWaitSec, env.PUMP_CONTINUATION_STRONG_DURATION_SEC);
  }
  return Math.max(input.baseMaxWaitSec, env.PUMP_CONTINUATION_MIN_DURATION_SEC);
}

export async function resolveLiveTopGainerPumpCandidates(options?: {
  forceRefresh?: boolean;
  limit?: number;
  abortSignal?: AbortSignal;
  selectionDeadlineMs?: number;
  maxSymbolsToEvaluate?: number;
  onProgress?: (processed: number, total: number) => void | Promise<void>;
}) {
  if (!env.PUMP_EARLY_CATCHER_ENABLED) return [];
  const limit = pumpCandidateListCap(Number(options?.limit ?? 12));
  const now = Date.now();
  const cacheAgeMs = livePumpListCache.at > 0 ? now - livePumpListCache.at : Number.POSITIVE_INFINITY;
  const cacheHit = !options?.forceRefresh && cacheAgeMs < livePumpCacheTtlMs();
  const topGainerCacheMeta = getTopGainerCacheMeta();
  if (topGainerCacheMeta.stale) {
    recordPumpScanEvent({
      kind: "priority_scan",
      phase: "priorityScan",
      scope: "cache",
      reasonCode: "PUMP_SCAN_CACHE_FALLBACK",
      fallbackUsed: "cache",
      source: "priority",
      message: "PRIORITY_DATA_STALE: top-gainer cache is stale; preferring cache or rotation fallback",
      meta: topGainerCacheMeta,
    });
  }
  recordPumpScanEvent({
    kind: "cache_scan",
    phase: "cacheScan",
    scope: "cache",
    candidateCount: livePumpListCache.value.length,
    reasonCode: cacheHit ? "PUMP_SCAN_COMPLETE" : "PUMP_SCAN_CACHE_FALLBACK",
    fallbackUsed: cacheHit ? "none" : "live_pump_scan",
    source: "cache",
    message: cacheHit
      ? `Pump live cache hit (age=${Math.round(cacheAgeMs)}ms)`
      : `Pump live cache miss (age=${Math.round(cacheAgeMs)}ms)`,
    meta: { cacheHit, cacheMiss: !cacheHit, cacheAgeMs, liveScanTriggered: !cacheHit, topGainerCacheMeta },
  });
  if (cacheHit) {
    return livePumpListCache.value.slice(0, limit);
  }
  const ranked = await scanTopPumpCandidates({
    limit,
    abortSignal: options?.abortSignal,
    selectionDeadlineMs: options?.selectionDeadlineMs,
    maxSymbolsToEvaluate: options?.maxSymbolsToEvaluate,
    onProgress: options?.onProgress,
  });
  livePumpListCache = { at: now, value: ranked };
  livePumpCache = { at: now, value: ranked[0] ?? null };
  if (ranked.length === 0) {
    recordPumpScanEvent({
      kind: "end",
      phase: "end",
      scope: "live",
      reasonCode: "PUMP_SCAN_EMPTY",
      fallbackUsed: "safe_empty",
      source: "live",
      candidateCount: 0,
      message: "Pump live scan completed with empty result",
    });
  }
  return ranked;
}

export async function resolveLiveTopGainerPumpCandidate(options?: { forceRefresh?: boolean }) {
  if (!env.PUMP_EARLY_CATCHER_ENABLED) return null;
  const ranked = await resolveLiveTopGainerPumpCandidates({ ...options, limit: 1 });
  return ranked[0] ?? null;
}

async function tick() {
  if (runLock || !env.PUMP_EARLY_CATCHER_ENABLED) return;
  runLock = true;
  try {
    const ranked = await scanTopPumpCandidates({
      limit: Math.max(12, Math.ceil(env.PUMP_CONTINUATION_SCAN_LIMIT / 3)),
    });
    const now = Date.now();
    livePumpListCache = { at: now, value: ranked };
    const best = ranked[0] ?? null;
    if (best) {
      state.activeCandidate = best;
      livePumpCache = { at: now, value: best };
      pushLog("SIGNAL", `Pump Catcher [${best.mode}]: ${best.candidate.context.symbol} (${best.priorityScore})`);
      logger.info(
        {
          symbol: best.candidate.context.symbol,
          mode: best.mode,
          priorityScore: Number(best.priorityScore.toFixed(2)),
        },
        "Pump Catcher candidate selected",
      );
    } else if (state.activeCandidate && new Date(state.activeCandidate.expiresAt).getTime() < Date.now()) {
      state.activeCandidate = undefined;
    } else {
      const nowMs = Date.now();
      if (nowMs - lastNoCandidateLogAt > 60_000) {
        lastNoCandidateLogAt = nowMs;
        logger.info(
          {
            scanned: state.lastScanStats?.scanned ?? 0,
            topGainerCount: state.lastScanStats?.topGainerCount ?? 0,
            earlyHits: state.lastScanStats?.earlyHits ?? 0,
            continuationHits: state.lastScanStats?.continuationHits ?? 0,
            intradayHits: state.lastScanStats?.intradayHits ?? 0,
          },
          "Pump Catcher scan empty",
        );
      }
    }
    state.lastRunAt = new Date().toISOString();
    state.lastRunOk = true;
    state.lastError = undefined;
    markHeartbeat({
      service: "pump-early-catcher",
      status: "UP",
      message: "Pump watcher tick completed",
      details: state.lastScanStats,
    });
  } catch (error) {
    state.lastRunAt = new Date().toISOString();
    state.lastRunOk = false;
    state.lastError = (error as Error).message;
  } finally {
    runLock = false;
  }
}

export function ensurePumpEarlyCatcherStarted() {
  if (!env.PUMP_EARLY_CATCHER_ENABLED) return { ...state, enabled: false };
  if (env.ENABLE_SEPARATE_WORKER && env.APP_ROLE !== "worker") {
    return { ...state, enabled: false, delegatedToWorker: true };
  }
  if (timer) return { ...state, enabled: true, delegatedToWorker: false };
  state.running = true;
  state.startedAt = new Date().toISOString();
  state.intervalMs = Math.max(5_000, env.PUMP_EARLY_CATCHER_INTERVAL_MS);
  void tick();
  timer = setInterval(() => {
    void tick();
  }, state.intervalMs);
  pushLog(
    "INFO",
    `Pump Early Catcher baslatildi. interval=${state.intervalMs}ms role=${env.APP_ROLE}`,
  );
  logger.info(
    {
      intervalMs: state.intervalMs,
      appRole: env.APP_ROLE,
    },
    "Pump Early Catcher started",
  );
  return { ...state, enabled: true, delegatedToWorker: false };
}

export function getCachedPumpCandidates(limit = 8): PumpEarlyCandidate[] {
  const cap = pumpCandidateListCap(limit);
  const merged = new Map<string, PumpEarlyCandidate>();
  const active = getActivePumpEarlyCandidate();
  if (active) merged.set(active.candidate.context.symbol.toUpperCase(), active);
  for (const row of livePumpListCache.value) {
    const sym = row.candidate.context.symbol.toUpperCase();
    if (!merged.has(sym)) merged.set(sym, row);
  }
  return Array.from(merged.values())
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, cap);
}

export function getPumpEarlyCatcherState() {
  return {
    ...state,
    enabled: env.PUMP_EARLY_CATCHER_ENABLED,
    appRole: env.APP_ROLE,
    liveCacheAgeMs: livePumpCache.at > 0 ? Date.now() - livePumpCache.at : null,
  };
}

export function getActivePumpEarlyCandidate() {
  const active = state.activeCandidate;
  if (!active) return null;
  if (new Date(active.expiresAt).getTime() < Date.now()) {
    state.activeCandidate = undefined;
    return null;
  }
  return active;
}
