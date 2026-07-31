import { createHash } from "node:crypto";
import type { CanonicalScores } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import { persistFusionTimeline } from "@/src/server/intelligence-fusion/intelligence-fusion.repository";
import { emitFusionEvent, FUSION_EVENT } from "@/src/server/intelligence-fusion/intelligence-fusion.events";
import { prisma } from "@/src/server/db/prisma";

function hashContext(scores: CanonicalScores): string {
  return createHash("sha256").update(JSON.stringify(scores)).digest("hex").slice(0, 16);
}

export async function recordFusionTimeline(intelligenceId: string, scores: CanonicalScores) {
  const contextHash = hashContext(scores);
  const entry = await persistFusionTimeline(intelligenceId, scores, contextHash);
  emitFusionEvent(FUSION_EVENT.TIMELINE_RECORDED, { intelligenceId, timelineKey: entry.timelineKey });
  return entry;
}

export async function recordTimelineForLatest() {
  const intel = await prisma.marketIntelligence.findFirst({
    orderBy: { createdAt: "desc" },
  });
  if (!intel) return { recorded: false };

  const scores: CanonicalScores = {
    marketScore: intel.marketScore,
    trendScore: intel.trendScore,
    momentumScore: intel.momentumScore,
    volumeScore: intel.volumeScore,
    liquidityScore: intel.liquidityScore,
    orderBookScore: intel.orderBookScore,
    newsScore: intel.newsScore,
    whaleScore: intel.whaleScore,
    onChainScore: intel.onChainScore,
    portfolioScore: intel.portfolioScore,
    riskScore: intel.riskScore,
    learningScore: intel.learningScore,
    researchScore: intel.researchScore,
    macroScore: intel.macroScore,
    regimeScore: intel.regimeScore,
    volatilityScore: intel.volatilityScore,
    confidenceScore: intel.confidenceScore,
  };

  const entry = await recordFusionTimeline(intel.id, scores);
  return { recorded: true, entry };
}

export async function compareTimelineEntries(timelineKeyA: string, timelineKeyB: string) {
  const [a, b] = await Promise.all([
    prisma.fusionTimeline.findUnique({ where: { timelineKey: timelineKeyA } }),
    prisma.fusionTimeline.findUnique({ where: { timelineKey: timelineKeyB } }),
  ]);
  if (!a || !b) return { comparable: false };

  const scoresA = a.scores as unknown as CanonicalScores;
  const scoresB = b.scores as unknown as CanonicalScores;
  const deltas: Record<string, number> = {};
  for (const key of Object.keys(scoresA) as Array<keyof CanonicalScores>) {
    deltas[key] = Number((scoresB[key] - scoresA[key]).toFixed(2));
  }
  return { comparable: true, deltas, from: a.snapshotAt, to: b.snapshotAt };
}
