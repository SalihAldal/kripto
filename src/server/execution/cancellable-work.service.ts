import {
  CooperativeAsyncCancelledError,
  CooperativeAsyncTimeoutError,
  type AsyncRuntimeTelemetry,
} from "@/src/server/execution/cooperative-async.types";

export type CancellableWorkOptions = {
  signal?: AbortSignal;
  telemetry?: AsyncRuntimeTelemetry;
  meta?: Record<string, unknown>;
};

export function throwIfAborted(signal?: AbortSignal, message = "Operation aborted") {
  if (signal?.aborted) {
    throw new CooperativeAsyncCancelledError(
      signal.reason ? `${message}: ${String(signal.reason)}` : message,
    );
  }
}

/** Yield one event-loop turn between heavy sync phases to avoid stack-depth accumulation. */
export function yieldAsyncStackUnwind(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Run a deep synchronous function on a fresh stack frame (same semantics, lower overflow risk). */
export function runOnFreshStack<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(fn());
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function linkAbortSignal(parent?: AbortSignal, reason?: string): AbortController {
  const controller = new AbortController();
  if (!parent) return controller;
  if (parent.aborted) {
    controller.abort(parent.reason ?? reason ?? "Parent aborted");
    return controller;
  }
  const handler = () => controller.abort(parent.reason ?? reason ?? "Parent aborted");
  parent.addEventListener("abort", handler, { once: true });
  return controller;
}

export function remainingMsUntil(deadlineMs?: number) {
  if (typeof deadlineMs !== "number") return Number.POSITIVE_INFINITY;
  return Math.max(0, deadlineMs - Date.now());
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(
      new CooperativeAsyncCancelledError(
        signal.reason ? String(signal.reason) : "Operation aborted",
      ),
    );
  }
  return new Promise((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(
          new CooperativeAsyncCancelledError(
            signal.reason ? String(signal.reason) : "Operation aborted",
          ),
        );
      },
      { once: true },
    );
  });
}

/**
 * Runs work with timeout + parent abort propagation. Timeout aborts the local controller.
 */
export async function withCancellableBoundedAwait<T>(
  label: string,
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  options?: CancellableWorkOptions,
): Promise<T> {
  const local = linkAbortSignal(options?.signal);
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;

  const pushTelemetry = (kind: "promise_start" | "promise_complete" | "promise_timeout" | "promise_cancel" | "promise_fail", message: string) => {
    const telemetry = options?.telemetry;
    if (!telemetry) return;
    if (kind === "promise_start") telemetry.promiseStarted += 1;
    if (kind === "promise_complete") telemetry.promiseCompleted += 1;
    if (kind === "promise_timeout") telemetry.promiseTimedOut += 1;
    if (kind === "promise_cancel") telemetry.promiseCancelled += 1;
    if (kind === "promise_fail") telemetry.promiseFailed += 1;
    const awaitMs = Date.now() - started;
    telemetry.maxAwaitMs = Math.max(telemetry.maxAwaitMs, awaitMs);
    telemetry.events.push({ at: new Date().toISOString(), kind, label, message, awaitMs, meta: options?.meta });
    if (telemetry.events.length > 200) telemetry.events.shift();
  };

  pushTelemetry("promise_start", `start ${label}`);
  throwIfAborted(local.signal, label);

  try {
    const result = await Promise.race([
      work(local.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const message = `${label} timed out after ${timeoutMs}ms`;
          reject(new CooperativeAsyncTimeoutError(message));
          local.abort(message);
        }, Math.max(1, timeoutMs));
      }),
      waitForAbort(local.signal),
    ]);
    pushTelemetry("promise_complete", `complete ${label}`);
    return result;
  } catch (error) {
    local.abort(error instanceof Error ? error.message : "cancelled");
    if (error instanceof CooperativeAsyncTimeoutError) {
      pushTelemetry("promise_timeout", error.message);
      throw error;
    }
    if (error instanceof CooperativeAsyncCancelledError || local.signal.aborted) {
      pushTelemetry("promise_cancel", (error as Error).message);
      throw error instanceof CooperativeAsyncCancelledError
        ? error
        : new CooperativeAsyncCancelledError((error as Error).message);
    }
    pushTelemetry("promise_fail", (error as Error).message);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    if (!local.signal.aborted) local.abort("cleanup");
  }
}

export async function runWithAbortSignal<T>(
  work: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  return work(signal ?? new AbortController().signal);
}
