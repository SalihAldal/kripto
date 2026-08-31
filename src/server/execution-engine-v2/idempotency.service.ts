import { env } from "@/lib/config";
import { getExecutionLogByIdempotencyKey } from "@/src/server/execution-engine-v2/execution-engine-v2.repository";

const memoryKeys = new Map<string, { executionId: string; expiresAt: number }>();

export function buildIdempotencyKey(input: {
  userId: string;
  symbol: string;
  side: string;
  candidateId?: string;
  executionIntentId?: string;
  scope?: "ENTRY" | "EXIT";
  windowMs?: number;
}) {
  const scope = input.scope ?? "ENTRY";
  const candidateId = String(input.candidateId ?? "").trim();
  if (candidateId) {
    return `${input.userId}:${scope}:${candidateId}:${input.side}`;
  }
  const executionIntentId = String(input.executionIntentId ?? "").trim();
  if (executionIntentId) {
    return `${input.userId}:${scope}:intent:${executionIntentId}:${input.side}`;
  }
  const bucket = Math.floor(Date.now() / (input.windowMs ?? env.EXECUTION_ENGINE_V2_IDEMPOTENCY_TTL_MS));
  return `${input.userId}:${scope}:${input.symbol.toUpperCase()}:${input.side}:${bucket}`;
}

export async function checkIdempotency(idempotencyKey: string) {
  const mem = memoryKeys.get(idempotencyKey);
  if (mem && mem.expiresAt > Date.now()) {
    return { duplicate: true, executionId: mem.executionId };
  }
  const existing = await getExecutionLogByIdempotencyKey(idempotencyKey);
  if (existing) {
    return { duplicate: true, executionId: existing.executionId, logKey: existing.logKey };
  }
  return { duplicate: false as const };
}

export function registerIdempotency(idempotencyKey: string, executionId: string) {
  memoryKeys.set(idempotencyKey, {
    executionId,
    expiresAt: Date.now() + env.EXECUTION_ENGINE_V2_IDEMPOTENCY_TTL_MS,
  });
}

export function clearExpiredIdempotencyKeys() {
  const now = Date.now();
  for (const [key, value] of memoryKeys.entries()) {
    if (value.expiresAt <= now) memoryKeys.delete(key);
  }
}
