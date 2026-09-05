import { describe, expect, it } from "vitest";
import { buildCanonicalCandidateObservation, buildOutcomeHorizonRows, mapCanonicalSourceType } from "@/src/server/shadow-outcome/canonical-dataset";
import type { TrackedCandidate } from "@/src/server/shadow-outcome/types";

const T0 = 1_700_000_000_000;

function tracked(): TrackedCandidate {
  return {
    snapshot: Object.freeze({
      candidateId: "cand-1",
      symbol: "btctry",
      firstDetectedAt: T0,
      firstDetectionPrice: 100,
      primaryLane: "EARLY",
      secondaryEvidence: [],
      opportunityScore: 81,
      opportunityBreakdown: {},
      microScore: 70,
      microBreakdown: {},
      liquidityScore: 65,
      executionQuality: 72,
      finalScore: 83,
      initialRank: 1,
      btcReturn1m: null,
      btcReturn5m: null,
      marketBreadthPctPositive1m: null,
      aiStatus: null,
      aiModifier: 0,
      tdiDecision: null,
      reasonCodes: [],
      warnings: [],
      rvol1m: null,
      priceAccelerationShort: null,
      takerBuyRatio5s: null,
      source: "replay",
      microTiming: null,
    }),
    journey: [
      { at: T0, stage: "DISCOVERED", lane: "EARLY", score: 81, state: "DISCOVERED" },
      { at: T0 + 20_000, stage: "HOT", lane: "EARLY", score: 84, state: "HOT" },
      { at: T0 + 60_000, stage: "MICRO_CONFIRMED", lane: "EARLY", score: 85, state: "MICRO_CONFIRMED" },
      { at: T0 + 90_000, stage: "EXECUTION_READY", lane: "EARLY", score: 86, state: "EXECUTION_READY" },
      { at: T0 + 120_000, stage: "CANONICAL_ENTER", lane: "EARLY", score: 87, state: "CANONICAL_ENTER" },
      { at: T0 + 180_000, stage: "PAPER_OPENED", lane: "EARLY", score: 87, state: "PAPER_OPENED" },
    ],
    moveKey: "BTCTRY:1",
    latestStage: "PAPER_OPENED",
    latestScore: 87,
    latestRank: 1,
    latestAiStatus: null,
    latestTdiDecision: null,
    hotAt: T0 + 20_000,
    microConfirmedAt: T0 + 60_000,
    executionReadyAt: T0 + 90_000,
    deepSubscriptionAt: null,
    lastPrice: 103,
    lastPriceAt: T0 + 240_000,
    high: 104,
    low: 99,
    highAt: T0 + 240_000,
    outcomes: [
      {
        horizonMin: 1,
        mfePct: 1.2,
        maePct: -0.3,
        returnPct: 0.7,
        timeToMfeMs: 20_000,
        complete: true,
        quality: "OK",
        status: "COMPLETE",
      },
      {
        horizonMin: 3,
        mfePct: null,
        maePct: null,
        returnPct: null,
        timeToMfeMs: null,
        complete: false,
        quality: "OUTCOME_DATA_INCOMPLETE",
        status: "PENDING",
      },
    ],
    reachTimes: {},
    pricePoints: [
      { t: T0, price: 100 },
      { t: T0 + 20_000, price: 100.5 },
      { t: T0 + 60_000, price: 101.2 },
      { t: T0 + 90_000, price: 101.5 },
      { t: T0 + 120_000, price: 102.1 },
      { t: T0 + 180_000, price: 102.6 },
      { t: T0 + 240_000, price: 103.0 },
    ],
    invalidReason: null,
  };
}

describe("P3 canonical dataset contract", () => {
  it("maps source type canonically", () => {
    expect(mapCanonicalSourceType("live")).toBe("LIVE_MARKET");
    expect(mapCanonicalSourceType("replay")).toBe("RECORDED_REPLAY");
    expect(mapCanonicalSourceType("synthetic")).toBe("SYNTHETIC_FIXTURE");
  });

  it("keeps immutable first-detection fields on upsert", () => {
    const first = buildCanonicalCandidateObservation({
      datasetId: "d1",
      campaignId: "c1",
      tracked: tracked(),
      observedAtMs: T0 + 250_000,
      persistedAtMs: T0 + 251_000,
      inputSnapshotId: "snap-1",
      policyVersion: "v1",
    });
    const changed = tracked();
    changed.snapshot = Object.freeze({ ...changed.snapshot, firstDetectionPrice: 777, opportunityScore: 999 });
    const second = buildCanonicalCandidateObservation({
      datasetId: "d1",
      campaignId: "c1",
      tracked: changed,
      observedAtMs: T0 + 350_000,
      persistedAtMs: T0 + 351_000,
      inputSnapshotId: "snap-2",
      policyVersion: "v2",
      previous: first,
    });
    expect(second.firstDetectedAt).toBe(first.firstDetectedAt);
    expect(second.firstDetectedPrice).toBe(first.firstDetectedPrice);
    expect(second.firstScore).toBe(first.firstScore);
    expect(second.marketEventAt).toBe(first.marketEventAt);
    expect(second.sourceType).toBe(first.sourceType);
    expect(second.inputSnapshotId).toBe(first.inputSnapshotId);
  });

  it("builds horizon rows with final/quality contract", () => {
    const rows = buildOutcomeHorizonRows({
      datasetId: "d1",
      tracked: tracked(),
      baselineStage: "FIRST_DETECTED",
    });
    expect(rows.length).toBe(2);
    expect(rows[0]?.final).toBe(true);
    expect(rows[0]?.quality).toBe("OK");
    expect(rows[1]?.final).toBe(false);
    expect(rows[1]?.quality).toBe("INCOMPLETE");
  });
});
