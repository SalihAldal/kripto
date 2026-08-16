import { createHash } from "node:crypto";
import {
  TDI_SENSITIVITY_SCHEMA_VERSION,
  type ForensicSessionContext,
  type TdiDecisionRecord,
  type TdiSensitivityReport,
} from "@/src/server/forensics/forensic.types";
import {
  getThresholdScore,
  normalizeTdiDecisionRecord,
  replayProductionTdiVerdict,
  SCORE_THRESHOLD_EXPLANATION,
  summarizeProductionReplayStatus,
} from "@/src/server/forensics/tdi-verdict-replay.service";

function deterministicHash(payload: unknown) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

const DEFAULT_THRESHOLD = 55;

function normalizeDecisions(decisions: TdiDecisionRecord[]) {
  return decisions.map((row) => normalizeTdiDecisionRecord(row));
}

function collectScoredThresholdValues(decisions: TdiDecisionRecord[]) {
  return decisions
    .map((row) => getThresholdScore(row))
    .filter((value): value is number => value != null && Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
}

function countScoreAboveThreshold(decisions: TdiDecisionRecord[], threshold: number) {
  return decisions.filter((row) => {
    const score = getThresholdScore(row);
    return score != null && score >= threshold;
  }).length;
}

export function buildTdiSensitivityReport(input: {
  session: ForensicSessionContext;
  currentThreshold?: number;
  variation?: number;
}): TdiSensitivityReport {
  const currentThreshold = input.currentThreshold ?? DEFAULT_THRESHOLD;
  const variation = input.variation ?? 2;
  const decisions = normalizeDecisions(input.session.tdiDecisions ?? []);
  const scores = collectScoredThresholdValues(decisions);
  const replays = decisions.map((row) => replayProductionTdiVerdict(row));
  const replaySummary = summarizeProductionReplayStatus(replays);

  const waitDistribution: TdiSensitivityReport["waitDistribution"] = {};
  for (const row of decisions.filter((d) => d.verdict === "WAIT")) {
    const code = row.waitReasonCode ?? "OTHER";
    waitDistribution[code] = (waitDistribution[code] ?? 0) + 1;
  }

  const runtimeApproved = decisions.filter((row) => row.verdict === "APPROVED").length;
  const runtimeWait = decisions.filter((row) => row.verdict === "WAIT").length;
  const runtimeRejected = decisions.filter((row) => row.verdict === "REJECTED").length;
  const replayApproved = replays.filter((row) => row.productionApprovalEquivalent).length;
  const replayWait = replays.filter((row) => row.verdict === "WAIT").length;
  const replayRejected = replays.filter((row) => row.verdict === "REJECTED").length;

  const total = Math.max(1, decisions.length);
  const scoreAboveThresholdCount = countScoreAboveThreshold(decisions, currentThreshold);
  const scoreAboveThresholdRate = round(scoreAboveThresholdCount / total);
  const runtimeApprovalEquivalentCount = replayApproved;
  const runtimeApprovalEquivalentRate = round(replayApproved / total);

  const sensitivityPoints = [-variation, 0, variation].map((delta) => {
    const effectiveThreshold = currentThreshold + delta;
    const scoreAboveAtThreshold = countScoreAboveThreshold(decisions, effectiveThreshold);
    const replayApprovedAtThreshold = decisions.filter((row, index) => {
      const score = getThresholdScore(row);
      return score != null && score >= effectiveThreshold && replays[index]?.productionApprovalEquivalent;
    }).length;
    const scoreAboveThresholdPointRate = round(
      scores.length > 0 ? scoreAboveAtThreshold / scores.length : scoreAboveAtThreshold / total,
    );
    const runtimeApprovalEquivalentPointRate = round(replayApprovedAtThreshold / total);
    return {
      thresholdDelta: delta,
      effectiveThreshold,
      scoreAboveThresholdRate: scoreAboveThresholdPointRate,
      runtimeApprovalEquivalentRate: runtimeApprovalEquivalentPointRate,
      waitRate: round(replayWait / total),
      noSlotRate: round((waitDistribution.NO_SLOT ?? 0) / total),
      falsePositiveEstimate: round(Math.max(0, scoreAboveAtThreshold - replayApprovedAtThreshold) / total),
      falseNegativeEstimate: round(Math.max(0, replayApprovedAtThreshold - scoreAboveAtThreshold) / total),
      sampleSize: scores.length,
      approvalRate: scoreAboveThresholdPointRate,
    };
  });

  const report: TdiSensitivityReport = {
    schemaVersion: TDI_SENSITIVITY_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    currentThreshold,
    scoreDistribution: {
      min: scores[0] ?? 0,
      max: scores[scores.length - 1] ?? 0,
      mean: scores.length > 0 ? round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      p50: percentile(scores, 50),
      p75: percentile(scores, 75),
      p90: percentile(scores, 90),
    },
    scoreAboveThresholdCount,
    scoreAboveThresholdRate,
    runtimeApprovalEquivalentCount,
    runtimeApprovalEquivalentRate,
    runtimeWaitCount: replayWait,
    runtimeRejectedCount: replayRejected,
    productionReplayStatus: replaySummary.status,
    productionReplayReason: replaySummary.reason,
    scoreThresholdExplanation: SCORE_THRESHOLD_EXPLANATION,
    waitDistribution,
    sensitivityPoints,
    recommendation: scores.length < 20 ? "INSUFFICIENT_DATA" : "NO_CHANGE",
    deterministicHash: "",
    approvalRate: round(runtimeApproved / total),
    compatibility: {
      approvalRateMeans: "runtimeApprovalEquivalentRate",
      scoreThresholdPassField: "scoreAboveThresholdRate",
      legacyApprovalRateWas: "mixed score threshold counterfactual (misleading)",
    },
  };

  report.deterministicHash = deterministicHash({
    schemaVersion: report.schemaVersion,
    currentThreshold,
    scoreAboveThresholdRate: report.scoreAboveThresholdRate,
    runtimeApprovalEquivalentRate: report.runtimeApprovalEquivalentRate,
    scoreDistribution: report.scoreDistribution,
    sensitivityPoints: report.sensitivityPoints.map((point) => ({
      effectiveThreshold: point.effectiveThreshold,
      scoreAboveThresholdRate: point.scoreAboveThresholdRate,
      runtimeApprovalEquivalentRate: point.runtimeApprovalEquivalentRate,
    })),
  });

  return report;
}

/** Read legacy v1 sensitivity artifacts without treating score pass as approval. */
export function normalizeLegacyTdiSensitivityArtifact(raw: Record<string, unknown>): Partial<TdiSensitivityReport> {
  if (raw.schemaVersion === TDI_SENSITIVITY_SCHEMA_VERSION) {
    return raw as Partial<TdiSensitivityReport>;
  }
  const legacyApproval = Number(raw.approvalRate ?? 0);
  const points = Array.isArray(raw.sensitivityPoints) ? raw.sensitivityPoints : [];
  return {
    ...raw,
    schemaVersion: TDI_SENSITIVITY_SCHEMA_VERSION,
    scoreAboveThresholdRate: Number((points.find((p) => p?.thresholdDelta === 0) as { approvalRate?: number })?.approvalRate ?? legacyApproval),
    runtimeApprovalEquivalentRate: legacyApproval,
    scoreThresholdExplanation: SCORE_THRESHOLD_EXPLANATION,
    compatibility: {
      approvalRateMeans: "runtimeApprovalEquivalentRate",
      scoreThresholdPassField: "scoreAboveThresholdRate",
      legacyApprovalRateWas: "mixed score threshold counterfactual (misleading)",
    },
  } as Partial<TdiSensitivityReport>;
}
