import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { DecisionEngineJobPayload } from "@/src/server/decision-engine/decision-engine.types";
import { listDueWatchlist, advanceWatchlistRecheck } from "@/src/server/decision-engine/watchlist.service";
import {
  computeExpertPerformance,
  computeExpertWeightRecommendations,
  replayExpertsForDecision,
} from "@/src/server/decision-engine/expert-replay.service";
import { buildAIInput, runLegacyAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { createDecisionId } from "@/src/server/observability/decision-observability.service";
import { adjudicateWithMasterDecisionEngine } from "@/src/server/decision-engine/master-decision-engine.service";

export const decisionEngineQueue = new TradingJobQueue("decision-engine", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;

export function registerDecisionEngineQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  decisionEngineQueue.register<Extract<DecisionEngineJobPayload, { type: "WATCHLIST_RECHECK" }>>(
    "WATCHLIST_RECHECK",
    async (job) => {
      const due = await listDueWatchlist(job.payload.limit ?? 20);
      for (const row of due) {
        try {
          const input = await buildAIInput(row.symbol);
          const legacy = await runLegacyAIConsensusFromInput(input);
          const adjudicated = await adjudicateWithMasterDecisionEngine({
            decisionId: createDecisionId(),
            input,
            legacyResult: legacy,
          });
          const promoted = adjudicated.finalDecision === "BUY";
          await advanceWatchlistRecheck(row.id, promoted);
        } catch (error) {
          logger.warn({ symbol: row.symbol, error: (error as Error).message }, "Watchlist recheck failed");
          await advanceWatchlistRecheck(row.id, false);
        }
      }
      await prisma.decisionEngineJobState.upsert({
        where: { jobType: "WATCHLIST_RECHECK" },
        create: { jobType: "WATCHLIST_RECHECK", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  decisionEngineQueue.register<Extract<DecisionEngineJobPayload, { type: "EXPERT_REPLAY" }>>("EXPERT_REPLAY", async (job) => {
    if (job.payload.decisionId) {
      await replayExpertsForDecision(job.payload.decisionId);
      return;
    }
    const rows = await prisma.consensusDecision.findMany({
      orderBy: { createdAt: "desc" },
      take: job.payload.limit ?? 20,
    });
    for (const row of rows) {
      await replayExpertsForDecision(row.decisionId).catch(() => null);
    }
  });

  decisionEngineQueue.register<Extract<DecisionEngineJobPayload, { type: "EXPERT_PERFORMANCE" }>>(
    "EXPERT_PERFORMANCE",
    async (job) => {
      await computeExpertPerformance(job.payload.periodDays ?? 7);
      await prisma.decisionEngineJobState.upsert({
        where: { jobType: "EXPERT_PERFORMANCE" },
        create: { jobType: "EXPERT_PERFORMANCE", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );

  decisionEngineQueue.register<Extract<DecisionEngineJobPayload, { type: "WEIGHT_RECOMMENDATION" }>>(
    "WEIGHT_RECOMMENDATION",
    async () => {
      await computeExpertWeightRecommendations();
      await prisma.decisionEngineJobState.upsert({
        where: { jobType: "WEIGHT_RECOMMENDATION" },
        create: { jobType: "WEIGHT_RECOMMENDATION", status: "COMPLETED", lastProcessedAt: new Date() },
        update: { status: "COMPLETED", lastProcessedAt: new Date() },
      });
    },
  );
}

export async function enqueueDecisionEngineJob(payload: DecisionEngineJobPayload) {
  registerDecisionEngineQueueHandlers();
  return decisionEngineQueue.push(payload.type, payload);
}

export function startDecisionEngineQueue() {
  registerDecisionEngineQueueHandlers();
  void decisionEngineQueue.start();
  return decisionEngineQueue.stats();
}
