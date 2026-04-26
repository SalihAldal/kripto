import { logger } from "@/lib/logger";
import type { RetryOptions } from "@/src/types/exchange";

const defaultRetry: RetryOptions = {
  retries: 3,
  initialDelayMs: 300,
  maxDelayMs: 2000,
  timeoutMs: 5000,
};

const warnThrottle = new Map<string, number>();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isNonRetryableExchangeError(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return (
    message.includes("ip banned until") ||
    message.includes("too much request weight used") ||
    message.includes("way too much request weight used") ||
    message.includes("too many requests") ||
    message.includes("read econnreset") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("econnrefused")
    || message.includes("operation was aborted")
    || message.includes("aborted")
    || message.includes("insufficient balance")
    || message.includes("code=2202")
    || message.includes("invalid api-key")
    || message.includes("code=3701")
  );
}

function isWeightLimitError(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return message.includes("too much request weight used") || message.includes("way too much request weight used");
}

function isNetworkExchangeError(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return (
    message.includes("read econnreset") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up") ||
    message.includes("etimedout") ||
    message.includes("enotfound") ||
    message.includes("econnrefused")
    || message.includes("operation was aborted")
    || message.includes("aborted")
  );
}

function shouldLogWarn(key: string, intervalMs = 5000) {
  const now = Date.now();
  const last = warnThrottle.get(key) ?? 0;
  if (now - last < intervalMs) return false;
  warnThrottle.set(key, now);
  return true;
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, opName: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${opName} timeout (${timeoutMs}ms)`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function withRetry<T>(
  opName: string,
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const merged = { ...defaultRetry, ...options };
  let delay = merged.initialDelayMs;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= merged.retries; attempt += 1) {
    try {
      const result = await withTimeout(fn(), merged.timeoutMs, opName);
      if (attempt > 0) {
        logger.info({ opName, attempt }, "Retry ile basarili oldu");
      }
      return result;
    } catch (error) {
      lastError = error;
      const nonRetryable = isNonRetryableExchangeError(error);
      const errorMessage = (error as Error).message;
      const isWeight = isWeightLimitError(error);
      const isNetwork = isNetworkExchangeError(error);
      const warnKey = isWeight
        ? "binance:weight-limit-global"
        : isNetwork
          ? "binance:network-global"
          : `${opName}:${errorMessage}`;
      const warnInterval = isWeight || isNetwork ? 30_000 : 5_000;
      if (shouldLogWarn(warnKey, warnInterval)) {
        logger.warn(
          { opName, attempt, retries: merged.retries, nonRetryable, error: errorMessage },
          "Exchange operasyonu hata aldi",
        );
      }
      if (nonRetryable) {
        throw error instanceof Error ? error : new Error(`${opName} non-retryable failure`);
      }
      if (attempt < merged.retries) {
        await sleep(delay);
        delay = Math.min(Math.floor(delay * 1.8), merged.maxDelayMs);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${opName} failed`);
}

export class SimpleRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly queue: number[] = [];

  constructor(maxRequests = 30, windowMs = 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async waitTurn(): Promise<void> {
    const now = Date.now();
    while (this.queue.length && now - this.queue[0] > this.windowMs) {
      this.queue.shift();
    }

    if (this.queue.length < this.maxRequests) {
      this.queue.push(now);
      return;
    }

    const waitMs = this.windowMs - (now - this.queue[0]) + 5;
    await sleep(waitMs);
    return this.waitTurn();
  }
}
