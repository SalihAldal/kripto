import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { ExchangeSimulatorJobPayload } from "@/src/server/exchange-simulator/exchange-simulator.types";
import {
  getFeeDashboard,
  getSimulatorDashboardMetrics,
  getSlippageDashboard,
  listSimulations,
} from "@/src/server/exchange-simulator/exchange-simulator.repository";
import { analyzeLatencySamples } from "@/src/server/exchange-simulator/latency-simulator";

export const exchangeSimulatorQueue = new TradingJobQueue("exchange-simulator", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;

export function registerExchangeSimulatorQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  exchangeSimulatorQueue.register<Extract<ExchangeSimulatorJobPayload, { type: "EXECUTION_SIMULATE" }>>(
    "EXECUTION_SIMULATE",
    async (job) => {
      await listSimulations({ limit: job.payload.limit ?? 50 });
      await prisma.exchangeSimulatorJobState.upsert({
        where: { jobType: "EXECUTION_SIMULATE" },
        create: { jobType: "EXECUTION_SIMULATE", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  exchangeSimulatorQueue.register<Extract<ExchangeSimulatorJobPayload, { type: "EXECUTION_REPLAY" }>>(
    "EXECUTION_REPLAY",
    async (job) => {
      await listSimulations({
        executionId: job.payload.simulationId,
        limit: job.payload.limit ?? 50,
      });
      await prisma.exchangeSimulatorJobState.upsert({
        where: { jobType: "EXECUTION_REPLAY" },
        create: { jobType: "EXECUTION_REPLAY", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  exchangeSimulatorQueue.register<Extract<ExchangeSimulatorJobPayload, { type: "SLIPPAGE_CALCULATE" }>>(
    "SLIPPAGE_CALCULATE",
    async (job) => {
      await getSlippageDashboard(job.payload.periodHours ?? 24);
      await prisma.exchangeSimulatorJobState.upsert({
        where: { jobType: "SLIPPAGE_CALCULATE" },
        create: { jobType: "SLIPPAGE_CALCULATE", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  exchangeSimulatorQueue.register<Extract<ExchangeSimulatorJobPayload, { type: "LATENCY_ANALYZE" }>>(
    "LATENCY_ANALYZE",
    async (job) => {
      const since = new Date(Date.now() - (job.payload.periodHours ?? 24) * 60 * 60 * 1000);
      const rows = await prisma.executionLatency.findMany({
        where: { createdAt: { gte: since } },
        take: 500,
      });
      analyzeLatencySamples(
        rows.map((row) => ({
          networkMs: row.networkMs ?? 0,
          exchangeMs: row.exchangeMs ?? 0,
          queueMs: row.queueMs ?? 0,
          matchingMs: row.matchingMs ?? 0,
          totalMs: row.totalMs ?? 0,
        })),
      );
      await prisma.exchangeSimulatorJobState.upsert({
        where: { jobType: "LATENCY_ANALYZE" },
        create: { jobType: "LATENCY_ANALYZE", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  exchangeSimulatorQueue.register<Extract<ExchangeSimulatorJobPayload, { type: "FEE_CALCULATE" }>>(
    "FEE_CALCULATE",
    async (job) => {
      await getFeeDashboard(job.payload.periodHours ?? 24);
      await prisma.exchangeSimulatorJobState.upsert({
        where: { jobType: "FEE_CALCULATE" },
        create: { jobType: "FEE_CALCULATE", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );
}

export async function enqueueExchangeSimulatorJob(payload: ExchangeSimulatorJobPayload) {
  registerExchangeSimulatorQueueHandlers();
  return exchangeSimulatorQueue.push(payload.type, payload);
}

export function startExchangeSimulatorQueue() {
  registerExchangeSimulatorQueueHandlers();
  void exchangeSimulatorQueue.start();
  return exchangeSimulatorQueue.stats();
}

export async function refreshSimulatorDashboardCache() {
  return getSimulatorDashboardMetrics(24);
}
