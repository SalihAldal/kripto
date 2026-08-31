import { describe, expect, it } from "vitest";
import type { TdiDecisionRecord } from "@/src/server/forensics/forensic.types";
import {
  classifyMomentumBlock,
  classifyRuntimeRegression,
  classifyTechnicalBlock,
  isLowMomentumInput,
  replayGateSequence,
  technicalThreshold,
} from "@/src/server/forensics/tdi-policy-forensic.service";

function row(overrides?: Partial<TdiDecisionRecord>): TdiDecisionRecord {
  return {
    candidateId: "hybrid:TEST:1",
    symbol: "TESTTRY",
    verdict: "WAIT",
    reasonDetail: "test",
    timestamp: "2026-08-18T00:00:00.000Z",
    firstBlockingCondition: "MOMENTUM",
    blockingConditions: ["MOMENTUM"],
    technicalScore: 60,
    momentumScore: 58,
    sentimentScore: 52,
    shortMomentum: 0.24,
    shortFlow: 0.08,
    executionScore: 54,
    confidence: 46,
    bullishCount: 2,
    paperRelaxed: true,
    thresholds: {
      technicalMinScore: 55,
      sentimentMinScore: 50,
      compositeMinScore: 55,
      confidenceMinScore: 25,
    },
    regimeDelta: { technical: 0, sentiment: 0, composite: 0 },
    ...overrides,
  };
}

describe("tdi policy forensic formulas", () => {
  it("uses technical threshold with regime-adjusted value", () => {
    expect(technicalThreshold(row())).toBe(55);
  });

  it("detects low momentum input correctly", () => {
    expect(isLowMomentumInput(row({ shortMomentum: 0.01, shortFlow: 0.01 }))).toBe(true);
    expect(isLowMomentumInput(row({ shortMomentum: 0.2, shortFlow: 0.08 }))).toBe(false);
  });

  it("classifies technical policy-correct blockers", () => {
    const result = classifyTechnicalBlock(
      row({
        firstBlockingCondition: "TECHNICAL",
        blockingConditions: ["TECHNICAL"],
        technicalScore: 45,
      }),
    );
    expect(result).toBe("TECHNICAL_POLICY_CORRECT");
  });

  it("detects technical duplicate gating", () => {
    const result = classifyTechnicalBlock(
      row({
        firstBlockingCondition: "TECHNICAL",
        blockingConditions: ["TECHNICAL"],
        technicalScore: 66,
      }),
    );
    expect(result).toBe("TECHNICAL_DUPLICATE_GATE");
  });

  it("classifies momentum policy-correct blockers", () => {
    const result = classifyMomentumBlock(
      row({
        firstBlockingCondition: "MOMENTUM",
        blockingConditions: ["MOMENTUM"],
        sentimentScore: 44,
      }),
    );
    expect(result).toBe("MOMENTUM_POLICY_CORRECT");
  });

  it("detects momentum duplicate gate when score passes but low telemetry blocks", () => {
    const result = classifyMomentumBlock(
      row({
        firstBlockingCondition: "MOMENTUM",
        blockingConditions: ["MOMENTUM"],
        sentimentScore: 57,
        shortMomentum: 0.01,
        shortFlow: 0.01,
      }),
    );
    expect(result).toBe("MOMENTUM_DUPLICATE_GATE");
  });

  it("detects momentum unit bug outside normalized range", () => {
    const result = classifyMomentumBlock(
      row({
        firstBlockingCondition: "MOMENTUM",
        shortFlow: 1.8,
      }),
    );
    expect(result).toBe("MOMENTUM_UNIT_BUG");
  });

  it("replays gate ordering deterministically", () => {
    const replay = replayGateSequence(
      row({
        technicalScore: 48,
        sentimentScore: 60,
        shortMomentum: 0.2,
        shortFlow: 0.1,
      }),
    );
    expect(replay.firstFailedGate).toBe("technical");
  });

  it("supports buy feasibility counterfactual shape", () => {
    const replay = replayGateSequence(
      row({
        verdict: "APPROVED",
        firstBlockingCondition: undefined,
        blockingConditions: [],
      }),
    );
    expect(replay.finalBuy).toBe(true);
  });

  it("paper routing keeps relaxed confidence threshold", () => {
    const replay = replayGateSequence(
      row({
        paperRelaxed: true,
        confidence: 30,
      }),
    );
    expect(replay.confidencePass).toBe(true);
  });

  it("classifies timeout spike as transient when baseline intact", () => {
    const cls = classifyRuntimeRegression({
      previousTimeoutCount: 0,
      latestTimeoutCount: 1,
      previousP99: 14742,
      latestP99: 15010,
    });
    expect(cls).toBe("TRANSIENT");
  });
});

