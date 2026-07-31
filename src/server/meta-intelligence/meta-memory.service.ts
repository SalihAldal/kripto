import { persistExecutiveMemory } from "@/src/server/meta-intelligence/meta-intelligence.repository";
import { prisma } from "@/src/server/db/prisma";

export async function recordMetaMemory(limit = 10) {
  const [decisions, replays, crises] = await Promise.all([
    prisma.executiveDecision.findMany({ orderBy: { decidedAt: "desc" }, take: 5 }),
    prisma.newsReplay.findMany({ orderBy: { replayedAt: "desc" }, take: 5, include: { article: true } }).catch(() => []),
    prisma.marketNarrative.findMany({ where: { narrativeType: "MACRO_PANIC" }, take: 3 }).catch(() => []),
  ]);

  let recorded = 0;
  for (const dec of decisions.slice(0, limit)) {
    await persistExecutiveMemory({
      memoryKey: `decision_${dec.id}`,
      memoryType: "DECISION",
      title: dec.recommendation,
      description: dec.resolution,
      impact: dec.expectedBenefit ?? undefined,
      lessonLearned: dec.conflictSummary ?? undefined,
      tags: ["decision", dec.priority.toLowerCase()],
      confidence: dec.overallConfidence,
    });
    recorded += 1;
  }

  for (const replay of replays.slice(0, 3)) {
    const move = replay.maxMovePct ?? 0;
    await persistExecutiveMemory({
      memoryKey: `news_replay_${replay.id}`,
      memoryType: move > 2 ? "MAJOR_WIN" : move < -2 ? "MAJOR_MISTAKE" : "NEUTRAL",
      title: `News event market reaction: ${move.toFixed(1)}%`,
      description: `Article: ${replay.article?.title ?? "Unknown"}`,
      tags: ["news", "replay"],
      confidence: 60,
    });
    recorded += 1;
  }

  return { recorded, decisions: decisions.length, replays: replays.length };
}

export async function listExecutiveMemory(limit = 30) {
  return prisma.executiveMemory.findMany({ orderBy: { recordedAt: "desc" }, take: limit });
}
