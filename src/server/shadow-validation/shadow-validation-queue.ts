import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { ShadowValidationJobPayload } from "@/src/server/shadow-validation/shadow-validation.types";
import {
  captureShadowDecisionsForDecision,
  evaluatePendingShadowDecisions,
} from "@/src/server/shadow-validation/shadow-capture.engine";
import { runBenchmarkReport } from "@/src/server/shadow-validation/head-to-head.service";
import { runHistoricalSimulation, runReplayValidation } from "@/src/server/shadow-validation/simulation.service";
import { computeEngineScorecard } from "@/src/server/shadow-validation/engine-scorecard.service";
import { persistPromotionCandidate } from "@/src/server/shadow-validation/promotion-rules.service";
import { listActiveShadowEngines } from "@/src/server/shadow-validation/engine-registry.service";

export const shadowValidationQueue = new TradingJobQueue("shadow-validation", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;

export function registerShadowValidationQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  shadowValidationQueue.register<Extract<ShadowValidationJobPayload, { type: "SHADOW_CAPTURE" }>>(
    "SHADOW_CAPTURE",
    async (job) => {
      await captureShadowDecisionsForDecision(job.payload.decisionId);
      await prisma.shadowValidationJobState.upsert({
        where: { jobType: "SHADOW_CAPTURE" },
        create: { jobType: "SHADOW_CAPTURE", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  shadowValidationQueue.register<Extract<ShadowValidationJobPayload, { type: "SHADOW_EVALUATE" }>>(
    "SHADOW_EVALUATE",
    async (job) => {
      if (job.payload.decisionId) {
        await evaluatePendingShadowDecisions(1);
      } else {
        await evaluatePendingShadowDecisions(job.payload.limit ?? 50);
      }
      await prisma.shadowValidationJobState.upsert({
        where: { jobType: "SHADOW_EVALUATE" },
        create: { jobType: "SHADOW_EVALUATE", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  shadowValidationQueue.register<Extract<ShadowValidationJobPayload, { type: "REPLAY_VALIDATE" }>>(
    "REPLAY_VALIDATE",
    async (job) => {
      if (job.payload.decisionId) {
        await runReplayValidation(job.payload.decisionId);
        return;
      }
      const rows = await prisma.decisionLog.findMany({
        orderBy: { createdAt: "desc" },
        take: job.payload.limit ?? 20,
        select: { decisionId: true },
      });
      for (const row of rows) {
        await runReplayValidation(row.decisionId).catch((error) =>
          logger.warn({ decisionId: row.decisionId, error: (error as Error).message }, "Replay validate failed"),
        );
      }
    },
  );

  shadowValidationQueue.register<Extract<ShadowValidationJobPayload, { type: "SIMULATION_RUN" }>>(
    "SIMULATION_RUN",
    async (job) => {
      await runHistoricalSimulation({
        windowDays: job.payload.windowDays ?? 30,
        engineIds: job.payload.engineIds,
      });
      await prisma.shadowValidationJobState.upsert({
        where: { jobType: "SIMULATION_RUN" },
        create: { jobType: "SIMULATION_RUN", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  shadowValidationQueue.register("DAILY_COMPARISON", async () => {
    await runBenchmarkReport("DAILY");
    await prisma.shadowValidationJobState.upsert({
      where: { jobType: "DAILY_COMPARISON" },
      create: { jobType: "DAILY_COMPARISON", status: "COMPLETED", lastProcessedAt: new Date() },
      update: { status: "COMPLETED", lastProcessedAt: new Date() },
    });
  });

  shadowValidationQueue.register("WEEKLY_BENCHMARK", async () => {
    await runBenchmarkReport("WEEKLY");
    await prisma.shadowValidationJobState.upsert({
      where: { jobType: "WEEKLY_BENCHMARK" },
      create: { jobType: "WEEKLY_BENCHMARK", status: "COMPLETED", lastProcessedAt: new Date() },
      update: { status: "COMPLETED", lastProcessedAt: new Date() },
    });
  });

  shadowValidationQueue.register("MONTHLY_VALIDATION", async () => {
    await runBenchmarkReport("MONTHLY");
    await prisma.shadowValidationJobState.upsert({
      where: { jobType: "MONTHLY_VALIDATION" },
      create: { jobType: "MONTHLY_VALIDATION", status: "COMPLETED", lastProcessedAt: new Date() },
      update: { status: "COMPLETED", lastProcessedAt: new Date() },
    });
  });

  shadowValidationQueue.register<Extract<ShadowValidationJobPayload, { type: "PROMOTION_CHECK" }>>(
    "PROMOTION_CHECK",
    async (job) => {
      const engines = job.payload.engineId
        ? (await listActiveShadowEngines()).filter((row) => row.engineId === job.payload.engineId)
        : await listActiveShadowEngines();
      const periodEnd = new Date();
      const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      for (const engine of engines) {
        const scorecard = await computeEngineScorecard({ engineId: engine.engineId, periodStart, periodEnd });
        await persistPromotionCandidate(engine.engineId, scorecard);
      }
      await prisma.shadowValidationJobState.upsert({
        where: { jobType: "PROMOTION_CHECK" },
        create: { jobType: "PROMOTION_CHECK", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );
}

export async function enqueueShadowValidationJob(payload: ShadowValidationJobPayload) {
  registerShadowValidationQueueHandlers();
  return shadowValidationQueue.push(payload.type, payload);
}

export function startShadowValidationQueue() {
  registerShadowValidationQueueHandlers();
  void shadowValidationQueue.start();
  return shadowValidationQueue.stats();
}

export function scheduleShadowCapture(decisionId: string) {
  void enqueueShadowValidationJob({ type: "SHADOW_CAPTURE", decisionId }).catch(() => null);
}
