import { prisma } from "@/src/server/db/prisma";
import { getRedis } from "@/lib/redis";

const IDEMPOTENCY_PREFIX = "security.idempotency";
const MEMORY_LOCKS = new Map<string, number>();

function idempotencySettingKey(userId: string, scope: string, key: string) {
  return `${IDEMPOTENCY_PREFIX}.${userId}.${scope}.${key}`;
}

export function getIdempotencyKey(headers: Headers) {
  const raw = headers.get("idempotency-key") ?? headers.get("x-idempotency-key");
  return raw?.trim() || null;
}

export async function readIdempotentResponse(userId: string, scope: string, key: string) {
  const row = await prisma.appSetting.findUnique({
    where: { key: idempotencySettingKey(userId, scope, key) },
  });
  return (row?.value as Record<string, unknown> | null) ?? null;
}

export async function writeIdempotentResponse(
  userId: string,
  scope: string,
  key: string,
  response: Record<string, unknown>,
) {
  const settingKey = idempotencySettingKey(userId, scope, key);
  await prisma.appSetting.upsert({
    where: { key: settingKey },
    create: {
      key: settingKey,
      scope: "USER",
      userId,
      value: response,
      valueType: "json",
      status: "ACTIVE",
      description: "Idempotent response cache",
    },
    update: {
      value: response,
      status: "ACTIVE",
    },
  });
}

export async function acquireUserActionLock(userId: string, action: string, ttlMs = 20_000) {
  const key = `security.lock.${userId}.${action}`;
  const redis = getRedis();
  if (redis) {
    const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await redis.set(key, lockValue, "PX", ttlMs, "NX");
    if (result !== "OK") return null;
    return async () => {
      const current = await redis.get(key);
      if (current === lockValue) {
        await redis.del(key);
      }
    };
  }

  const now = Date.now();
  const currentExpiry = MEMORY_LOCKS.get(key) ?? 0;
  if (currentExpiry > now) return null;
  MEMORY_LOCKS.set(key, now + ttlMs);
  return async () => {
    MEMORY_LOCKS.delete(key);
  };
}
