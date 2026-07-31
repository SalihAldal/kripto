export type RetryOptions = {
  retries: number;
  minDelayMs: number;
  maxDelayMs: number;
  factor?: number;
  jitter?: boolean;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const factor = options.factor ?? 2;
  let attempt = 0;
  let delay = options.minDelayMs;

  while (true) {
    try {
      return await operation();
    } catch (error) {
      const canRetry = attempt < options.retries && (options.shouldRetry?.(error, attempt) ?? true);
      if (!canRetry) throw error;
      const jitter = options.jitter ? Math.floor(Math.random() * Math.min(delay, 250)) : 0;
      await wait(Math.min(delay + jitter, options.maxDelayMs));
      delay = Math.min(delay * factor, options.maxDelayMs);
      attempt += 1;
    }
  }
}
