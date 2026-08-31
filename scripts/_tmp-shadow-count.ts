import { prisma } from "@/src/server/db/prisma";

async function main() {
  const total = await prisma.shadowCandidateOutcome.count();
  const bySource = await prisma.shadowCandidateOutcome.groupBy({
    by: ["source"],
    _count: { _all: true },
  });
  const latest = await prisma.shadowCandidateOutcome.findMany({
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { candidateId: true, symbol: true, source: true, detectedAt: true, updatedAt: true, latestStage: true },
  });
  console.log(JSON.stringify({ total, bySource, latest }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error((error as Error).message);
  await prisma.$disconnect();
  process.exit(1);
});
