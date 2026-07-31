import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { ExchangeAbstractionJobPayload } from "@/src/server/exchange-abstraction/exchange-abstraction.types";
import { runExchangeAbstractionJob } from "@/src/server/exchange-abstraction/exchange-abstraction.orchestrator";

export const exchangeAbstractionQueue = new TradingJobQueue("exchange-abstraction", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: ExchangeAbstractionJobPayload["type"]) {
  await prisma.exchangeAbstractionJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerExchangeAbstractionQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: ExchangeAbstractionJobPayload["type"][] = [
    "HEALTH_CHECK", "SYMBOL_SYNC", "BALANCE_SYNC", "CONNECTION_MONITOR",
    "RATE_LIMIT_SYNC", "RECONNECT", "LATENCY_PROBE",
  ];

  for (const type of types) {
    exchangeAbstractionQueue.register<Extract<ExchangeAbstractionJobPayload, { type: typeof type }>>(type, async (job) => {
      await runExchangeAbstractionJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueExchangeAbstractionJob(payload: ExchangeAbstractionJobPayload) {
  registerExchangeAbstractionQueueHandlers();
  return exchangeAbstractionQueue.push(payload.type, payload);
}

export function startExchangeAbstractionQueue() {
  registerExchangeAbstractionQueueHandlers();
  void exchangeAbstractionQueue.start();
  return exchangeAbstractionQueue.stats();
}
