import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import {
  CooperativeAsyncTimeoutError,
  withBoundedAwait,
  type AsyncRuntimeTelemetry,
} from "@/src/server/execution/cooperative-async.service";
import { traceCandidateFailed } from "@/src/server/forensics/candidate-lifecycle.service";

export class PumpScanFailedError extends Error {
  readonly code = "PUMP_SCAN_FAILED" as const;
  readonly stage = "scanner" as const;
  readonly blockKind: string;

  constructor(message: string, blockKind: string) {
    super(message);
    this.name = "PumpScanFailedError";
    this.blockKind = blockKind;
  }
}

export type PumpScanLifecycleEvent = {
  at: string;
  kind:
    | "start"
    | "cache_scan"
    | "priority_scan"
    | "live_scan_start"
    | "live_scan_end"
    | "timeout"
    | "fallback"
    | "end"
    | "failed";
  phase?:
    | "start"
    | "cacheScan"
    | "priorityScan"
    | "liveScanStart"
    | "liveScanEnd"
    | "timeout"
    | "fallback"
    | "end";
  scope?: "cache" | "live";
  symbol?: string;
  candidateCount?: number;
  durationMs?: number;
  blockKind?: string;
  reasonCode?:
    | "PUMP_SCAN_TIMEOUT"
    | "PUMP_SCAN_NETWORK_ERROR"
    | "PUMP_SCAN_CACHE_FALLBACK"
    | "PUMP_SCAN_EMPTY"
    | "PUMP_SCAN_COMPLETE"
    | "PUMP_SCAN_ABORTED"
    | "PUMP_SCAN_ERROR";
  fallbackUsed?: "cache" | "scanner_rotation" | "live_pump_scan" | "safe_empty" | "none";
  source?: "cache" | "live" | "rotation" | "priority";
  timeoutMs?: number;
  message: string;
  meta?: Record<string, unknown>;
};

const pumpScanEvents: PumpScanLifecycleEvent[] = [];

export function recordPumpScanEvent(event: Omit<PumpScanLifecycleEvent, "at">) {
  const row: PumpScanLifecycleEvent = { ...event, at: new Date().toISOString() };
  pumpScanEvents.push(row);
  if (pumpScanEvents.length > 500) pumpScanEvents.shift();
  logger.info(
    {
      pumpScanLifecycle: row.kind,
      scope: row.scope,
      durationMs: row.durationMs,
      blockKind: row.blockKind,
      candidateCount: row.candidateCount,
    },
    row.message,
  );
  return row;
}

export function getPumpScanLifecycleEvents(limit = 50) {
  return pumpScanEvents.slice(-limit);
}

export function resetPumpScanLifecycleEvents() {
  pumpScanEvents.length = 0;
}

export function resolvePumpLiveScanTimeoutMs(selectionDeadlineMs?: number) {
  const configured = Math.max(15_000, Math.min(180_000, env.AUTO_ROUND_PUMP_SCAN_TIMEOUT_MS ?? 90_000));
  if (typeof selectionDeadlineMs === "number") {
    const remaining = selectionDeadlineMs - Date.now();
    if (remaining <= 1_000) return 1_000;
    const effectiveRemaining = Math.max(1_000, remaining - 1_000);
    return Math.max(1_000, Math.min(configured, effectiveRemaining));
  }
  return configured;
}

export async function runBoundedLivePumpScan<T>(
  label: string,
  task: ((signal: AbortSignal) => Promise<T>) | (() => Promise<T>),
  input: {
    selectionDeadlineMs?: number;
    telemetry?: AsyncRuntimeTelemetry;
    scope?: "cache" | "live";
    abortSignal?: AbortSignal;
  },
): Promise<T> {
  const timeoutMs = resolvePumpLiveScanTimeoutMs(input.selectionDeadlineMs);
  const started = Date.now();
  recordPumpScanEvent({
    kind: "live_scan_start",
    phase: "liveScanStart",
    scope: input.scope ?? "live",
    timeoutMs,
    source: "live",
    message: `${label} started (timeout=${timeoutMs}ms)`,
  });
  try {
    const result = await withBoundedAwait(
      label,
      (signal) => (task.length > 0 ? (task as (signal: AbortSignal) => Promise<T>)(signal) : (task as () => Promise<T>)()),
      timeoutMs,
      input.telemetry,
      {
        scope: input.scope ?? "live",
        timeoutMs,
      },
      { signal: input.abortSignal },
    );
    recordPumpScanEvent({
      kind: "live_scan_end",
      phase: "liveScanEnd",
      scope: input.scope ?? "live",
      durationMs: Date.now() - started,
      reasonCode: "PUMP_SCAN_COMPLETE",
      fallbackUsed: "none",
      source: "live",
      timeoutMs,
      message: `${label} completed`,
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - started;
    const rawMessage = String((error as Error).message ?? "");
    const lowered = rawMessage.toLowerCase();
    const blockKind =
      error instanceof CooperativeAsyncTimeoutError
        ? "timer"
        : input.abortSignal?.aborted || lowered.includes("abort") || lowered.includes("cancel")
          ? "abort"
          : lowered.includes("binance") || lowered.includes("network") || lowered.includes("timeout")
            ? "network"
            : "other";
    const reasonCode =
      blockKind === "timer"
        ? "PUMP_SCAN_TIMEOUT"
        : blockKind === "abort"
          ? "PUMP_SCAN_ABORTED"
          : blockKind === "network"
            ? "PUMP_SCAN_NETWORK_ERROR"
            : "PUMP_SCAN_ERROR";
    recordPumpScanEvent({
      kind: blockKind === "timer" ? "timeout" : "failed",
      phase: blockKind === "timer" ? "timeout" : undefined,
      scope: input.scope ?? "live",
      durationMs,
      blockKind,
      reasonCode,
      fallbackUsed: "scanner_rotation",
      source: "live",
      timeoutMs,
      message: `${label} failed: ${rawMessage}`,
    });
    traceCandidateFailed({
      symbol: "PUMP_SCAN",
      stage: "scanner",
      reasonCode: "PUMP_SCAN_FAILED",
      reasonDetail: `${label} blocked (${blockKind}): ${rawMessage}`,
    });
    throw new PumpScanFailedError(
      `PUMP_SCAN_FAILED: ${label} exceeded ${timeoutMs}ms (${blockKind})`,
      blockKind,
    );
  }
}
