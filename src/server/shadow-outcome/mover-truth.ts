import { randomUUID } from "node:crypto";
import { MOVER_SPECS } from "@/src/server/shadow-outcome/config";
import { pctChange, type PricePoint } from "@/src/server/shadow-outcome/metrics";
import type { MoveClass, MoverEvent } from "@/src/server/shadow-outcome/types";

/**
 * Independent of Opportunity/Micro engines.
 * Uses only prices at or before `now` (lookahead-safe).
 * Primary signal is rolling-window return, not 24h change.
 */
export function detectMoverEvents(input: {
  symbol: string;
  points: PricePoint[];
  now: number;
  runId?: string | null;
}): MoverEvent[] {
  const points = input.points.filter((row) => row.t <= input.now).sort((a, b) => a.t - b.t);
  if (points.length < 4) return [];
  const events: MoverEvent[] = [];
  for (const spec of MOVER_SPECS) {
    const horizonMs = spec.horizonMin * 60_000;
    let lastEmit = Number.NEGATIVE_INFINITY;
    let baselineIndex = 0;
    for (let i = 0; i < points.length; i += 1) {
      const end = points[i];
      const startBound = end.t - horizonMs;
      while (baselineIndex < i && points[baselineIndex].t < startBound) {
        baselineIndex += 1;
      }
      const baseline = points[Math.max(0, baselineIndex - 1)] ?? points[0];
      if (end.t - baseline.t < horizonMs * 0.45) continue;
      const move = pctChange(baseline.price, end.high ?? end.price);
      if (move == null || move < spec.moveClass) continue;
      if (end.t - lastEmit < horizonMs * 0.5) continue;
      lastEmit = end.t;
      const start = findMoveStart(points, baseline, end);
      const peak = findPeak(points, start.t, end.t + horizonMs);
      events.push({
        moverId: `mvr_${randomUUID()}`,
        runId: input.runId ?? null,
        symbol: input.symbol.toUpperCase(),
        moveClass: spec.moveClass as MoveClass,
        horizonMin: spec.horizonMin,
        moveStartAt: start.t,
        moveStartPrice: start.price,
        thresholdPrice: end.high ?? end.price,
        thresholdReachedAt: end.t,
        peakAt: peak.t,
        peakPrice: peak.high ?? peak.price,
        peakMovePct: pctChange(start.price, peak.high ?? peak.price) ?? move,
        status: "THRESHOLD_REACHED",
      });
    }
  }
  return events;
}

function findMoveStart(points: PricePoint[], baseline: PricePoint, threshold: PricePoint) {
  for (const row of points) {
    if (row.t < baseline.t || row.t > threshold.t) continue;
    const fromBase = pctChange(baseline.price, row.price) ?? 0;
    if (fromBase >= 0.3) return row;
  }
  return baseline;
}

function findPeak(points: PricePoint[], from: number, to: number): PricePoint {
  let peak = points[0];
  for (const row of points) {
    if (row.t < from || row.t > to) continue;
    if ((row.high ?? row.price) > (peak.high ?? peak.price)) peak = row;
  }
  return peak;
}
