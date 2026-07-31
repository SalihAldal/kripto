import { prisma } from "@/src/server/db/prisma";
import { persistAiHealth } from "@/src/server/aoc/aoc.repository";

export async function collectAiHealth() {
  const recentDecisions = await prisma.decisionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { confidence: true, createdAt: true },
  }).catch(() => []);

  const avgConfidence = recentDecisions.length > 0
    ? recentDecisions.reduce((s, d) => s + (d.confidence ?? 50), 0) / recentDecisions.length
    : 50;

  const confidenceDrift = recentDecisions.length >= 2
    ? Math.abs((recentDecisions[0]?.confidence ?? 50) - (recentDecisions[recentDecisions.length - 1]?.confidence ?? 50))
    : 0;

  return persistAiHealth({
    promptLatencyMs: 800,
    modelLatencyMs: 1200,
    tokenUsage: 0,
    contextSize: 0,
    hallucinationRate: 0,
    confidenceDrift: Number(confidenceDrift.toFixed(1)),
    decisionDrift: Number(confidenceDrift.toFixed(1)),
    learningDrift: 0,
    overallScore: Number(Math.max(30, 100 - confidenceDrift).toFixed(1)),
    metadata: { avgConfidence, sampleSize: recentDecisions.length },
  });
}
