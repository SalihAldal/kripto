import { env } from "@/lib/config";
import { TradingJobQueue } from "@/src/server/trading-core/queue/job-queue";
import { prisma } from "@/src/server/db/prisma";
import type { NewsIntelligenceJobPayload } from "@/src/server/news-intelligence/news-intelligence.types";
import { runNewsIntelligenceJob } from "@/src/server/news-intelligence/news-intelligence.orchestrator";

export const newsIntelligenceQueue = new TradingJobQueue("news-intelligence", 3, Boolean(env.REDIS_URL));
let handlersRegistered = false;

async function markJobComplete(jobType: NewsIntelligenceJobPayload["type"]) {
  await prisma.newsIntelligenceJobState.upsert({
    where: { jobType },
    create: { jobType, status: "COMPLETED", lastProcessedAt: new Date() },
    update: { status: "COMPLETED", lastProcessedAt: new Date() },
  });
}

export function registerNewsIntelligenceQueueHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;

  const types: NewsIntelligenceJobPayload["type"][] = [
    "NEWS_COLLECT",
    "RSS_COLLECT",
    "TWITTER_COLLECT",
    "TELEGRAM_COLLECT",
    "GITHUB_COLLECT",
    "CLASSIFY",
    "NARRATIVE_DETECT",
    "IMPACT_SCORE",
    "DUPLICATE_DETECT",
    "SENTIMENT_ANALYZE",
    "COIN_MAP",
    "REPLAY_ANALYZE",
    "NEWS_LEARN",
    "TIMELINE_SYNC",
    "SOURCE_SCORE",
  ];

  for (const type of types) {
    newsIntelligenceQueue.register<Extract<NewsIntelligenceJobPayload, { type: typeof type }>>(type, async (job) => {
      await runNewsIntelligenceJob(job.payload);
      await markJobComplete(type);
    });
  }
}

export async function enqueueNewsIntelligenceJob(payload: NewsIntelligenceJobPayload) {
  registerNewsIntelligenceQueueHandlers();
  return newsIntelligenceQueue.push(payload.type, payload);
}

export function startNewsIntelligenceQueue() {
  registerNewsIntelligenceQueueHandlers();
  void newsIntelligenceQueue.start();
  return newsIntelligenceQueue.stats();
}
