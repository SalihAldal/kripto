import { describe, expect, it } from "vitest";
import {
  computeMinimumViableMove,
  evaluateCanonicalRegime,
  evaluateMultipleTesting,
  evaluateStrategies,
  routeStrategies,
  runNegativeControlLabelShuffle,
  walkForwardSplit,
} from "@/src/server/forensics/p4-regime-strategy-shadow";

const marketEventAt = "2026-09-02T00:00:00.000Z";
const evaluatedAt = "2026-09-02T00:00:05.000Z";

function baseInput() {
  return {
    candidateId: "cand-1",
    sourceType: "RECORDED_REPLAY" as const,
    marketEventAt,
    evaluatedAt,
    velocity: 0.8,
    acceleration: 0.85,
    volumeAcceleration: 0.9,
    relativeStrength: 0.75,
    spreadBps: 6,
    liquidityScore: 0.85,
    exhaustion: 0.2,
    momentum: 0.7,
    retracement: 0.35,
    breakoutHeld: true,
    rangeScore: 0.2,
    distanceFromMean: 0.2,
    flowRecovery: 0.8,
    staleFeatures: [],
    missingFeatures: [],
    entrySpread: 0.08,
    entrySlippage: 0.04,
    entryFee: 0.1,
    exitSpread: 0.08,
    exitSlippage: 0.04,
    exitFee: 0.1,
    strategyProfitBuffer: 0.12,
    expectedMovePercent: 1.2,
  };
}

describe("P4 shadow strategy engine", () => {
  it("has single canonical regime authority with deterministic output", () => {
    const input = {
      marketEventAt,
      detectedAt: evaluatedAt,
      trend: 0.7,
      volatility: 0.3,
      momentum: 0.5,
      transitionProbability: 0.2,
      chaosProbability: 0.1,
      pumpScore: 0.2,
    };
    const a = evaluateCanonicalRegime(input);
    const b = evaluateCanonicalRegime(input);
    expect(a.regime).toBe("BULL_TREND");
    expect(a).toEqual(b);
    expect(a.policyVersion).toBe("p4-regime-v1");
  });

  it("keeps explicit strategy identity enum and shadow-only evaluations", () => {
    const regime = evaluateCanonicalRegime({
      marketEventAt,
      detectedAt: evaluatedAt,
      trend: 0.6,
      volatility: 0.4,
      momentum: 0.5,
      transitionProbability: 0.1,
      chaosProbability: 0.1,
      pumpScore: 0.3,
    });
    const rows = evaluateStrategies(baseInput(), regime);
    expect(rows.map((row) => row.strategyId)).toEqual([
      "EARLY_ACCELERATION",
      "MOMENTUM_CONTINUATION",
      "BREAKOUT_RETEST",
      "STEADY_TREND",
      "RANGE_MEAN_REVERSION",
    ]);
    expect(rows.every((row) => row.shadowOnly)).toBe(true);
  });

  it("separates WAIT from INELIGIBLE via missing or stale features", () => {
    const regime = evaluateCanonicalRegime({
      marketEventAt,
      detectedAt: evaluatedAt,
      trend: 0.6,
      volatility: 0.4,
      momentum: 0.5,
      transitionProbability: 0.1,
      chaosProbability: 0.1,
      pumpScore: 0.3,
    });
    const waitRows = evaluateStrategies({ ...baseInput(), missingFeatures: ["acceleration"], expectedMovePercent: 2 }, regime);
    expect(waitRows.some((row) => row.verdict === "WAIT")).toBe(true);
    const ineligibleRows = evaluateStrategies({ ...baseInput(), expectedMovePercent: 0.1 }, regime);
    expect(ineligibleRows.some((row) => row.verdict === "INELIGIBLE")).toBe(true);
  });

  it("evaluates five strategy fixture behaviors", () => {
    const bull = evaluateCanonicalRegime({
      marketEventAt,
      detectedAt: evaluatedAt,
      trend: 0.8,
      volatility: 0.35,
      momentum: 0.7,
      transitionProbability: 0.2,
      chaosProbability: 0.1,
      pumpScore: 0.2,
    });
    const range = evaluateCanonicalRegime({
      marketEventAt,
      detectedAt: evaluatedAt,
      trend: 0.05,
      volatility: 0.2,
      momentum: 0.02,
      transitionProbability: 0.2,
      chaosProbability: 0.2,
      pumpScore: 0.1,
    });
    const bullish = evaluateStrategies(baseInput(), bull);
    expect(bullish.find((row) => row.strategyId === "EARLY_ACCELERATION")?.verdict).toBe("ELIGIBLE");
    expect(bullish.find((row) => row.strategyId === "MOMENTUM_CONTINUATION")?.verdict).toBe("ELIGIBLE");
    expect(bullish.find((row) => row.strategyId === "BREAKOUT_RETEST")?.verdict).toBe("ELIGIBLE");
    expect(bullish.find((row) => row.strategyId === "STEADY_TREND")?.verdict).toBe("ELIGIBLE");
    const meanReversion = evaluateStrategies(
      { ...baseInput(), rangeScore: 0.9, distanceFromMean: 0.9, flowRecovery: 0.8, momentum: 0.1, acceleration: 0.1 },
      range,
    );
    expect(meanReversion.find((row) => row.strategyId === "RANGE_MEAN_REVERSION")?.verdict).toBe("ELIGIBLE");
  });

  it("router is deterministic and does not force strategy", () => {
    const regime = evaluateCanonicalRegime({
      marketEventAt,
      detectedAt: evaluatedAt,
      trend: 0.01,
      volatility: 0.2,
      momentum: 0.01,
      transitionProbability: 0.2,
      chaosProbability: 0.2,
      pumpScore: 0.1,
    });
    const none = routeStrategies({ ...baseInput(), expectedMovePercent: 0.05 }, regime);
    expect(none.preferredStrategy).toBeNull();
    const lowVolRegime = evaluateCanonicalRegime({
      marketEventAt,
      detectedAt: evaluatedAt,
      trend: 0.2,
      volatility: 0.2,
      momentum: 0.1,
      transitionProbability: 0.2,
      chaosProbability: 0.2,
      pumpScore: 0.1,
    });
    const withConflict = routeStrategies({ ...baseInput(), rangeScore: 0.95, distanceFromMean: 0.9, flowRecovery: 0.9, expectedMovePercent: 1.6 }, lowVolRegime);
    expect(withConflict.shadowOnly).toBe(true);
    expect(withConflict.conflictStatus === "CONTRADICTORY" || withConflict.conflictStatus === "MULTIPLE_COMPATIBLE").toBe(true);
    expect(routeStrategies({ ...baseInput(), rangeScore: 0.95, distanceFromMean: 0.9, flowRecovery: 0.9, expectedMovePercent: 1.6 }, lowVolRegime)).toEqual(withConflict);
  });

  it("uses cost-aware viability and avoids double-cost math", () => {
    const mvm = computeMinimumViableMove(baseInput());
    expect(mvm).toBeCloseTo(0.56, 6);
    const regime = evaluateCanonicalRegime({
      marketEventAt,
      detectedAt: evaluatedAt,
      trend: 0.8,
      volatility: 0.3,
      momentum: 0.6,
      transitionProbability: 0.2,
      chaosProbability: 0.1,
      pumpScore: 0.2,
    });
    const rows = evaluateStrategies({ ...baseInput(), expectedMovePercent: 0.3 }, regime);
    expect(rows.some((row) => row.firstBlocker === "COST_NOT_VIABLE")).toBe(true);
  });

  it("walk-forward split is time-ordered with embargo and no lifecycle leak", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      lifecycleId: `lf-${Math.floor(i / 3)}`,
      eventAtMs: 1_700_000_000_000 + i * 60_000,
      labelEndAtMs: 1_700_000_000_000 + i * 60_000 + 15 * 60_000,
      rowId: i,
    }));
    const split = walkForwardSplit(rows, 5 * 60_000);
    const maxTrainLabelEnd = Math.max(...split.train.map((r) => r.labelEndAtMs ?? r.eventAtMs));
    expect(split.validation.every((r) => r.eventAtMs >= maxTrainLabelEnd + 5 * 60_000)).toBe(true);
    const trainLifecycles = new Set(split.train.map((r) => r.lifecycleId));
    expect(split.validation.every((r) => !trainLifecycles.has(r.lifecycleId))).toBe(true);
    expect(split.test.every((r) => !trainLifecycles.has(r.lifecycleId))).toBe(true);
  });

  it("negative control and multiple-testing corrections gate false discoveries", () => {
    expect(runNegativeControlLabelShuffle(0.55, 0.8)).toBe("FAIL");
    expect(runNegativeControlLabelShuffle(0.55, 0.56)).toBe("NOT_IMPLEMENTED");
    const mt = evaluateMultipleTesting({
      experimentCount: 5,
      parameterCount: 8,
      variantCount: 4,
      rawPValue: 0.01,
    });
    expect(mt.status).toBe("OK");
    expect(mt.significantAfterCorrection).toBe(false);
    const invalid = evaluateMultipleTesting({
      experimentCount: 5,
      parameterCount: 8,
      variantCount: 4,
      rawPValue: Number.NaN,
    });
    expect(invalid.status).toBe("INVALID_P_VALUE");
    expect(invalid.correctedPValue).toBeNull();
    expect(invalid.significantAfterCorrection).toBe(false);
  });
});
