import { prisma } from "@/src/server/db/prisma";
import { researchSeedRecords } from "./research-seed";
export async function syncResearchSeedKnowledge(asOfMs = Date.now()) {
  const records = researchSeedRecords(asOfMs);
  await prisma.$transaction(records.map(r => prisma.knowledgeBase.upsert({ where: { id: r.id }, create: r, update: r })));
  return { upserted: records.length, trainingRowsInserted: 0, automaticWeightsChanged: false };
}
