import { prisma } from "@/src/server/db/prisma";

export async function monitorQueues() {
  const jobStates = await Promise.all([
    prisma.aocJobState.findMany().catch(() => []),
    prisma.eventPlatformJobState.findMany().catch(() => []),
    prisma.intelligenceFusionJobState.findMany().catch(() => []),
    prisma.exchangeAbstractionJobState.findMany().catch(() => []),
  ]);

  const allStates = jobStates.flat();
  const stale = allStates.filter((s) => {
    if (!s.lastProcessedAt) return true;
    return Date.now() - s.lastProcessedAt.getTime() > 600_000;
  });

  return {
    totalQueues: allStates.length,
    staleQueues: stale.length,
    queueScore: Math.max(20, 100 - stale.length * 15),
    details: allStates.map((s) => ({ jobType: s.jobType, status: s.status, lastProcessedAt: s.lastProcessedAt })),
  };
}
