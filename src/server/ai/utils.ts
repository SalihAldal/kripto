import { logger } from "@/lib/logger";

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

export async function withAiTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> {
  let timeoutRef: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutRef = setTimeout(() => reject(new Error(`AI timeout (${context})`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutRef) clearTimeout(timeoutRef);
  }
}

export async function withAiRetry<T>(
  fn: () => Promise<T>,
  options: { retries?: number; timeoutMs?: number; context: string } = { context: "ai" },
) {
  const retries = options.retries ?? 2;
  const timeoutMs = options.timeoutMs ?? 4000;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withAiTimeout(fn(), timeoutMs, `${options.context}#${attempt}`);
    } catch (error) {
      lastError = error;
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
