import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";

/** Maximum allowed clock skew — do not raise without explicit policy change. */
export const MAX_CLOCK_SKEW_MS = 5_000;

export type ClockSyncForensics = {
  localTime: string;
  localTimeMs: number;
  serverTime: string;
  serverTimeMs: number;
  rawServerTime: number;
  clockOffsetMs: number;
  clockSkewMs: number;
  measuredLatencyMs: number;
  skewThresholdMs: number;
  timestampSource: string;
  sampleTimestamp: string;
  attempt: number;
  endpoint: string;
  passed: boolean;
  staleServerTime: boolean;
  unitConversionApplied: boolean;
  rootCauseHint?: string;
};

export type ClockSyncEvaluation = {
  ok: boolean;
  skewMs: number;
  forensics: ClockSyncForensics;
};

/**
 * Binance returns epoch milliseconds (13 digits). Values below 1e12 are treated as seconds.
 */
export function normalizeServerTimeToMs(raw: number): { ms: number; unitConversionApplied: boolean } {
  if (!Number.isFinite(raw) || raw <= 0) {
    return { ms: 0, unitConversionApplied: false };
  }
  if (raw < 1_000_000_000_000) {
    return { ms: Math.round(raw * 1000), unitConversionApplied: true };
  }
  return { ms: Math.round(raw), unitConversionApplied: false };
}

function resolveTimeEndpoints(): string[] {
  const primary = env.BINANCE_TR_HTTP_BASE.replace(/\/+$/, "");
  const endpoints = [
    `${primary}/api/v3/time`,
    "https://api.binance.me/api/v3/time",
    "https://api.binance.com/api/v3/time",
  ];
  return Array.from(new Set(endpoints));
}

function parseServerTimePayload(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const row = payload as Record<string, unknown>;
  const candidates = [row.serverTime, row.timestamp, row.time];
  for (const candidate of candidates) {
    const value = Number(candidate ?? 0);
    if (Number.isFinite(value) && value > 0) return value;
  }
  const nested = row.data;
  if (nested && typeof nested === "object") {
    return parseServerTimePayload(nested);
  }
  return 0;
}

export async function fetchFreshBinanceServerTime(input?: {
  attempt?: number;
  endpoint?: string;
  timeoutMs?: number;
}): Promise<{
  rawServerTime: number;
  serverTimeMs: number;
  measuredLatencyMs: number;
  endpoint: string;
  attempt: number;
  unitConversionApplied: boolean;
  timestampSource: string;
}> {
  const attempt = input?.attempt ?? 1;
  const endpoints = input?.endpoint ? [input.endpoint] : resolveTimeEndpoints();
  const timeoutMs = input?.timeoutMs ?? 7_000;
  let lastError: Error | null = null;

  for (const endpoint of endpoints) {
    const sampleStarted = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const measuredLatencyMs = Date.now() - sampleStarted;
      const payload = (await response.json()) as unknown;
      const rawServerTime = parseServerTimePayload(payload);
      if (!Number.isFinite(rawServerTime) || rawServerTime <= 0) {
        throw new Error(`Missing server time in response from ${endpoint}`);
      }
      const normalized = normalizeServerTimeToMs(rawServerTime);
      return {
        rawServerTime,
        serverTimeMs: normalized.ms,
        measuredLatencyMs,
        endpoint,
        attempt,
        unitConversionApplied: normalized.unitConversionApplied,
        timestampSource: "binance.api.v3.time",
      };
    } catch (error) {
      lastError = error as Error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Unable to fetch Binance server time");
}

export async function evaluateClockSync(input?: {
  maxSkewMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}): Promise<ClockSyncEvaluation> {
  const skewThresholdMs = input?.maxSkewMs ?? MAX_CLOCK_SKEW_MS;
  const maxAttempts = Math.max(1, input?.maxAttempts ?? 2);
  const retryDelayMs = input?.retryDelayMs ?? 250;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const sample = await fetchFreshBinanceServerTime({ attempt });
      const localTimeMs = Date.now();
      const clockOffsetMs = sample.serverTimeMs - localTimeMs;
      const clockSkewMs = Math.abs(clockOffsetMs);
      const passed = clockSkewMs <= skewThresholdMs;
      const forensics: ClockSyncForensics = {
        localTime: new Date(localTimeMs).toISOString(),
        localTimeMs,
        serverTime: new Date(sample.serverTimeMs).toISOString(),
        serverTimeMs: sample.serverTimeMs,
        rawServerTime: sample.rawServerTime,
        clockOffsetMs,
        clockSkewMs,
        measuredLatencyMs: sample.measuredLatencyMs,
        skewThresholdMs,
        timestampSource: sample.timestampSource,
        sampleTimestamp: new Date().toISOString(),
        attempt: sample.attempt,
        endpoint: sample.endpoint,
        passed,
        staleServerTime: false,
        unitConversionApplied: sample.unitConversionApplied,
        rootCauseHint: passed ? undefined : "FRESH_SERVER_TIME_SKEW",
      };
      return { ok: passed, skewMs: clockSkewMs, forensics };
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }

  const localTimeMs = Date.now();
  const forensics: ClockSyncForensics = {
    localTime: new Date(localTimeMs).toISOString(),
    localTimeMs,
    serverTime: "",
    serverTimeMs: 0,
    rawServerTime: 0,
    clockOffsetMs: 0,
    clockSkewMs: Number.POSITIVE_INFINITY,
    measuredLatencyMs: 0,
    skewThresholdMs,
    timestampSource: "binance.api.v3.time",
    sampleTimestamp: new Date().toISOString(),
    attempt: maxAttempts,
    endpoint: resolveTimeEndpoints()[0],
    passed: false,
    staleServerTime: false,
    unitConversionApplied: false,
    rootCauseHint: lastError?.message ?? "SERVER_TIME_FETCH_FAILED",
  };
  return { ok: false, skewMs: Number.POSITIVE_INFINITY, forensics };
}

export function persistClockSyncForensics(
  forensics: ClockSyncForensics,
  input?: { sessionId?: string; roundId?: string; executionId?: string },
) {
  const payload = {
    ...forensics,
    executionId: input?.executionId ?? null,
    sessionId: input?.sessionId ?? null,
    roundId: input?.roundId ?? null,
    persistedAt: new Date().toISOString(),
  };

  if (input?.sessionId) {
    const sessionRoot = path.join(process.cwd(), "artifacts", "forensics", input.sessionId);
    mkdirSync(sessionRoot, { recursive: true });
    writeFileSync(path.join(sessionRoot, "clock-sync-forensics.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    if (input.roundId) {
      const roundRoot = path.join(sessionRoot, "rounds", input.roundId);
      mkdirSync(roundRoot, { recursive: true });
      writeFileSync(path.join(roundRoot, "clock-sync-forensics.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    }
  } else {
    const root = path.join(process.cwd(), "artifacts", "forensics", "clock-sync");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      path.join(root, `clock-sync-forensics-${Date.now()}.json`),
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  }
}

/** Detect stale exchangeInfo.serverTime misuse (cached snapshot, not live clock). */
export function evaluateStaleExchangeInfoClock(input: {
  serverTimeMs: number;
  cacheAgeMs: number;
  maxCacheAgeMs?: number;
}): { skewMs: number; staleServerTime: boolean; rootCauseHint: string } {
  const maxCacheAgeMs = input.maxCacheAgeMs ?? 60_000;
  const staleServerTime = input.cacheAgeMs > maxCacheAgeMs;
  const adjustedServerTimeMs = staleServerTime
    ? input.serverTimeMs + input.cacheAgeMs
    : input.serverTimeMs;
  const skewMs = Math.abs(Date.now() - adjustedServerTimeMs);
  return {
    skewMs,
    staleServerTime,
    rootCauseHint: staleServerTime ? "STALE_EXCHANGE_INFO_SERVER_TIME" : "EXCHANGE_INFO_SERVER_TIME",
  };
}
