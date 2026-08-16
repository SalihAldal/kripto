import { describe, expect, it, beforeEach } from "vitest";
import {
  bridgeTdiDecision,
} from "@/src/server/forensics/forensic-bridge.service";
import { clearForensicSession, ensureForensicSession } from "@/src/server/forensics/forensic-context";
import { buildExperimentRegistry } from "@/src/server/forensics/experiment-registry.service";
import { buildAiStrategyInteractionReport } from "@/src/server/forensics/ai-strategy-interaction.service";
import { buildOpportunityValueReport } from "@/src/server/forensics/opportunity-value.service";
import {
  buildFeeAwareEntryExperiment,
  buildEntryTimingExperiment,
  classifyFeeEdgeExperiment,
} from "@/src/server/forensics/p2-experiment-services";
import { buildP2ForensicReports } from "@/src/server/forensics/p2-forensic-report.service";
import { buildSlotAllocationAnalysis } from "@/src/server/forensics/slot-allocation-analysis.service";
import { buildSlotAllocationExperiment } from "@/src/server/forensics/slot-allocation-experiment.service";
import { buildTdiSensitivityReport } from "@/src/server/forensics/tdi-sensitivity.service";
import { buildStrategyRegimeMatrix } from "@/src/server/forensics/promotion-gate.service";
import { buildStrategyComparisonInputRows } from "@/src/server/forensics/strategy-comparison-harness.service";
import { createPnlLedgerEntry } from "@/src/server/forensics/pnl-ledger.service";
import {
  beginSimulationIntegrityGuard,
  SimulationIntegrityViolation,
} from "@/src/server/forensics/simulation-integrity.guard";
import { buildTdiDecisionRecord } from "@/src/server/forensics/tdi-decision-forensics.service";

function seedSession() {
  const session = ensureForensicSession({ sessionId: "p2-opt", mode: "paper" });
  session.candidates = [
    { candidateId: "c1", symbol: "AVNTTRY", candidateTimestamp: "t", source: "scanner", ranking: 1, strategyScore: 78, marketContext: { marketRegimeStrategy: "RANGE_MEAN_REVERSION", marketRegime: "RANGE_SIDEWAYS" } },
    { candidateId: "c2", symbol: "ATMTRY", candidateTimestamp: "t", source: "scanner", ranking: 2, strategyScore: 73, marketContext: { marketRegimeStrategy: "MOMENTUM_CONTINUATION", marketRegime: "WEAK_BULLISH_TREND" } },
    { candidateId: "c3", symbol: "REDTRY", candidateTimestamp: "t", source: "scanner", ranking: 3, strategyScore: 71, marketContext: {} },
    { candidateId: "c4", symbol: "VICTRY", candidateTimestamp: "t", source: "scanner", ranking: 4, strategyScore: 69, marketContext: {} },
  ] as never;
  session.tdiDecisions = [
    buildTdiDecisionRecord({ candidateId: "c1", symbol: "AVNTTRY", verdict: "APPROVED", rank: 1, consensusScore: 78, strategy: "RANGE_MEAN_REVERSION", forensicRegime: "RANGE" }),
    buildTdiDecisionRecord({ candidateId: "c4", symbol: "VICTRY", verdict: "WAIT", rank: 4, consensusScore: 73, confidence: 70, openPositionCount: 3, maxSlots: 3, strategy: "RANGE_MEAN_REVERSION", forensicRegime: "RANGE" }),
  ];
  session.pnlEntries = [
    createPnlLedgerEntry({ tradeId: "t1", symbol: "AVNTTRY", side: "LONG", entryPrice: 5, exitPrice: 4.9, quantity: 100, entryFee: 0.08, exitFee: 0.08 }),
    createPnlLedgerEntry({ tradeId: "t2", symbol: "ATMTRY", side: "LONG", entryPrice: 10, exitPrice: 10.3, quantity: 50, entryFee: 0.05, exitFee: 0.05 }),
  ];
  session.meanReversionEntries = [{ candidateId: "c1", tradeId: "t1", symbol: "AVNTTRY", side: "LONG", strategyId: "RANGE_MEAN_REVERSION", strategySelectionReason: "r", forensicRegime: "RANGE", marketRegime: "RANGE", volatilityPercent: 1, trendStrength: 0.2, liquidityScore: 50, momentumPercent: 0.1, shortMomentumPercent: 0.05, entryPrice: 5, entryTimestamp: "t" }];
  session.notDiscoveredRecords = [{ symbol: "VICTRY", stage: "NOT_DISCOVERED", filter: "x", reasonCode: "NOT_IN_CYCLE", reasonDetail: "x", analysisScope: "POST_ENTRY_ANALYSIS", subsequentMovePercent: 8.5, timestamp: "t", qualificationTrail: [] }];
  session.evAudits = [{ candidateId: "ev:1", symbol: "VICTRY", formulaVersion: "hybrid-v1", expectedValue: 15, verdict: "APPROVE", reasonCode: "EV_PASS", timestamp: "t" }];
  return session;
}

describe("P2-1 slot allocation analysis", () => {
  beforeEach(() => clearForensicSession());

  it("classifies NO_SLOT candidates with evidence", () => {
    const session = seedSession();
    const analysis = buildSlotAllocationAnalysis({
      session,
      postEntryMovesBySymbol: { VICTRY: 8.5 },
    });
    expect(analysis.noSlotCandidates.length).toBe(1);
    expect(analysis.noSlotCandidates[0]?.classification).toBe("POSSIBLE_MISSED_SLOT");
    expect(analysis.noSlotCandidates[0]?.evidence.length).toBeGreaterThan(0);
    expect(analysis.deterministicHash).toHaveLength(16);
  });
});

describe("P2-1A slot allocation experiment", () => {
  it("simulates 3 vs 4 offline without changing production maxPositions", () => {
    const session = seedSession();
    const experiment = buildSlotAllocationExperiment({ session });
    expect(experiment.baselineMaxPositions).toBe(3);
    expect(experiment.experimentMaxPositions).toBe(4);
    expect(experiment.note).toContain("Offline");
    expect(experiment.promotionStatus).not.toBe("PROMOTABLE");
  });
});

describe("P2-2 TDI sensitivity", () => {
  it("runs offline threshold sensitivity without changing production threshold", () => {
    const session = seedSession();
    const report = buildTdiSensitivityReport({ session });
    expect(report.sensitivityPoints.length).toBe(3);
    expect(report.recommendation).toBe("INSUFFICIENT_DATA");
    expect(report.deterministicHash).toHaveLength(16);
  });
});

describe("P2-5 strategy x regime matrix", () => {
  it("labels sparse cells as NOT_ENOUGH_DATA", () => {
    const matrix = buildStrategyRegimeMatrix({
      pnlEntries: [createPnlLedgerEntry({ tradeId: "t1", symbol: "A", side: "LONG", entryPrice: 10, exitPrice: 10.1, quantity: 1, entryFee: 0.01, exitFee: 0.01 })],
      strategyByTradeId: { t1: "RANGE_MEAN_REVERSION" },
      regimeByTradeId: { t1: "RANGE" },
    });
    expect(matrix.cells[0]?.sampleLabel).toBe("NOT_ENOUGH_DATA");
  });
});

describe("P2-6 fee-aware entry experiment", () => {
  it("classifies FEE_SAFE / FEE_BORDERLINE / FEE_EROSION", () => {
    expect(classifyFeeEdgeExperiment(2, 1)).toBe("FEE_SAFE");
    expect(classifyFeeEdgeExperiment(1.2, 0.5)).toBe("FEE_BORDERLINE");
    expect(classifyFeeEdgeExperiment(0.5, -0.1)).toBe("FEE_EROSION");
  });
});

describe("P2-8 AI x strategy interaction", () => {
  it("builds forensic AI interaction rows without modifying prompts", () => {
    const session = seedSession();
    session.consensus = [{ consensusId: "1", symbol: "AVNTTRY", providerVotes: {}, weights: {}, confidence: 80, finalDecision: "BUY", reason: "x", timestamp: "t" }];
    const report = buildAiStrategyInteractionReport({
      session,
      strategyByTradeId: { t1: "RANGE_MEAN_REVERSION" },
      regimeByTradeId: { t1: "RANGE" },
    });
    expect(report.rows.length).toBeGreaterThan(0);
    expect(report.summary.evidenceQuality).not.toBe("COMPLETE");
  });
});

describe("P2-9 opportunity value", () => {
  it("uses post-entry movement only in POST_ENTRY_ANALYSIS scope", () => {
    const session = seedSession();
    const report = buildOpportunityValueReport({ session, postEntryMovesBySymbol: { VICTRY: 8.5 } });
    expect(report.rows.every((row) => row.analysisScope === "POST_ENTRY_ANALYSIS")).toBe(true);
    expect(report.rankedByStage.SCANNER?.count).toBeGreaterThan(0);
  });
});

describe("P2-11 experiment registry", () => {
  it("builds reproducible profitability-experiments registry", () => {
    const session = seedSession();
    const p2 = buildP2ForensicReports(session);
    expect(p2.experimentRegistry.experiments.length).toBeGreaterThan(0);
    expect(p2.experimentRegistry.safetyPreserved.aiGate).toBe(true);
    expect(p2.experimentRegistry.deterministicHash).toHaveLength(16);
  });
});

describe("P2 full bundle", () => {
  beforeEach(() => clearForensicSession());

  it("builds complete P2 bundle with promotion decisions", () => {
    const p2 = buildP2ForensicReports(seedSession());
    expect(p2.slotAllocationAnalysis).toBeDefined();
    expect(p2.tdiSensitivity).toBeDefined();
    expect(p2.feeAwareEntryExperiment.blockingEnabledInProduction).toBe(false);
    expect(p2.promotionGate.promoted).toBe(false);
    expect(p2.promotionDecisions.every((d) => d.status !== "PROMOTABLE" || p2.promotionGate.status === "PROMOTABLE")).toBe(true);
  });
});

describe("P2 integrity", () => {
  it("rejects look-ahead", () => {
    const guard = beginSimulationIntegrityGuard({ sessionId: "p2", decisionTimestamp: 1000, stage: "decision" });
    expect(() => guard.assertDataTimestamp("future", 5000)).toThrow(SimulationIntegrityViolation);
  });

  it("persists TDI wait reason via bridge", () => {
    clearForensicSession();
    ensureForensicSession({ sessionId: "tdi-bridge", mode: "paper" });
    const record = bridgeTdiDecision({
      candidateId: "tdi:1",
      symbol: "X",
      verdict: "WAIT",
      consensusScore: 73,
      openPositionCount: 3,
      maxSlots: 3,
      rank: 5,
    });
    expect(record.waitReasonCode).toBe("NO_SLOT");
  });
});
