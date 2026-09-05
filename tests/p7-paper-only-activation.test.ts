import { describe, expect, it } from "vitest";
import { evaluateCanonicalRegime, evaluateStrategies, routeStrategies } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { classifyTerminalReason, resolveStrategyActivationMode } from "@/src/server/execution/p7-paper-strategy-contract";

const t0 = "2026-09-02T00:00:00.000Z";
const t1 = "2026-09-02T00:00:05.000Z";

function fixture(expectedMovePercent: number) {
  return {
    candidateId: "cand-p7",
    sourceType: "SYNTHETIC_FIXTURE" as const,
    marketEventAt: t0,
    evaluatedAt: t1,
    velocity: 0.85,
    acceleration: 0.8,
    volumeAcceleration: 0.8,
    relativeStrength: 0.8,
    spreadBps: 5,
    liquidityScore: 0.9,
    exhaustion: 0.2,
    momentum: 0.7,
    retracement: 0.4,
    breakoutHeld: true,
    rangeScore: 0.8,
    distanceFromMean: 0.8,
    flowRecovery: 0.8,
    staleFeatures: [],
    missingFeatures: [],
    entrySpread: 0.08,
    entrySlippage: 0.03,
    entryFee: 0.1,
    exitSpread: 0.08,
    exitSlippage: 0.03,
    exitFee: 0.1,
    strategyProfitBuffer: 0.12,
    expectedMovePercent,
  };
}

describe("P7 paper-only activation contract", () => {
  it("keeps live mode hard-blocked", () => {
    const live = resolveStrategyActivationMode({
      executionMode: "live",
      strategyStatus: "OFFLINE_CANDIDATE",
      liveTradingEnabled: true,
    });
    expect(live).toBe("LIVE_DISABLED");
  });

  it("permits paper experiment only in paper mode", () => {
    expect(
      resolveStrategyActivationMode({
        executionMode: "paper",
        strategyStatus: "PAPER_EXPERIMENT",
        liveTradingEnabled: false,
      }),
    ).toBe("PAPER_ELIGIBLE");
    expect(
      resolveStrategyActivationMode({
        executionMode: "dry-run",
        strategyStatus: "PAPER_EXPERIMENT",
        liveTradingEnabled: false,
      }),
    ).toBe("SHADOW_ONLY");
  });

  it("classifies WAIT and REJECT with canonical reason codes", () => {
    const wait = classifyTerminalReason("WAIT:STALE_DATA market snapshot aged");
    expect(wait.decision).toBe("WAIT");
    expect(wait.reasonCode).toBe("STALE_DATA");
    const reject = classifyTerminalReason("RISK_GATE_BLOCKED: spread too high");
    expect(reject.decision).toBe("REJECT");
    expect(reject.reasonCode).toBe("SPREAD_TOO_HIGH");
  });

  it("covers five-strategy positive and negative fixture paths deterministically", () => {
    const bull = evaluateCanonicalRegime({
      marketEventAt: t0,
      detectedAt: t1,
      trend: 0.8,
      volatility: 0.3,
      momentum: 0.7,
      transitionProbability: 0.2,
      chaosProbability: 0.1,
      pumpScore: 0.2,
    });
    const range = evaluateCanonicalRegime({
      marketEventAt: t0,
      detectedAt: t1,
      trend: 0.05,
      volatility: 0.2,
      momentum: 0.05,
      transitionProbability: 0.2,
      chaosProbability: 0.1,
      pumpScore: 0.1,
    });
    const positive = evaluateStrategies(fixture(1.5), bull);
    const negative = evaluateStrategies(fixture(0.1), bull);
    const rangeRows = evaluateStrategies(fixture(1.5), range);
    expect(positive.some((x) => x.strategyId === "EARLY_ACCELERATION" && x.verdict === "ELIGIBLE")).toBe(true);
    expect(positive.some((x) => x.strategyId === "MOMENTUM_CONTINUATION" && x.verdict === "ELIGIBLE")).toBe(true);
    expect(positive.some((x) => x.strategyId === "BREAKOUT_RETEST" && x.verdict === "ELIGIBLE")).toBe(true);
    expect(positive.some((x) => x.strategyId === "STEADY_TREND" && x.verdict === "ELIGIBLE")).toBe(true);
    expect(rangeRows.some((x) => x.strategyId === "RANGE_MEAN_REVERSION" && x.verdict === "ELIGIBLE")).toBe(true);
    expect(negative.every((x) => x.verdict !== "ELIGIBLE")).toBe(true);
    expect(routeStrategies(fixture(1.5), bull)).toEqual(routeStrategies(fixture(1.5), bull));
  });
});
