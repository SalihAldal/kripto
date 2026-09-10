import { searchKnowledge, persistKnowledgeEntry } from "@/src/server/learning-engine/learning-engine.repository";
import { prisma } from "@/src/server/db/prisma";
import { syncResearchSeedKnowledge } from "./research-seed.service";

export async function buildKnowledgeBase(limit = 100) {
  const seed = await syncResearchSeedKnowledge();
  const [patterns, memories, replays] = await Promise.all([
    prisma.patternLibrary.findMany({ orderBy: { updatedAt: "desc" }, take: limit }),
    prisma.learningMemory.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
    prisma.patternReplay.findMany({ orderBy: { createdAt: "desc" }, take: limit }),
  ]);

  let added = 0;
  for (const pattern of patterns) {
    await persistKnowledgeEntry({
      title: `Pattern: ${pattern.patternKey}`,
      category: "PATTERN",
      content: `WinRate=${pattern.winRate}% Expectancy=${pattern.expectancy} Samples=${pattern.sampleSize}`,
      tags: ["pattern", pattern.patternKey, pattern.status],
      patternKey: pattern.patternKey,
      metadata: { regime: pattern.regime, hourBucket: pattern.hourBucket, weekday: pattern.weekday },
    });
    added += 1;
  }

  for (const memory of memories.slice(0, 50)) {
    await persistKnowledgeEntry({
      title: `${memory.memoryType} memory ${memory.refId}`,
      category: memory.memoryType,
      content: memory.summary ?? JSON.stringify(memory.payload),
      tags: [memory.memoryType, memory.symbol ?? "ALL"],
      metadata: { refId: memory.refId },
    });
    added += 1;
  }

  for (const replay of replays.slice(0, 30)) {
    await persistKnowledgeEntry({
      title: `Replay: ${replay.patternKey}`,
      category: "REPLAY",
      content: JSON.stringify(replay.replayData),
      tags: ["replay", replay.patternKey],
      patternKey: replay.patternKey,
      metadata: { decisionId: replay.decisionId, tradeId: replay.tradeId },
    });
    added += 1;
  }

  return { added, seed };
}

export async function similaritySearch(query: string, limit = 20) {
  return searchKnowledge(query, limit);
}

export async function historicalLookup(refId: string) {
  const [decision, trade, replay] = await Promise.all([
    prisma.decisionMemory.findFirst({ where: { decisionId: refId } }),
    prisma.learningMemory.findFirst({ where: { refId, memoryType: "TRADE" } }),
    prisma.patternReplay.findFirst({ where: { OR: [{ decisionId: refId }, { tradeId: refId }] } }),
  ]);
  return { decision, trade, replay };
}

export async function patternSearch(patternKey: string, limit = 20) {
  return prisma.knowledgeBase.findMany({
    where: { OR: [{ patternKey }, { tags: { has: patternKey } }] },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
