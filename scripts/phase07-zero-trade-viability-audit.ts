import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/src/server/db/prisma";
import { resolveRuntimeConfigSnapshot } from "@/src/server/forensics/resolved-config.service";

type JsonRecord = Record<string, unknown>;

function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const rows = await prisma.shadowCandidateOutcome.findMany({
    select: { candidateId: true, snapshot: true, journey: true },
    orderBy: { detectedAt: "asc" },
    take: 6000,
  });

  const stats = {
    opportunityScore: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    microScore: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    finalScore: { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
  };
  const stageCounters: Record<string, number> = {
    CANDIDATE_DISCOVERED: 0,
    CANDIDATE_HOT: 0,
    MICRO_ANALYZED: 0,
    MICRO_CONFIRMED: 0,
    FINAL_RANKED: 0,
    EXECUTION_READY: 0,
    RISK_ALLOWED: 0,
    PAPER_OPENED: 0,
  };

  const hasStage = (journey: unknown, stage: string) =>
    Array.isArray(journey) &&
    journey.some((item) => {
      const rec = (item ?? {}) as JsonRecord;
      return String(rec.stage ?? rec.state ?? "").toUpperCase() === stage;
    });

  for (const row of rows) {
    const snapshot = (row.snapshot ?? {}) as JsonRecord;
    const os = num(snapshot.opportunityScore);
    const ms = num(snapshot.microScore);
    const fs = num(snapshot.finalScore);
    if (os != null) {
      stats.opportunityScore.min = Math.min(stats.opportunityScore.min, os);
      stats.opportunityScore.max = Math.max(stats.opportunityScore.max, os);
    }
    if (ms != null) {
      stats.microScore.min = Math.min(stats.microScore.min, ms);
      stats.microScore.max = Math.max(stats.microScore.max, ms);
    }
    if (fs != null) {
      stats.finalScore.min = Math.min(stats.finalScore.min, fs);
      stats.finalScore.max = Math.max(stats.finalScore.max, fs);
    }
    if (hasStage(row.journey, "DISCOVERED")) stageCounters.CANDIDATE_DISCOVERED += 1;
    if (hasStage(row.journey, "HOT") || hasStage(row.journey, "PROMOTED")) stageCounters.CANDIDATE_HOT += 1;
    if (hasStage(row.journey, "MICRO_ANALYZED") || hasStage(row.journey, "WARMING")) stageCounters.MICRO_ANALYZED += 1;
    if (hasStage(row.journey, "MICRO_CONFIRMED")) stageCounters.MICRO_CONFIRMED += 1;
    if (hasStage(row.journey, "FINAL_RANKED")) stageCounters.FINAL_RANKED += 1;
    if (hasStage(row.journey, "EXECUTION_READY")) stageCounters.EXECUTION_READY += 1;
    if (hasStage(row.journey, "RISK_ALLOWED")) stageCounters.RISK_ALLOWED += 1;
    if (hasStage(row.journey, "PAPER_OPENED")) stageCounters.PAPER_OPENED += 1;
  }

  const config = await resolveRuntimeConfigSnapshot().catch(() => null);
  const strategy = (config?.strategyConfig as JsonRecord | undefined) ?? {};
  const thresholds = {
    hotMinScore: num(strategy.hotMinScore),
    microMinScore: num(strategy.microMinScore),
    finalMinScore: num(strategy.finalMinScore),
  };
  const mismatches = [
    thresholds.hotMinScore != null && Number.isFinite(stats.opportunityScore.max) && stats.opportunityScore.max < thresholds.hotMinScore
      ? "HOT_SCORE_THRESHOLD_ABOVE_OBSERVED_MAX"
      : null,
    thresholds.microMinScore != null && Number.isFinite(stats.microScore.max) && stats.microScore.max < thresholds.microMinScore
      ? "MICRO_SCORE_THRESHOLD_ABOVE_OBSERVED_MAX"
      : null,
    thresholds.finalMinScore != null && Number.isFinite(stats.finalScore.max) && stats.finalScore.max < thresholds.finalMinScore
      ? "FINAL_SCORE_THRESHOLD_ABOVE_OBSERVED_MAX"
      : null,
  ].filter((row): row is string => Boolean(row));

  const funnelViability = {
    CAN_PRODUCE_HOT: stageCounters.CANDIDATE_HOT > 0,
    CAN_PRODUCE_MICRO_CONFIRMED: stageCounters.MICRO_CONFIRMED > 0,
    CAN_PRODUCE_FINAL_RANKED: stageCounters.FINAL_RANKED > 0,
    CAN_PRODUCE_EXECUTION_READY: stageCounters.EXECUTION_READY > 0,
    CAN_PRODUCE_RISK_ALLOW: stageCounters.RISK_ALLOWED > 0,
    CAN_PRODUCE_PAPER_OPEN: stageCounters.PAPER_OPENED > 0,
  };

  const result = {
    generatedAt: new Date().toISOString(),
    candidateCount: rows.length,
    observedRanges: stats,
    configuredThresholds: thresholds,
    thresholdMismatches: mismatches,
    stageCounters,
    funnelViability,
    longPaperRunViabilityReady: Object.values(funnelViability).every(Boolean) && mismatches.length === 0,
  };
  const outDir = path.join(process.cwd(), "artifacts", "forensics", "prevalidation");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "phase07-zero-trade-viability-audit.json");
  writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ outPath, funnelViability: result.funnelViability, mismatches }, null, 2)}\n`);
  await prisma.$disconnect();
}

void main();
