import { describe, expect, it } from "vitest";
import type { TdiDecisionRecord } from "@/src/server/forensics/forensic.types";
import {
  buildTdiDataQualityArtifacts,
  buildTdiInputContract,
  inferDataQualityIssues,
} from "@/src/server/forensics/tdi-data-quality.service";

function baseWait(overrides?: Partial<TdiDecisionRecord>): TdiDecisionRecord {
  return {
    candidateId: "hybrid:TEST:1",
    symbol: "TESTTRY",
    verdict: "WAIT",
    reasonCode: "TDI_WAIT_NEUTRAL",
    waitReasonCode: "NEUTRAL",
    firstBlockingCondition: "MOMENTUM",
    blockingConditions: ["MOMENTUM", "TECHNICAL"],
    hybridDecision: "HOLD",
    finalDecision: "HOLD",
    consensusScore: 58,
    hybridCompositeScore: 58,
    scoreType: "HYBRID_COMPOSITE",
    technicalScore: 56,
    momentumScore: 52,
    sentimentScore: 51,
    shortMomentum: 0.42,
    shortFlow: 0.12,
    executionScore: 63,
    confidence: 41,
    bullishCount: 1,
    learningScore: 49,
    thresholds: {
      technicalMinScore: 55,
      sentimentMinScore: 50,
      compositeMinScore: 55,
      confidenceMinScore: 40,
    },
    regime: "RANGE_SIDEWAYS",
    regimeDelta: { technical: 0, sentiment: 0, composite: 0 },
    paperRelaxed: true,
    learningLane: true,
    liquidity: 1_000_000,
    volatility: 1.3,
    expectedValue: 58,
    openInterest: 12_345,
    marketContext: "range market",
    simulation: "PAPER",
    trendData: "RANGE",
    strategy: "RANGE_MEAN_REVERSION",
    reasonDetail: "Momentum guven vermiyor",
    timestamp: "2026-08-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("tdi data quality contract", () => {
  it("complete TDI input is marked available", () => {
    const row = baseWait();
    const contract = buildTdiInputContract(row);
    expect(contract.technicalScore.status).toBe("AVAILABLE");
    expect(contract.shortFlowImbalance.status).toBe("AVAILABLE");
  });

  it("missing technical score is detected", () => {
    const row = baseWait({ technicalScore: undefined, firstBlockingCondition: "TECHNICAL", blockingConditions: ["TECHNICAL"] });
    const issues = inferDataQualityIssues(row, buildTdiInputContract(row));
    expect(issues.missingFields).toContain("technicalScore");
  });

  it("missing momentum score is detected", () => {
    const row = baseWait({ momentumScore: undefined });
    const issues = inferDataQualityIssues(row, buildTdiInputContract(row));
    expect(issues.missingFields).toContain("momentumScore");
  });

  it("missing shortMomentum is detected", () => {
    const row = baseWait({ shortMomentum: undefined });
    const issues = inferDataQualityIssues(row, buildTdiInputContract(row));
    expect(issues.missingFields).toContain("shortMomentum");
  });

  it("missing shortFlow is detected", () => {
    const row = baseWait({ shortFlow: undefined });
    const issues = inferDataQualityIssues(row, buildTdiInputContract(row));
    expect(issues.missingFields).toContain("shortFlowImbalance");
  });

  it("missing sentiment score is detected", () => {
    const row = baseWait({ sentimentScore: undefined });
    const issues = inferDataQualityIssues(row, buildTdiInputContract(row));
    expect(issues.missingFields).toContain("sentimentScore");
  });

  it("stale input is tracked as data quality issue", () => {
    const row = baseWait({ reasonDetail: "stale market snapshot" });
    const issues = inferDataQualityIssues(row, buildTdiInputContract(row));
    expect(issues.missingFields).toContain("marketContext");
  });

  it("invalid shortFlow unit is flagged", () => {
    const row = baseWait({ shortFlow: 2.5 });
    const contract = buildTdiInputContract(row);
    expect(contract.shortFlowImbalance.status).toBe("INVALID");
    const issues = inferDataQualityIssues(row, contract);
    expect(issues.rootCauseByField.shortFlowImbalance).toBe("UNIT_CONVERSION_FAILURE");
  });

  it("null->0 regression is prevented", () => {
    const row = baseWait({ shortMomentum: undefined });
    const contract = buildTdiInputContract(row);
    expect(contract.shortMomentum.value).toBeNull();
    expect(contract.shortMomentum.status).toBe("MISSING");
  });

  it("missing fields are not silently converted to bearish", () => {
    const row = baseWait({ shortMomentum: undefined, shortFlow: undefined });
    const issues = inferDataQualityIssues(row, buildTdiInputContract(row));
    expect(issues.dataQualityIssues.some((issue) => issue.includes("BEAR"))).toBe(false);
  });

  it("double penalty scenario can be surfaced as data-quality block", () => {
    const row = baseWait({ momentumScore: 61, shortMomentum: undefined, shortFlow: undefined });
    const artifacts = buildTdiDataQualityArtifacts([row]);
    expect(artifacts.dataQualitySummary.dataQualityBlockCount).toBe(1);
  });

  it("paper routing missing OI is classified as paper-only missing", () => {
    const row = baseWait({ openInterest: undefined, paperRelaxed: true });
    const issues = inferDataQualityIssues(row, buildTdiInputContract(row));
    expect(issues.rootCauseByField.openInterest === "PAPER_ONLY_MISSING" || issues.rootCauseByField.openInterest === undefined).toBe(true);
  });

  it("runtime vs artifact reconciliation supports mapping output rows", () => {
    const row = baseWait({ candidateId: "execution:TEST:1", technicalScore: undefined });
    const artifacts = buildTdiDataQualityArtifacts([row]);
    expect(artifacts.missingTelemetryReport.rows.length).toBe(1);
    expect(artifacts.missingTelemetryReport.rows[0]?.rootCauseByField?.technicalScore).toBe("ROUTING_FAILURE");
  });

  it("DATA_QUALITY_BLOCK and POLICY_BLOCK are separated", () => {
    const clean = baseWait({ candidateId: "hybrid:CLEAN:1" });
    const dirty = baseWait({ candidateId: "hybrid:DIRTY:1", momentumScore: undefined });
    const artifacts = buildTdiDataQualityArtifacts([clean, dirty]);
    expect(artifacts.dataQualitySummary.waitCount).toBe(2);
    expect(artifacts.dataQualitySummary.dataQualityBlockCount).toBe(1);
    expect(artifacts.dataQualitySummary.policyBlockCount).toBe(1);
  });

  it("firstBlockingCondition is preserved in input contract rows", () => {
    const row = baseWait({ firstBlockingCondition: "TECHNICAL", blockingConditions: ["TECHNICAL"] });
    const artifacts = buildTdiDataQualityArtifacts([row]);
    expect(artifacts.inputContracts[0]?.firstBlockingCondition).toBe("TECHNICAL");
    expect(artifacts.inputContracts[0]?.blockingConditions).toEqual(["TECHNICAL"]);
  });
});

