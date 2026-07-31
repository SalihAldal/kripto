import type { ExchangePluginType } from "@prisma/client";

type RateLimitState = {
  tokens: number;
  maxTokens: number;
  refillRate: number;
  lastRefill: number;
  backoffUntil: number;
  priorityQueue: Array<{ fn: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void; priority: number }>;
};

const limiters = new Map<ExchangePluginType, RateLimitState>();

function getLimiter(pluginType: ExchangePluginType, maxPerMin = 1200): RateLimitState {
  if (!limiters.has(pluginType)) {
    limiters.set(pluginType, {
      tokens: maxPerMin,
      maxTokens: maxPerMin,
      refillRate: maxPerMin / 60_000,
      lastRefill: Date.now(),
      backoffUntil: 0,
      priorityQueue: [],
    });
  }
  return limiters.get(pluginType)!;
}

function refill(state: RateLimitState) {
  const now = Date.now();
  const elapsed = now - state.lastRefill;
  state.tokens = Math.min(state.maxTokens, state.tokens + elapsed * state.refillRate);
  state.lastRefill = now;
}

export async function withRateLimit<T>(
  pluginType: ExchangePluginType,
  fn: () => Promise<T>,
  priority = 5,
  maxPerMin = 1200,
): Promise<T> {
  const state = getLimiter(pluginType, maxPerMin);
  const now = Date.now();

  if (now < state.backoffUntil) {
    await new Promise((r) => setTimeout(r, state.backoffUntil - now));
  }

  refill(state);

  if (state.tokens < 1) {
    return new Promise<T>((resolve, reject) => {
      state.priorityQueue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
        priority,
      });
      state.priorityQueue.sort((a, b) => a.priority - b.priority);
    });
  }

  state.tokens -= 1;
  try {
    return await fn();
  } catch (error) {
    const msg = (error as Error).message ?? "";
    if (msg.includes("429") || msg.includes("rate limit") || msg.includes("-1003")) {
      state.backoffUntil = Date.now() + 5000;
      state.tokens = 0;
    }
    throw error;
  } finally {
    const next = state.priorityQueue.shift();
    if (next && state.tokens >= 1) {
      state.tokens -= 1;
      void next.fn().then(next.resolve).catch(next.reject);
    }
  }
}

export function getRateLimitStatus(pluginType: ExchangePluginType) {
  const state = getLimiter(pluginType);
  refill(state);
  return {
    tokens: Math.floor(state.tokens),
    maxTokens: state.maxTokens,
    backoffUntil: state.backoffUntil > Date.now() ? new Date(state.backoffUntil).toISOString() : null,
    queueLength: state.priorityQueue.length,
  };
}
