import {
  aiValue,
  bestSignals,
  dashboardSummary,
  earlyRecall,
  entryPolicySimulation,
  falsePositives,
  featureBuckets,
  gateLoss,
  lanePerformance,
  lateDetectionRate,
  latencyAttribution,
  leadTimes,
  liveCandidates,
  marketSegments,
  missedMovers,
  moverRecall,
  pipelineValue,
  precisionAt,
  precisionAtK,
  rawExpectancyProxy,
  scoreCalibration,
  scoreComponentAblation,
  tdiValue,
  thresholdSensitivity,
  uniqueByMove,
  worstHighConfidence,
} from "@/src/server/shadow-outcome/analytics";
import type { MoverEvent, TrackedCandidate } from "@/src/server/shadow-outcome/types";

export function getDailyEdgeReport(input: {
  date?: string;
  rows: TrackedCandidate[];
  movers: MoverEvent[];
  includeSynthetic?: boolean;
  universeSize?: number;
}) {
  const rows = uniqueByMove(liveCandidates(input.rows, input.includeSynthetic));
  const candidateLevel = liveCandidates(input.rows, input.includeSynthetic);
  return {
    date: input.date ?? new Date().toISOString().slice(0, 10),
    universeSize: input.universeSize ?? null,
    candidateCount: candidateLevel.length,
    uniqueMoveCount: rows.length,
    uniqueSymbols: new Set(rows.map((row) => row.snapshot.symbol)).size,
    groundTruth: {
      move1: input.movers.filter((row) => row.moveClass === 1).length,
      move2: input.movers.filter((row) => row.moveClass === 2).length,
      move3: input.movers.filter((row) => row.moveClass === 3).length,
      move5: input.movers.filter((row) => row.moveClass === 5).length,
      move7: input.movers.filter((row) => row.moveClass === 7).length,
      move10: input.movers.filter((row) => row.moveClass === 10).length,
      move15: input.movers.filter((row) => row.moveClass === 15).length,
      move20: input.movers.filter((row) => row.moveClass === 20).length,
    },
    recall: moverRecall(input.movers, rows, 10),
    earlyRecall: earlyRecall(input.movers, rows, 10),
    leadTime: leadTimes(rows, input.movers, 10),
    precision: {
      at3: precisionAt(rows, 3),
      at5: precisionAt(rows, 5),
      at7: precisionAt(rows, 7),
      at10: precisionAt(rows, 10),
    },
    precisionAtK: {
      top1: precisionAtK(rows, 1),
      top3: precisionAtK(rows, 3),
      top5: precisionAtK(rows, 5),
      top10: precisionAtK(rows, 10),
      top20: precisionAtK(rows, 20),
    },
    dashboard: dashboardSummary({ rows: candidateLevel, movers: input.movers }),
  };
}

export function getLanePerformance(rows: TrackedCandidate[], movers: MoverEvent[]) {
  return lanePerformance(uniqueByMove(liveCandidates(rows)), movers);
}

export function getMoverRecall(rows: TrackedCandidate[], movers: MoverEvent[], moveClass = 10) {
  return moverRecall(movers, uniqueByMove(liveCandidates(rows)), moveClass);
}

export function getMissedMovers(rows: TrackedCandidate[], movers: MoverEvent[], moveClass = 10) {
  return missedMovers(movers, uniqueByMove(liveCandidates(rows)), moveClass);
}

export function getScoreCalibration(rows: TrackedCandidate[]) {
  return scoreCalibration(uniqueByMove(liveCandidates(rows)));
}

export function getTopSignals(rows: TrackedCandidate[], limit = 20) {
  return bestSignals(uniqueByMove(liveCandidates(rows))).slice(0, limit);
}

export function getEdgeAnalytics(rows: TrackedCandidate[], movers: MoverEvent[]) {
  const unique = uniqueByMove(liveCandidates(rows));
  return {
    lanes: getLanePerformance(rows, movers),
    calibration: getScoreCalibration(rows),
    falsePositives: falsePositives(unique),
    worstHighConfidence: worstHighConfidence(unique).slice(0, 20),
    pipeline: pipelineValue(unique),
    gates: gateLoss(unique, movers, 10),
    latency: latencyAttribution(unique),
    ai: aiValue(unique),
    tdi: tdiValue(unique),
    features: {
      rvol: featureBuckets(unique, "rvol1m"),
      acceleration: featureBuckets(unique, "priceAccelerationShort"),
    },
    market: marketSegments(unique),
    entryPolicies: entryPolicySimulation(unique),
    lateDetection: lateDetectionRate(movers, unique, 10),
    thresholdSensitivity: thresholdSensitivity(unique, movers),
    ablation: scoreComponentAblation(unique),
    rawExpectancy: rawExpectancyProxy(unique),
    missed: getMissedMovers(rows, movers, 10),
    topSignals: getTopSignals(rows, 15),
  };
}
