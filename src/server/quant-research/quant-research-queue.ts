import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { QuantResearchJobPayload } from "@/src/server/quant-research/quant-research.types";
import { runQuantResearchJob } from "@/src/server/quant-research/quant-research.orchestrator";

export const quantResearchQueue = new TradingJobQueue("quant-research", 2, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: QuantResearchJobPayload["type"]) {
  await prisma.quantResearchJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerQuantResearchQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: QuantResearchJobPayload["type"][] = [
    "RESEARCH_RUN",
    "STRATEGY_GENERATE",
    "INDICATOR_GENERATE",
    "PARAMETER_OPTIMIZE",
    "BACKTEST",
    "WALK_FORWARD",
    "MONTE_CARLO",
    "REGIME_BENCHMARK",
    "STRATEGY_COMPETITION",
    "STRATEGY_EVOLVE",
    "FEATURE_SELECT",
    "INSTITUTIONAL_BENCHMARK",
    "RESEARCH_REPORT",
    "SELF_DISCOVERY",
    "KNOWLEDGE_SYNC",
    "EXPERIMENT_RUN",
    "COUNTERFACTUAL_ANALYZE",
    "WALK_FORWARD_VALIDATE",
    "STRATEGY_BENCHMARK",
    "FEATURE_RESEARCH",
    "FEATURE_ELIMINATE",
    "STATISTICAL_VALIDATE",
    "RECOMMENDATION_GENERATE",
    "HYPOTHESIS_GENERATE",
  ];

  for (const type of types) {
    quantResearchQueue.register<Extract<QuantResearchJobPayload, { type: typeof type }>>(type, async (job) => {
      await runQuantResearchJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueQuantResearchJob(payload: QuantResearchJobPayload) {
  registerQuantResearchQueueHandlers();
  return quantResearchQueue.push(payload.type, payload);
}

export function startQuantResearchQueue() {
  registerQuantResearchQueueHandlers();
  void quantResearchQueue.start();
  return quantResearchQueue.stats();
}
