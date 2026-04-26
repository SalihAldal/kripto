import { apiError, apiOk } from "@/lib/api";
import { prisma } from "@/src/server/db/prisma";
import { getRedis } from "@/lib/redis";
import { listHeartbeats, markHeartbeat } from "@/src/server/observability/heartbeat";
import { validateStartupConfig } from "@/src/server/startup/validate-startup";

export async function GET() {
  validateStartupConfig();
  const checks = {
    database: false,
    redis: false,
  };
  let dbError: string | undefined;
  let redisError: string | undefined;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (error) {
    dbError = (error as Error).message;
  }

  try {
    const redis = getRedis();
    if (!redis) throw new Error("REDIS_URL not configured");
    await redis.ping();
    checks.redis = true;
  } catch (error) {
    redisError = (error as Error).message;
  }

  const ready = checks.database && checks.redis;
  markHeartbeat({
    service: "readiness",
    status: ready ? "UP" : "DEGRADED",
    message: ready ? "All dependencies ready" : "Some dependencies not ready",
    details: { checks, dbError, redisError },
  });

  if (!ready) {
    return apiError(`Readiness failed: db=${checks.database}, redis=${checks.redis}`, 503);
  }

  return apiOk({
    status: "ready",
    checks,
    heartbeats: listHeartbeats(),
    timestamp: new Date().toISOString(),
  });
}
