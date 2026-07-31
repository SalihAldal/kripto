import type { CanonicalScores, ConfidenceFusion, SourceSnapshots } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import { FUSION_SOURCES } from "@/src/server/intelligence-fusion/intelligence-fusion.types";
import { prisma } from "@/src/server/db/prisma";

function sourceAvailability(sources: SourceSnapshots): number {
  const available = Object.values(sources).filter((s) => s && !("unavailable" in s)).length;
  return (available / FUSION_SOURCES.length) * 100;
}

function scoreConsensus(scores: CanonicalScores): number {
  const values = [
    scores.newsScore, scores.whaleScore, scores.onChainScore,
    scores.momentumScore, scores.trendScore,
  ];
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / values.length;
  return Math.max(20, 100 - Math.sqrt(variance) * 2);
}

export async function fuseConfidence(scores: CanonicalScores, sources: SourceSnapshots): Promise<ConfidenceFusion> {
  const sourceConfidences = await prisma.sourceConfidence.findMany();
  const avgTrust = sourceConfidences.length > 0
    ? sourceConfidences.reduce((s, c) => s + c.trustScore, 0) / sourceConfidences.length
    : 50;
  const avgHistorical = sourceConfidences.length > 0
    ? sourceConfidences.reduce((s, c) => s + c.historicalAccuracy, 0) / sourceConfidences.length
    : 50;

  const dataConfidence = sourceAvailability(sources);
  const sourceConfidence = avgTrust;
  const historicalConfidence = avgHistorical;
  const consensusConfidence = scoreConsensus(scores);
  const predictionConfidence = Math.min(100, (scores.marketScore + scores.confidenceScore) / 2);
  const overallConfidence = Number(
    (
      (dataConfidence + sourceConfidence + historicalConfidence + consensusConfidence + predictionConfidence) / 5
    ).toFixed(1),
  );

  return {
    dataConfidence: Number(dataConfidence.toFixed(1)),
    sourceConfidence: Number(sourceConfidence.toFixed(1)),
    historicalConfidence: Number(historicalConfidence.toFixed(1)),
    consensusConfidence: Number(consensusConfidence.toFixed(1)),
    predictionConfidence: Number(predictionConfidence.toFixed(1)),
    overallConfidence,
  };
}

export async function getLatestConfidence() {
  const latest = await prisma.marketIntelligence.findFirst({
    where: { validationStatus: "PUBLISHED" },
    orderBy: { publishedAt: "desc" },
  });
  if (!latest?.metadata) {
    return {
      dataConfidence: 50,
      sourceConfidence: 50,
      historicalConfidence: 50,
      consensusConfidence: 50,
      predictionConfidence: 50,
      overallConfidence: latest?.confidenceScore ?? 50,
    };
  }
  return latest.metadata as unknown as ConfidenceFusion;
}
