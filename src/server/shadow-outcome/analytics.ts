import { proportionCI, quantile } from "@/src/server/shadow-outcome/metrics";
import type {
  HorizonOutcome,
  MissReason,
  MoverEvent,
  TrackedCandidate,
} from "@/src/server/shadow-outcome/types";

export const SCORE_BUCKETS = [
  { id: "60-69", min: 60, max: 70 },
  { id: "70-79", min: 70, max: 80 },
  { id: "80-84", min: 80, max: 85 },
  { id: "85-89", min: 85, max: 90 },
  { id: "90-94", min: 90, max: 95 },
  { id: "95-100", min: 95, max: 101 },
] as const;

const EARLY_BEFORE = [1, 2, 3, 5] as const;
const PRECISION_AT = [3, 5, 7, 10] as const;
const K_VALUES = [1, 3, 5, 10, 20] as const;

export function liveCandidates(rows: TrackedCandidate[], includeSynthetic = false) {
  return rows.filter((row) => {
    if (!includeSynthetic && row.snapshot.source === "synthetic") return false;
    if (row.invalidReason) return false;
    return true;
  });
}

export function uniqueByMove(rows: TrackedCandidate[]) {
  const best = new Map<string, TrackedCandidate>();
  for (const row of rows) {
    const current = best.get(row.moveKey);
    if (!current || row.snapshot.finalScore > current.snapshot.finalScore) {
      best.set(row.moveKey, row);
    }
  }
  return [...best.values()];
}

export function horizon(row: TrackedCandidate, min: number): HorizonOutcome | null {
  return row.outcomes.find((item) => item.horizonMin === min) ?? null;
}

export function validMfe(row: TrackedCandidate, min = 60) {
  const item = horizon(row, min);
  if (!item || item.quality !== "OK" || item.mfePct == null) return null;
  return item.mfePct;
}

export function isSuccess(row: TrackedCandidate, thresholdPct: number, horizonMin = 60) {
  const mfe = validMfe(row, horizonMin);
  return mfe != null && mfe >= thresholdPct;
}

export function precisionAt(rows: TrackedCandidate[], thresholdPct: number, horizonMin = 60) {
  const usable = rows.filter((row) => validMfe(row, horizonMin) != null);
  const successes = usable.filter((row) => isSuccess(row, thresholdPct, horizonMin)).length;
  return proportionCI(successes, usable.length);
}

export function precisionAtK(rows: TrackedCandidate[], k: number, thresholdPct = 5, horizonMin = 60) {
  const ranked = [...rows].sort((a, b) => {
    const ra = a.snapshot.initialRank ?? a.latestRank ?? Number.MAX_SAFE_INTEGER;
    const rb = b.snapshot.initialRank ?? b.latestRank ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return b.snapshot.finalScore - a.snapshot.finalScore;
  });
  return precisionAt(ranked.slice(0, k), thresholdPct, horizonMin);
}

export function scoreCalibration(rows: TrackedCandidate[], horizonMin = 60) {
  return SCORE_BUCKETS.map((bucket) => {
    const members = rows.filter((row) => {
      const score = row.snapshot.finalScore;
      return score >= bucket.min && score < bucket.max;
    });
    const mfes = members.map((row) => validMfe(row, horizonMin)).filter((v): v is number => v != null);
    const maes = members
      .map((row) => horizon(row, horizonMin)?.maePct)
      .filter((v): v is number => v != null);
    return {
      bucket: bucket.id,
      n: members.length,
      medianMfe: quantile(mfes, 50),
      averageMfe: mfes.length ? mfes.reduce((a, b) => a + b, 0) / mfes.length : null,
      medianMae: quantile(maes, 50),
      hit3: precisionAt(members, 3, horizonMin),
      hit5: precisionAt(members, 5, horizonMin),
      hit10: precisionAt(members, 10, horizonMin),
    };
  });
}

export function lanePerformance(rows: TrackedCandidate[], movers: MoverEvent[], horizonMin = 60) {
  const lanes = ["EARLY", "STEADY", "MOMENTUM", "CONTINUATION"] as const;
  return lanes.map((lane) => {
    const members = rows.filter((row) => row.snapshot.primaryLane === lane);
    const mfes = members.map((row) => validMfe(row, horizonMin)).filter((v): v is number => v != null);
    const maes = members
      .map((row) => horizon(row, horizonMin)?.maePct)
      .filter((v): v is number => v != null);
    const leads = leadTimes(members, movers).values;
    return {
      lane,
      n: members.length,
      medianMfe: quantile(mfes, 50),
      medianMae: quantile(maes, 50),
      precision3: precisionAt(members, 3, horizonMin),
      precision5: precisionAt(members, 5, horizonMin),
      precision10: precisionAt(members, 10, horizonMin),
      medianLeadMs: quantile(leads, 50),
      falsePositiveRate: 1 - (precisionAt(members, 3, horizonMin).rate || 0),
    };
  });
}

export function featureBuckets(rows: TrackedCandidate[], key: "rvol1m" | "priceAccelerationShort", horizonMin = 60) {
  const cuts =
    key === "rvol1m"
      ? [
          { id: "<1.5", min: 0, max: 1.5 },
          { id: "1.5-3", min: 1.5, max: 3 },
          { id: "3-5", min: 3, max: 5 },
          { id: ">5", min: 5, max: 999 },
        ]
      : [
          { id: "low", min: Number.NEGATIVE_INFINITY, max: 0.2 },
          { id: "mid", min: 0.2, max: 0.6 },
          { id: "high", min: 0.6, max: 999 },
        ];
  return cuts.map((cut) => {
    const members = rows.filter((row) => {
      const value = row.snapshot[key];
      return value != null && value >= cut.min && value < cut.max;
    });
    return { bucket: cut.id, n: members.length, precision5: precisionAt(members, 5, horizonMin) };
  });
}

export function classifyFalsePositive(row: TrackedCandidate): string | null {
  const mfe = validMfe(row, 60);
  if (row.snapshot.finalScore < 85 || mfe == null || mfe >= 1) return null;
  const mae = horizon(row, 60)?.maePct ?? 0;
  if ((row.snapshot.rvol1m ?? 99) < 1.2) return "LOW_LIQUIDITY";
  if ((row.snapshot.priceAccelerationShort ?? 0) < 0) return "FLOW_COLLAPSE";
  if (mae <= -3) return "BTC_REVERSAL";
  if ((row.snapshot.warnings ?? []).some((w) => w.includes("EXHAUST"))) return "HIGH_EXHAUSTION";
  if (row.snapshot.primaryLane === "CONTINUATION" || row.snapshot.primaryLane === "MOMENTUM") return "LATE_ENTRY";
  if (mfe < 0.3) return "NO_FOLLOW_THROUGH";
  return "FAKE_BREAKOUT";
}

export function falsePositives(rows: TrackedCandidate[]) {
  const hits = rows
    .map((row) => ({ row, pattern: classifyFalsePositive(row) }))
    .filter((item): item is { row: TrackedCandidate; pattern: string } => item.pattern != null);
  const counts: Record<string, number> = {};
  for (const item of hits) counts[item.pattern] = (counts[item.pattern] ?? 0) + 1;
  return { n: hits.length, patterns: counts, symbols: hits.map((item) => item.row.snapshot.symbol) };
}

export function worstHighConfidence(rows: TrackedCandidate[], minScore = 90) {
  return rows
    .filter((row) => row.snapshot.finalScore >= minScore)
    .map((row) => ({ row, mfe: validMfe(row, 60) }))
    .filter((item) => item.mfe != null && item.mfe < 1)
    .sort((a, b) => (a.mfe ?? 0) - (b.mfe ?? 0));
}

export function bestSignals(rows: TrackedCandidate[]) {
  return [...rows]
    .map((row) => ({
      row,
      mfe15: validMfe(row, 15),
      mfe30: validMfe(row, 30),
      mfe60: validMfe(row, 60),
      mae: horizon(row, 60)?.maePct ?? null,
    }))
    .filter((item) => item.mfe60 != null)
    .sort((a, b) => (b.mfe60 ?? 0) - (a.mfe60 ?? 0));
}

export function moverRecall(movers: MoverEvent[], rows: TrackedCandidate[], moveClass = 10) {
  const target = movers.filter((row) => row.moveClass === moveClass);
  let detected = 0;
  for (const mover of target) {
    if (matchingCandidate(mover, rows)) detected += 1;
  }
  return { n: target.length, detected, recall: target.length ? detected / target.length : 0 };
}

export function earlyRecall(movers: MoverEvent[], rows: TrackedCandidate[], moveClass = 10) {
  const target = movers.filter((row) => row.moveClass === moveClass);
  const result: Record<string, { n: number; detected: number; recall: number }> = {};
  for (const pct of EARLY_BEFORE) {
    let detected = 0;
    for (const mover of target) {
      const cand = matchingCandidate(mover, rows);
      if (!cand) continue;
      const moveAtDetect =
        ((cand.snapshot.firstDetectionPrice - mover.moveStartPrice) / mover.moveStartPrice) * 100;
      if (moveAtDetect < pct) detected += 1;
    }
    result[`before${pct}`] = { n: target.length, detected, recall: target.length ? detected / target.length : 0 };
  }
  return result;
}

export function leadTimes(rows: TrackedCandidate[], movers: MoverEvent[], moveClass = 10) {
  const values: number[] = [];
  for (const mover of movers.filter((row) => row.moveClass === moveClass)) {
    const cand = matchingCandidate(mover, rows);
    if (!cand) continue;
    values.push(mover.thresholdReachedAt - cand.snapshot.firstDetectedAt);
  }
  return {
    n: values.length,
    values,
    median: quantile(values, 50),
    p25: quantile(values, 25),
    p75: quantile(values, 75),
    p90: quantile(values, 90),
  };
}

export function matchingCandidate(mover: MoverEvent, rows: TrackedCandidate[]) {
  const windowStart = mover.moveStartAt - 15 * 60_000;
  const matches = rows.filter(
    (row) =>
      row.snapshot.symbol === mover.symbol &&
      row.snapshot.firstDetectedAt >= windowStart &&
      row.snapshot.firstDetectedAt <= mover.thresholdReachedAt,
  );
  if (!matches.length) return null;
  return matches.sort((a, b) => a.snapshot.firstDetectedAt - b.snapshot.firstDetectedAt)[0];
}

export function lateDetectionRate(movers: MoverEvent[], rows: TrackedCandidate[], moveClass = 10, fraction = 0.5) {
  const target = movers.filter((row) => row.moveClass === moveClass);
  let late = 0;
  let seen = 0;
  for (const mover of target) {
    const cand = matchingCandidate(mover, rows);
    if (!cand) continue;
    seen += 1;
    const moveAtDetect =
      ((cand.snapshot.firstDetectionPrice - mover.moveStartPrice) / mover.moveStartPrice) * 100;
    if (mover.peakMovePct > 0 && moveAtDetect / mover.peakMovePct > fraction) late += 1;
  }
  return { n: seen, late, rate: seen ? late / seen : 0 };
}

export function classifyMiss(mover: MoverEvent, rows: TrackedCandidate[], extras?: {
  universeExcluded?: boolean;
  liquidityRejected?: boolean;
  stale?: boolean;
  maxPreMoveScore?: number | null;
  minTrackScore?: number;
}): { reason: MissReason; detail: string } {
  if (extras?.universeExcluded) return { reason: "UNIVERSE_EXCLUDED", detail: "symbol not in tradeable universe" };
  if (extras?.stale) return { reason: "STALE_DATA", detail: "pre-move market state stale" };
  if (extras?.liquidityRejected) return { reason: "LOW_LIQUIDITY", detail: "liquidity filter dropped symbol" };
  const cand = matchingCandidate(mover, rows);
  if (!cand) {
    if (extras?.maxPreMoveScore != null && extras.maxPreMoveScore < (extras.minTrackScore ?? 58)) {
      return { reason: "SCORE_BELOW_THRESHOLD", detail: `max pre-move score ${extras.maxPreMoveScore}` };
    }
    return { reason: "NOT_DETECTED", detail: "no candidate in move window" };
  }
  const moveAtDetect =
    ((cand.snapshot.firstDetectionPrice - mover.moveStartPrice) / mover.moveStartPrice) * 100;
  if (mover.peakMovePct > 0 && moveAtDetect / mover.peakMovePct > 0.5) {
    return { reason: "LATE_DETECTION", detail: `detected after ${moveAtDetect.toFixed(1)}% of ${mover.peakMovePct.toFixed(1)}% peak` };
  }
  return { reason: "UNKNOWN", detail: "detected but not classified as miss" };
}

export function missedMovers(movers: MoverEvent[], rows: TrackedCandidate[], moveClass = 10) {
  return movers
    .filter((row) => row.moveClass === moveClass)
    .map((mover) => {
      const cand = matchingCandidate(mover, rows);
      const miss = classifyMiss(mover, rows);
      return {
        symbol: mover.symbol,
        peakMovePct: mover.peakMovePct,
        moveStartAt: mover.moveStartAt,
        peakAt: mover.peakAt,
        firstDetectedAt: cand?.snapshot.firstDetectedAt ?? null,
        firstDetectionPrice: cand?.snapshot.firstDetectionPrice ?? null,
        detectedLane: cand?.snapshot.primaryLane ?? null,
        missReason: cand && miss.reason === "UNKNOWN" ? null : miss.reason,
        detail: miss.detail,
      };
    })
    .filter((row) => row.missReason != null);
}

export function pipelineValue(rows: TrackedCandidate[]) {
  const stages = [
    { id: "OPPORTUNITY", test: (row: TrackedCandidate) => true },
    { id: "HOT", test: (row: TrackedCandidate) => row.hotAt != null },
    { id: "MICRO_CONFIRMED", test: (row: TrackedCandidate) => row.microConfirmedAt != null },
    { id: "EXECUTION_READY", test: (row: TrackedCandidate) => row.executionReadyAt != null },
  ];
  return stages.map((stage) => {
    const members = rows.filter(stage.test);
    return { stage: stage.id, n: members.length, precision5: precisionAt(members, 5) };
  });
}

export function gateLoss(rows: TrackedCandidate[], movers: MoverEvent[], moveClass = 10) {
  const target = movers.filter((row) => row.moveClass === moveClass);
  const hit = (pred: (row: TrackedCandidate) => boolean) =>
    target.filter((mover) => {
      const cand = matchingCandidate(mover, rows);
      return cand ? pred(cand) : false;
    }).length;
  return {
    discovered: hit(() => true),
    hot: hit((row) => row.hotAt != null),
    microConfirmed: hit((row) => row.microConfirmedAt != null),
    executionReady: hit((row) => row.executionReadyAt != null),
    droppedAfterHot: hit((row) => row.hotAt != null && row.microConfirmedAt == null),
    nMovers: target.length,
  };
}

export function latencyAttribution(rows: TrackedCandidate[]) {
  const diffs = (from: (row: TrackedCandidate) => number | null, to: (row: TrackedCandidate) => number | null) => {
    const values = rows
      .map((row) => {
        const a = from(row);
        const b = to(row);
        return a != null && b != null ? b - a : null;
      })
      .filter((v): v is number => v != null);
    return { n: values.length, medianMs: quantile(values, 50) };
  };
  return {
    detectionToHot: diffs((row) => row.snapshot.firstDetectedAt, (row) => row.hotAt),
    hotToMicro: diffs((row) => row.hotAt, (row) => row.microConfirmedAt),
    microToReady: diffs((row) => row.microConfirmedAt, (row) => row.executionReadyAt),
  };
}

export function segmentBy<T extends string>(rows: TrackedCandidate[], key: (row: TrackedCandidate) => T) {
  const groups = new Map<T, TrackedCandidate[]>();
  for (const row of rows) {
    const id = key(row);
    const list = groups.get(id) ?? [];
    list.push(row);
    groups.set(id, list);
  }
  return [...groups.entries()].map(([id, members]) => ({
    id,
    n: members.length,
    precision5: precisionAt(members, 5),
    medianMfe: quantile(members.map((row) => validMfe(row, 60)).filter((v): v is number => v != null), 50),
  }));
}

export function aiValue(rows: TrackedCandidate[]) {
  return segmentBy(rows, (row) => {
    const status = (row.snapshot.aiStatus ?? "NO_OPINION").toUpperCase();
    if (status.includes("BULL")) return "BULLISH";
    if (status.includes("CAUTION")) return "CAUTION";
    if (status.includes("TIMEOUT")) return "TIMEOUT";
    if (status.includes("NEUTRAL")) return "NEUTRAL";
    return "NO_OPINION";
  });
}

export function tdiValue(rows: TrackedCandidate[]) {
  return segmentBy(rows, (row) => {
    const decision = (row.snapshot.tdiDecision ?? "NO_OPINION").toUpperCase();
    if (decision.includes("BUY")) return "BUY";
    if (decision.includes("SELL")) return "SELL";
    return "NO_OPINION";
  });
}

export function entryPolicySimulation(rows: TrackedCandidate[]) {
  const policies = [
    { id: "FIRST_HOT", at: (row: TrackedCandidate) => row.hotAt },
    { id: "MICRO_CONFIRMED", at: (row: TrackedCandidate) => row.microConfirmedAt },
    { id: "EXECUTION_READY", at: (row: TrackedCandidate) => row.executionReadyAt },
    { id: "TOP5", at: (row: TrackedCandidate) => ((row.snapshot.initialRank ?? 99) <= 5 ? row.snapshot.firstDetectedAt : null) },
  ];
  return policies.map((policy) => {
    const members = rows.filter((row) => policy.at(row) != null);
    return { policy: policy.id, n: members.length, precision5: precisionAt(members, 5) };
  });
}

export function rawExpectancyProxy(rows: TrackedCandidate[]) {
  const models = [
    { id: "TP3_SL1_5", tp: 3, sl: -1.5 },
    { id: "TP5_SL2", tp: 5, sl: -2 },
  ];
  return models.map((model) => {
    const usable = rows.filter((row) => validMfe(row, 60) != null);
    const pnls = usable.map((row) => {
      const mfe = validMfe(row, 60) ?? 0;
      const mae = horizon(row, 60)?.maePct ?? 0;
      if (mae <= model.sl) return model.sl;
      if (mfe >= model.tp) return model.tp;
      return horizon(row, 60)?.returnPct ?? 0;
    });
    const avg = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null;
    return { model: model.id, n: pnls.length, rawExpectancyPct: avg, note: "research proxy; fees/slippage excluded" };
  });
}

export function randomBaseline(mfes: number[]) {
  return {
    n: mfes.length,
    medianMfe: quantile(mfes, 50),
    hit5: proportionCI(mfes.filter((v) => v >= 5).length, mfes.length),
  };
}

export function thresholdSensitivity(rows: TrackedCandidate[], movers: MoverEvent[], thresholds = [75, 80, 85, 90]) {
  return thresholds.map((threshold) => {
    const members = rows.filter((row) => row.snapshot.finalScore >= threshold);
    const recall = moverRecall(movers, members, 10);
    const early = earlyRecall(movers, members, 10);
    return {
      threshold,
      candidateCount: members.length,
      precision5: precisionAt(members, 5),
      recall: recall.recall,
      earlyRecall3: early.before3.recall,
    };
  });
}

export function marketSegments(rows: TrackedCandidate[]) {
  return {
    btc: segmentBy(rows, (row) => {
      const v = row.snapshot.btcReturn1m ?? 0;
      if (v > 0.15) return "BTC_POSITIVE";
      if (v < -0.15) return "BTC_NEGATIVE";
      return "BTC_FLAT";
    }),
    breadth: segmentBy(rows, (row) => {
      const v = row.snapshot.marketBreadthPctPositive1m ?? 50;
      if (v >= 62) return "BREADTH_STRONG";
      if (v <= 38) return "BREADTH_WEAK";
      return "BREADTH_NEUTRAL";
    }),
  };
}

export function dashboardSummary(input: {
  rows: TrackedCandidate[];
  movers: MoverEvent[];
}) {
  const rows = uniqueByMove(liveCandidates(input.rows));
  const lanes = lanePerformance(rows, input.movers);
  const bestLane = [...lanes].sort((a, b) => (b.precision5.rate ?? 0) - (a.precision5.rate ?? 0))[0];
  const worstLane = [...lanes].sort((a, b) => (a.precision5.rate ?? 0) - (b.precision5.rate ?? 0))[0];
  const missed = missedMovers(input.movers, rows, 10);
  return {
    moverRecall: moverRecall(input.movers, rows, 10),
    earlyRecall: earlyRecall(input.movers, rows, 10),
    precision5: precisionAt(rows, 5),
    precisionAtK: Object.fromEntries(K_VALUES.map((k) => [k, precisionAtK(rows, k, 5)])),
    top5Mfe: quantile(
      [...rows]
        .sort((a, b) => (a.snapshot.initialRank ?? 99) - (b.snapshot.initialRank ?? 99))
        .slice(0, 5)
        .map((row) => validMfe(row, 60))
        .filter((v): v is number => v != null),
      50,
    ),
    medianMae: quantile(rows.map((row) => horizon(row, 60)?.maePct).filter((v): v is number => v != null), 50),
    bestLane: bestLane?.lane ?? null,
    worstLane: worstLane?.lane ?? null,
    missedBigMovers: missed.length,
    lateDetectionRate: lateDetectionRate(input.movers, rows, 10),
  };
}

export function scoreComponentAblation(rows: TrackedCandidate[]) {
  const rankBy = (scoreOf: (row: TrackedCandidate) => number) =>
    [...rows]
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .map((row, index) => ({ candidateId: row.snapshot.candidateId, rank: index + 1, score: scoreOf(row) }));
  return {
    full: rankBy((row) => row.snapshot.finalScore),
    withoutAi: rankBy((row) => row.snapshot.finalScore - (row.snapshot.aiModifier ?? 0)),
    withoutMicro: rankBy((row) => row.snapshot.opportunityScore),
    withoutAcceleration: rankBy((row) => row.snapshot.finalScore - Math.max(0, (row.snapshot.priceAccelerationShort ?? 0) * 10)),
  };
}

export { PRECISION_AT, K_VALUES, EARLY_BEFORE };
