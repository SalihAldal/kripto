import { listHeartbeats } from "@/src/server/observability/heartbeat";
import { getCircuitSnapshot } from "@/src/server/resilience/circuit-breaker";
import { getRuntimeExecutionContext, listOpenPositionsByUser } from "@/src/server/repositories/execution.repository";
import { listTradeHistory } from "@/src/server/repositories/trade.repository";
import { listSystemLogs } from "@/src/server/repositories/log.repository";
import { listRunningAutoRoundJobs } from "@/src/server/repositories/auto-round.repository";

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export async function getMonitoringSnapshot() {
  const { user } = await getRuntimeExecutionContext();
  const [openPositions, recentOrders, recentLogs, apiLogs24h, runningJobs] = await Promise.all([
    listOpenPositionsByUser(user.id),
    listTradeHistory({ userId: user.id, limit: 400 }),
    listSystemLogs({ limit: 300 }),
    listSystemLogs({ limit: 1200, actionType: "api_error" }),
    listRunningAutoRoundJobs(50),
  ]);

  const now = Date.now();
  const since24h = now - 24 * 60 * 60 * 1000;
  const orders24h = recentOrders.filter((row) => row.createdAt.getTime() >= since24h);
  const pendingOrders = recentOrders.filter((row) => row.status === "NEW" || row.status === "PARTIALLY_FILLED");
  const failedOrders = recentOrders.filter((row) => row.status === "REJECTED" || row.status === "EXPIRED");
  const apiErrors24h = apiLogs24h.filter((row) => row.createdAt.getTime() >= since24h);
  const totalOps24h = Math.max(orders24h.length, 1);

  const queueBacklog = runningJobs.reduce((acc, job) => {
    const remaining = Math.max(0, job.totalRounds - (job.completedRounds + job.failedRounds));
    return acc + remaining;
  }, 0);

  const lastAnalysisLog = recentLogs.find((row) => {
    const ctx = (row.context ?? {}) as Record<string, unknown>;
    return String(ctx.actionType ?? "") === "analysis_started";
  });

  const heartbeat = listHeartbeats();
  const circuits = getCircuitSnapshot();

  return {
    activeOpenPositions: openPositions.length,
    pendingOrders: pendingOrders.length,
    failedOrders: failedOrders.length,
    apiErrorRatePercent: Number(((apiErrors24h.length / totalOps24h) * 100).toFixed(2)),
    tradesLast24h: orders24h.length,
    workerHealth: {
      runningJobs: runningJobs.length,
      status: runningJobs.length > 0 ? "RUNNING" : "IDLE",
    },
    queueBacklog,
    lastSuccessfulAnalysisAt: lastAnalysisLog?.createdAt.toISOString() ?? null,
    criticalAlarms: [
      openPositions.length > 5 ? "open_positions_high" : null,
      failedOrders.length > 3 ? "failed_orders_high" : null,
      apiErrors24h.length > 10 ? "api_errors_high" : null,
      queueBacklog > 10 ? "queue_backlog_high" : null,
    ].filter((x): x is string => Boolean(x)),
    heartbeat,
    circuits: circuits.map((row) => ({
      ...row,
      failures: toNumber(row.failures),
    })),
    updatedAt: new Date().toISOString(),
  };
}
