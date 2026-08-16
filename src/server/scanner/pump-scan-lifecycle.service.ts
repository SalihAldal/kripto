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
  kind: "start" | "cache_scan" | "live_scan_start" | "live_scan_end" | "end" | "failed";
  scope?: "cache" | "live";
  symbol?: string;
  candidateCount?: number;
  durationMs?: number;
  blockKind?: string;
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
  if (typeof selectionDeadlineMs === "number" && selectionDeadlineMs > Date.now()) {
    const remaining = selectionDeadlineMs - Date.now();
    return Math.max(15_000, Math.min(configured, remaining - 5_000));
  }
  return configured;
}

export async function runBoundedLivePumpScan<T>(
  label: string,
  task: () => Promise<T>,
  input: {
    selectionDeadlineMs?: number;
    telemetry?: AsyncRuntimeTelemetry;
    scope?: "cache" | "live";
  },
): Promise<T> {
  const timeoutMs = resolvePumpLiveScanTimeoutMs(input.selectionDeadlineMs);
  const started = Date.now();
  recordPumpScanEvent({
    kind: "live_scan_start",
    scope: input.scope ?? "live",
    message: `${label} started (timeout=${timeoutMs}ms)`,
  });
  try {
    const result = await withBoundedAwait(label, task(), timeoutMs, input.telemetry, {
      scope: input.scope ?? "live",
      timeoutMs,
    });
    recordPumpScanEvent({
      kind: "live_scan_end",
      scope: input.scope ?? "live",
      durationMs: Date.now() - started,
      message: `${label} completed`,
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - started;
    const blockKind =
      error instanceof CooperativeAsyncTimeoutError
        ? "timer"
        : String((error as Error).message).toLowerCase().includes("binance")
          ? "network"
          : "other";
    recordPumpScanEvent({
      kind: "failed",
      scope: input.scope ?? "live",
      durationMs,
      blockKind,
      message: `${label} failed: ${(error as Error).message}`,
    });
    traceCandidateFailed({
      symbol: "PUMP_SCAN",
      stage: "scanner",
      reasonCode: "PUMP_SCAN_FAILED",
      reasonDetail: `${label} blocked (${blockKind}): ${(error as Error).message}`,
    });
    throw new PumpScanFailedError(
      `PUMP_SCAN_FAILED: ${label} exceeded ${timeoutMs}ms (${blockKind})`,
      blockKind,
    );
  }
}
