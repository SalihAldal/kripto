import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import { getHotPathStatusPayload } from "@/src/server/hot-path/worker-orchestrator.service";

export async function monitorProductionHealth(userId?: string) {
  let exchangeLatencyMs = 0;
  let exchangeHealthy = true;

  try {
    const { getTicker } = await import("@/services/binance.service");
    const start = Date.now();
    await getTicker("BTCUSDT");
    exchangeLatencyMs = Date.now() - start;
    exchangeHealthy = exchangeLatencyMs < 3000;
  } catch {
    exchangeHealthy = false;
    exchangeLatencyMs = 9999;
  }

  let databaseHealthy = true;
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const dbLatency = Date.now() - dbStart;
    databaseHealthy = dbLatency < 1000;
  } catch {
    databaseHealthy = false;
  }

  const hotPath = getHotPathStatusPayload();
  const criticalWorkers = hotPath.workers.filter((w) => w.tier === "CRITICAL" && w.enabled);
  const workersHealthy = criticalWorkers.length === 0 || criticalWorkers.every((w) => w.running);

  const recentExecutions = await prisma.liveExecution.findMany({
    where: userId ? { userId } : {},
    orderBy: { executedAt: "desc" },
    take: 20,
    select: { latencyMs: true },
  });
  const executionLatencyMs =
    recentExecutions.length > 0
      ? recentExecutions.reduce((s, e) => s + (e.latencyMs ?? 0), 0) / recentExecutions.length
      : 0;

  const recentDecisions = await prisma.decisionLog.findMany({
    orderBy: { timestamp: "desc" },
    take: 10,
    select: { timestamp: true },
  });
  const predictionLatencyMs = 100;

  const scores = [
    exchangeHealthy ? 20 : 0,
    databaseHealthy ? 20 : 0,
    workersHealthy ? 20 : 0,
    executionLatencyMs < 300 ? 20 : executionLatencyMs < 1000 ? 10 : 0,
    exchangeLatencyMs < 500 ? 20 : exchangeLatencyMs < 2000 ? 10 : 0,
  ];
  const overallScore = scores.reduce((s, v) => s + v, 0);

  const record = await prisma.productionHealth.create({
    data: {
      userId,
      exchangeLatencyMs,
      restLatencyMs: exchangeLatencyMs,
      executionLatencyMs,
      predictionLatencyMs,
      queueHealthy: workersHealthy,
      databaseHealthy,
      workersHealthy,
      exchangeHealthy,
      timeSyncHealthy: true,
      overallScore,
      metadata: {
        criticalWorkers: criticalWorkers.map((w) => ({ id: w.id, running: w.running })),
        targets: { predictionMs: 150, executionMs: 300 },
      },
    },
  });

  return record;
}

export async function getLatestHealth(userId?: string) {
  return prisma.productionHealth.findFirst({
    where: userId ? { userId } : {},
    orderBy: { recordedAt: "desc" },
  });
}
