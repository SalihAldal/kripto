import { prisma } from "@/src/server/db/prisma";
import { logger } from "@/lib/logger";
import { computeOneHorizon, computeReachTimes, type PricePoint } from "@/src/server/shadow-outcome/metrics";
import { OUTCOME_HORIZONS_MIN, type HorizonOutcome, type OutcomeHorizonMin } from "@/src/server/shadow-outcome/types";

const DEFAULT_GAP_MS = 120_000;

type PendingReason =
  | "HORIZON_NOT_REACHED"
  | "FINALIZER_NOT_RUNNING"
  | "MARKET_HISTORY_MISSING"
  | "MARKET_DATA_GAP"
  | "CANDIDATE_NOT_REGISTERED"
  | "PROCESS_RESTART_LOSS"
  | "WORKER_NOT_BOOTSTRAPPED"
  | "PERSISTENCE_ERROR"
  | "UNKNOWN";

export type ShadowOutcomePendingForensicRow = {
  candidateId: string;
  symbol: string;
  detectedAt: string;
  currentAgeMs: number;
  required60mReached: boolean;
  marketHistoryAvailable: boolean;
  trackingWorkerSeen: boolean;
  outcomeRecordExists: boolean;
  lastOutcomeUpdateAt: string | null;
  pendingReason: PendingReason;
};

function toPoints(candles: Array<{ openTime: number; close: number; high: number; low: number }>): PricePoint[] {
  return candles.map((row) => ({
    t: row.openTime,
    price: row.close,
    high: row.high,
    low: row.low,
  }));
}

function dedupeCandles(rows: Array<{ openTime: number; close: number; high: number; low: number }>) {
  const map = new Map<number, { openTime: number; close: number; high: number; low: number }>();
  for (const row of rows) map.set(row.openTime, row);
  return [...map.values()].sort((a, b) => a.openTime - b.openTime);
}

async function loadLocalMarketHistory(symbol: string, detectedAt: Date, untilMs: number) {
  const [pair, events] = await Promise.all([
    prisma.tradingPair.findFirst({
      where: { symbol: symbol.toUpperCase() },
      select: { id: true },
    }),
    prisma.tradeEventLog.findMany({
      where: {
        symbol: symbol.toUpperCase(),
        createdAt: { gte: detectedAt, lte: new Date(untilMs) },
        price: { not: null },
      },
      orderBy: { createdAt: "asc" },
      take: 10000,
      select: { createdAt: true, price: true },
    }),
  ]);
  const snapshots = pair
    ? await prisma.marketSnapshot.findMany({
        where: {
          tradingPairId: pair.id,
          snapshotAt: { gte: detectedAt, lte: new Date(untilMs) },
        },
        orderBy: { snapshotAt: "asc" },
        take: 20000,
        select: { snapshotAt: true, lastPrice: true, askPrice: true, bidPrice: true },
      })
    : [];
  const fromSnapshots = snapshots.map((row) => ({
    openTime: row.snapshotAt.getTime(),
    close: row.lastPrice,
    high: Math.max(row.lastPrice, row.askPrice, row.bidPrice),
    low: Math.min(row.lastPrice, row.askPrice, row.bidPrice),
  }));
  const fromEvents = events
    .filter((row) => Number.isFinite(row.price) && (row.price ?? 0) > 0)
    .map((row) => ({
      openTime: row.createdAt.getTime(),
      close: row.price ?? 0,
      high: row.price ?? 0,
      low: row.price ?? 0,
    }));
  return dedupeCandles([...fromSnapshots, ...fromEvents]);
}

function normalizeHorizonStatus(row: Record<string, unknown>): HorizonOutcome["status"] {
  const explicit = String(row.status ?? "").toUpperCase();
  if (explicit === "PENDING" || explicit === "COMPLETE" || explicit === "INVALID_DATA" || explicit === "HISTORY_UNAVAILABLE") {
    return explicit;
  }
  const complete = row.complete === true;
  const quality = String(row.quality ?? "OUTCOME_DATA_INCOMPLETE");
  if (!complete) return "PENDING";
  if (quality === "OK") return "COMPLETE";
  if (quality === "HISTORY_UNAVAILABLE") return "HISTORY_UNAVAILABLE";
  return "INVALID_DATA";
}

function pendingReasonFromOutcome(row: Record<string, unknown>, matured60m: boolean): PendingReason {
  const status = normalizeHorizonStatus(row);
  if (status !== "PENDING") {
    if (status === "HISTORY_UNAVAILABLE") return "MARKET_HISTORY_MISSING";
    if (status === "INVALID_DATA") return "MARKET_DATA_GAP";
    return "UNKNOWN";
  }
  if (!matured60m) return "HORIZON_NOT_REACHED";
  return "PROCESS_RESTART_LOSS";
}

function mergeOutcomes(existing: unknown, computed: HorizonOutcome[]): HorizonOutcome[] {
  const byHorizon = new Map<number, HorizonOutcome>();
  if (Array.isArray(existing)) {
    for (const item of existing) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const horizonMin = Number(rec.horizonMin);
      if (!Number.isFinite(horizonMin)) continue;
      const status = normalizeHorizonStatus(rec);
      byHorizon.set(horizonMin, {
        horizonMin: horizonMin as OutcomeHorizonMin,
        mfePct: typeof rec.mfePct === "number" ? rec.mfePct : null,
        maePct: typeof rec.maePct === "number" ? rec.maePct : null,
        returnPct: typeof rec.returnPct === "number" ? rec.returnPct : null,
        timeToMfeMs: typeof rec.timeToMfeMs === "number" ? rec.timeToMfeMs : null,
        timeToMaeMs: typeof rec.timeToMaeMs === "number" ? rec.timeToMaeMs : null,
        complete: status !== "PENDING",
        quality: rec.quality === "OK" ? "OK" : rec.quality === "HISTORY_UNAVAILABLE" ? "HISTORY_UNAVAILABLE" : "OUTCOME_DATA_INCOMPLETE",
        status,
        invalidReason: typeof rec.invalidReason === "string" ? rec.invalidReason : null,
      });
    }
  }
  for (const row of computed) byHorizon.set(row.horizonMin, row);
  return OUTCOME_HORIZONS_MIN.map((horizonMin) => {
    const value = byHorizon.get(horizonMin);
    return (
      value ?? {
        horizonMin,
        mfePct: null,
        maePct: null,
        returnPct: null,
        timeToMfeMs: null,
        timeToMaeMs: null,
        complete: false,
        quality: "OUTCOME_DATA_INCOMPLETE",
        status: "PENDING",
        invalidReason: null,
      }
    );
  });
}

export async function finalizeShadowOutcomes(input: {
  now?: number;
  limit?: number;
  includeNotMatured?: boolean;
} = {}) {
  const now = input.now ?? Date.now();
  const limit = Math.max(1, Math.min(5000, input.limit ?? 1000));
  const maturedCutoff = new Date(now - 60_000);
  const candidates = await prisma.shadowCandidateOutcome.findMany({
    where: {
      source: "live",
      detectedAt: input.includeNotMatured ? undefined : { lte: maturedCutoff },
    },
    orderBy: { detectedAt: "asc" },
    take: limit,
  });

  let scanned = 0;
  let finalized = 0;
  let unchanged = 0;

  for (const row of candidates) {
    scanned += 1;
    const candles = await loadLocalMarketHistory(row.symbol, row.detectedAt, now);
    const points = toPoints(candles);
    const computed = OUTCOME_HORIZONS_MIN.map((horizonMin) =>
      computeOneHorizon({
        detectedAt: row.detectedAt.getTime(),
        detectionPrice: row.firstDetectionPrice,
        points,
        now,
        gapMs: DEFAULT_GAP_MS,
        horizonMin,
        lookaheadSafe: true,
      }),
    );
    const mergedOutcomes = mergeOutcomes(row.outcomes, computed);
    const mergedReachTimes = computeReachTimes({
      detectedAt: row.detectedAt.getTime(),
      detectionPrice: row.firstDetectionPrice,
      points,
      now,
      lookaheadSafe: true,
    });
    const before = JSON.stringify(row.outcomes ?? null);
    const after = JSON.stringify(mergedOutcomes);
    if (before === after) {
      unchanged += 1;
      continue;
    }
    await prisma.shadowCandidateOutcome.update({
      where: { candidateId: row.candidateId },
      data: {
        outcomes: mergedOutcomes,
        reachTimes: mergedReachTimes,
        invalidReason:
          mergedOutcomes.some((item) => item.status === "INVALID_DATA")
            ? "MARKET_DATA_GAP"
            : mergedOutcomes.some((item) => item.status === "HISTORY_UNAVAILABLE")
              ? "MARKET_HISTORY_MISSING"
              : row.invalidReason,
      },
    });
    finalized += 1;
  }

  return { scanned, finalized, unchanged };
}

export async function analyzePendingShadowOutcomes(input: { now?: number; limit?: number } = {}) {
  const now = input.now ?? Date.now();
  const rows = await prisma.shadowCandidateOutcome.findMany({
    where: { source: "live" },
    orderBy: { detectedAt: "asc" },
    take: Math.max(1, Math.min(10_000, input.limit ?? 5000)),
    select: {
      candidateId: true,
      symbol: true,
      detectedAt: true,
      outcomes: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const forensic: ShadowOutcomePendingForensicRow[] = [];
  for (const row of rows) {
    const ageMs = now - row.detectedAt.getTime();
    const reached60m = ageMs >= 60 * 60_000;
    const localCandles = await loadLocalMarketHistory(row.symbol, row.detectedAt, now);
    const marketHistoryAvailable = localCandles.length > 0;
    const outcomes = Array.isArray(row.outcomes) ? (row.outcomes as Array<Record<string, unknown>>) : [];
    const sixty = outcomes.find((item) => Number(item.horizonMin) === 60);
    const status = sixty ? normalizeHorizonStatus(sixty) : "PENDING";
    if (status !== "PENDING") continue;
    forensic.push({
      candidateId: row.candidateId,
      symbol: row.symbol,
      detectedAt: row.detectedAt.toISOString(),
      currentAgeMs: ageMs,
      required60mReached: reached60m,
      marketHistoryAvailable,
      trackingWorkerSeen: row.updatedAt.getTime() > row.createdAt.getTime(),
      outcomeRecordExists: true,
      lastOutcomeUpdateAt: row.updatedAt?.toISOString?.() ?? null,
      pendingReason: sixty
        ? pendingReasonFromOutcome(sixty, reached60m)
        : reached60m
          ? marketHistoryAvailable
            ? "FINALIZER_NOT_RUNNING"
            : "MARKET_HISTORY_MISSING"
          : "HORIZON_NOT_REACHED",
    });
  }
  return forensic;
}

export type SettlementStatus = {
  campaignId: string | null;
  runId: string;
  eligibleCandidates: number;
  m60Complete: number;
  m60Pending: number;
  invalid: number;
  historyUnavailable: number;
  progressPercent: number;
  status: "FINAL_VALID" | "PROVISIONAL" | "NO_MEASUREMENT_DATA" | "INVALID_CAMPAIGN_DATASET";
};

const settlementMode = new Map<string, { enabledAt: string }>();

export function beginSettlementMode(runId: string) {
  const normalized = runId.trim();
  if (!normalized) throw new Error("runId is required");
  settlementMode.set(normalized, { enabledAt: new Date().toISOString() });
  return { runId: normalized, enabledAt: settlementMode.get(normalized)?.enabledAt ?? null };
}

export function resolveSettlementStatus(input: {
  eligibleCandidates: number;
  m60Pending: number;
  invalid: number;
  historyUnavailable: number;
}) {
  if (input.m60Pending > 0) return "PROVISIONAL" as const;
  if (input.eligibleCandidates === 0) return "NO_MEASUREMENT_DATA" as const;
  if (input.invalid + input.historyUnavailable >= input.eligibleCandidates) return "INVALID_CAMPAIGN_DATASET" as const;
  return "FINAL_VALID" as const;
}

export async function getSettlementStatus(input: string | { runId: string; campaignId?: string | null }): Promise<SettlementStatus> {
  const runId = typeof input === "string" ? input : input.runId;
  const campaignId = typeof input === "string" ? null : (input.campaignId ?? null);
  const normalized = runId.trim();
  const rows = campaignId
    ? await prisma.$queryRawUnsafe<Array<{ outcomes: unknown }>>(
        `SELECT "outcomes" FROM "ShadowCandidateOutcome" WHERE "campaignId" = $1`,
        campaignId,
      )
    : await prisma.$queryRawUnsafe<Array<{ outcomes: unknown }>>(
        `SELECT "outcomes" FROM "ShadowCandidateOutcome" WHERE "runId" = $1`,
        normalized,
      );
  const evaluate = (value: unknown): HorizonOutcome["status"] => {
    if (!Array.isArray(value)) return "PENDING";
    const sixty = value.find((item) => Number((item as Record<string, unknown>).horizonMin) === 60) as
      | Record<string, unknown>
      | undefined;
    if (!sixty) return "PENDING";
    return normalizeHorizonStatus(sixty);
  };
  const statuses = rows.map((row) => evaluate(row.outcomes));
  const m60Complete = statuses.filter((row) => row === "COMPLETE").length;
  const m60Pending = statuses.filter((row) => row === "PENDING").length;
  const invalid = statuses.filter((row) => row === "INVALID_DATA").length;
  const historyUnavailable = statuses.filter((row) => row === "HISTORY_UNAVAILABLE").length;
  const eligibleCandidates = rows.length;
  const terminal = m60Complete + invalid + historyUnavailable;
  const progressPercent = eligibleCandidates > 0 ? Number(((terminal / eligibleCandidates) * 100).toFixed(2)) : 0;
  return {
    campaignId,
    runId: normalized,
    eligibleCandidates,
    m60Complete,
    m60Pending,
    invalid,
    historyUnavailable,
    progressPercent,
    status: resolveSettlementStatus({ eligibleCandidates, m60Pending, invalid, historyUnavailable }),
  };
}

let finalizerTimer: ReturnType<typeof setInterval> | null = null;
let finalizerStartedAt: string | null = null;
let lastFinalizerResult: { scanned: number; finalized: number; unchanged: number; at: string } | null = null;

export function ensureShadowOutcomeFinalizerStarted(intervalMs = 60_000) {
  if (finalizerTimer) return getShadowOutcomeFinalizerState();
  finalizerStartedAt = new Date().toISOString();
  const tick = async () => {
    try {
      const result = await finalizeShadowOutcomes({ limit: 1000 });
      lastFinalizerResult = { ...result, at: new Date().toISOString() };
    } catch (error) {
      logger.warn({ error: (error as Error).message }, "Shadow outcome finalizer tick failed");
    }
  };
  void tick();
  finalizerTimer = setInterval(() => {
    void tick();
  }, Math.max(30_000, intervalMs));
  return getShadowOutcomeFinalizerState();
}

export function getShadowOutcomeFinalizerState() {
  return {
    running: finalizerTimer != null,
    startedAt: finalizerStartedAt,
    lastResult: lastFinalizerResult,
  };
}

export function stopShadowOutcomeFinalizerForTests() {
  if (finalizerTimer) clearInterval(finalizerTimer);
  finalizerTimer = null;
  finalizerStartedAt = null;
  lastFinalizerResult = null;
}
