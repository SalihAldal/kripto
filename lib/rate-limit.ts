const WINDOW_MS = 60_000;
const MAX_REQUESTS = 80;

const memory = new Map<string, { count: number; resetAt: number }>();

export function applyRateLimit(key: string) {
  const now = Date.now();
  const current = memory.get(key);

  if (!current || current.resetAt < now) {
    memory.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { ok: true, remaining: MAX_REQUESTS - 1 };
  }

  if (current.count >= MAX_REQUESTS) {
    return { ok: false, remaining: 0 };
  }

  current.count += 1;
  memory.set(key, current);
  return { ok: true, remaining: MAX_REQUESTS - current.count };
}
