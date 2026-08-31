import { apiOk } from "@/lib/api";
import { getMicrostructureEngine } from "@/src/server/microstructure/microstructure-engine";

export async function GET() {
  const engine = getMicrostructureEngine();
  const ranked = engine.getRanked();
  return apiOk({
    owner: "microstructure-engine",
    telemetry: engine.getTelemetry(),
    ranked: ranked.slice(0, 30).map((row) => ({
      candidateId: row.candidateId,
      symbol: row.symbol,
      lane: row.lane,
      state: row.state,
      rank: row.rank,
      opportunityScore: row.opportunityScore,
      microScore: row.microScore,
      liquidityScore: row.liquidityScore,
      executionQuality: row.executionQuality,
      finalScore: row.smoothedScore,
      ai: row.ai,
      tdi: row.tdi,
      reasonCodes: row.reasonCodes,
      warnings: row.warnings,
      firstDetectedAt: new Date(row.firstDetectedAt).toISOString(),
      firstDetectionPrice: row.firstDetectionPrice,
      microReadyAt: row.microReadyAt ? new Date(row.microReadyAt).toISOString() : null,
    })),
  });
}
