import { apiOk } from "@/lib/api";
import { getOpportunityEngine } from "@/src/server/opportunity/opportunity-engine";

export async function GET() {
  const engine = getOpportunityEngine();
  const last = engine.getLastResult();
  return apiOk({
    owner: "opportunity-engine",
    telemetry: engine.getTelemetry(),
    laneLeaders: {
      EARLY: (last?.laneLeaders.EARLY ?? []).slice(0, 10).map((row) => row.symbol),
      STEADY: (last?.laneLeaders.STEADY ?? []).slice(0, 10).map((row) => row.symbol),
      MOMENTUM: (last?.laneLeaders.MOMENTUM ?? []).slice(0, 10).map((row) => row.symbol),
      CONTINUATION: (last?.laneLeaders.CONTINUATION ?? []).slice(0, 10).map((row) => row.symbol),
    },
    filterSamples: last?.filterSamples ?? [],
    ranked: (last?.ranked ?? []).slice(0, 30).map((row) => ({
      candidateId: row.candidateId,
      symbol: row.symbol,
      primaryLane: row.primaryLane,
      secondaryEvidence: row.secondaryEvidence,
      score: row.score,
      breakdown: row.breakdown,
      state: row.state,
      firstDetectedAt: new Date(row.firstDetectedAt).toISOString(),
      firstDetectionPrice: row.firstDetectionPrice,
      currentPrice: row.currentPrice,
      reasonCodes: row.reasonCodes,
    })),
  });
}
