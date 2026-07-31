import { prisma } from "@/src/server/db/prisma";
import type { LearningMemoryType } from "@prisma/client";

export async function syncLearningMemories(memoryType?: LearningMemoryType) {
  const types: LearningMemoryType[] = memoryType
    ? [memoryType]
    : ["DECISION", "TRADE", "REJECT", "PATTERN", "MARKET", "REPLAY", "SHORT_TERM", "LONG_TERM"];

  let synced = 0;
  for (const type of types) {
    const count = await prisma.learningMemory.count({ where: { memoryType: type } });
    if (count === 0) continue;
    synced += count;
  }
  return { synced, types: types.length };
}

export async function getMemoryStats() {
  const rows = await prisma.learningMemory.groupBy({
    by: ["memoryType"],
    _count: { _all: true },
  });
  return rows.map((row) => ({ memoryType: row.memoryType, count: row._count._all }));
}

export async function pruneShortTermMemory(maxAgeHours = 72) {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60_000);
  const result = await prisma.learningMemory.deleteMany({
    where: { memoryType: "SHORT_TERM", createdAt: { lt: cutoff } },
  });
  return { pruned: result.count };
}
