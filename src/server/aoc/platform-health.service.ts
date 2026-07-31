import os from "node:os";
import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import { persistPlatformHealth, persistAuditLog } from "@/src/server/aoc/aoc.repository";
import { emitAocEvent, AOC_EVENT } from "@/src/server/aoc/aoc.events";

export async function collectPlatformHealth() {
  const mem = process.memoryUsage();
  const memoryUsageMb = mem.heapUsed / 1024 / 1024;
  const cpuUsagePct = os.loadavg()[0] / os.cpus().length * 100;

  const [dbOk, jobStates] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    prisma.aocJobState.findMany().catch(() => []),
  ]);

  const workerScore = jobStates.length > 0 ? 90 : 70;
  const databaseScore = dbOk ? 95 : 30;
  const queueScore = env.REDIS_URL ? 85 : 60;
  const apiScore = 80;
  const exchangeScore = 75;
  const applicationScore = Math.max(20, 100 - Math.min(50, memoryUsageMb / 50) - Math.min(30, cpuUsagePct / 3));

  const snapshot = await persistPlatformHealth({
    applicationScore,
    workerScore,
    databaseScore,
    queueScore,
    apiScore,
    exchangeScore,
    memoryUsageMb: Number(memoryUsageMb.toFixed(1)),
    cpuUsagePct: Number(cpuUsagePct.toFixed(1)),
    containerHealthy: true,
    details: { nodeVersion: process.version, appEnv: env.APP_ENV, appRole: env.APP_ROLE },
  });

  await persistAuditLog("HEALTH_CHECK", "platform", true, { snapshotKey: snapshot.snapshotKey });
  emitAocEvent(AOC_EVENT.HEALTH_RECORDED, { type: "platform", snapshotKey: snapshot.snapshotKey });
  return snapshot;
}

export async function getSystemMetrics() {
  return {
    memoryMb: process.memoryUsage().heapUsed / 1024 / 1024,
    cpuLoad: os.loadavg(),
    uptime: process.uptime(),
    freeMemMb: os.freemem() / 1024 / 1024,
  };
}
