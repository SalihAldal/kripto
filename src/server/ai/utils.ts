import { logger } from "@/lib/logger";
import { CooperativeAsyncCancelledError } from "@/src/server/execution/cooperative-async.types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const warnThrottle = new Map<string, number>();

function shouldLogWarn(key: string, intervalMs = 10_000) {
  const now = Date.now();
  const last = warnThrottle.get(key) ?? 0;
  if (now - last < intervalMs) return false;
  warnThrottle.set(key, now);
  return true;
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) {
    return Promise.reject(
      new CooperativeAsyncCancelledError(
        signal.reason ? String(signal.reason) : "AI operation aborted",
      ),
    );
  }
  return new Promise((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(
          new CooperativeAsyncCancelledError(
            signal.reason ? String(signal.reason) : "AI operation aborted",
          ),
        );
      },
      { once: true },
    );
  });
}

export async function withAiTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  context: string,
  signal?: AbortSignal,
): Promise<T> {
  let timeoutRef: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutRef = setTimeout(() => reject(new Error(`AI timeout (${context})`)), timeoutMs);
  });
  const abortPromise = signal ? waitForAbort(signal) : null;
  try {
    const racers: Array<Promise<T> | Promise<never>> = [promise, timeoutPromise];
    if (abortPromise) racers.push(abortPromise);
    return await Promise.race(racers);
  } finally {
    if (timeoutRef) clearTimeout(timeoutRef);
  }
}

export async function withAiRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    timeoutMs?: number;
    context: string;
    signal?: AbortSignal;
  } = { context: "ai" },
) {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 4000;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) {
      throw new CooperativeAsyncCancelledError(
        options.signal.reason ? String(options.signal.reason) : "AI retry aborted",
      );
    }
    try {
      return await withAiTimeout(fn(), timeoutMs, `${options.context}#${attempt}`, options.signal);
    } catch (error) {
      lastError = error;
      if (error instanceof CooperativeAsyncCancelledError) throw error;
      if (shouldLogWarn(`${options.context}:${attempt}`, 10_000)) {
        logger.warn(
          {
            context: options.context,
            attempt,
            retries,
            error: (error as Error).message,
          },
          "AI provider attempt failed",
        );
      }
      if (attempt < retries) {
        await sleep(250 * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown AI retry error");
}

export function clampScore(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value.toFixed(2))));
}
