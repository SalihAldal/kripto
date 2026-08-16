import { describe, expect, it, beforeEach } from "vitest";
import {
  bridgeFeeAwareEntryPolicy,
  bridgeTdiDecision,
} from "@/src/server/forensics/forensic-bridge.service";
import { clearForensicSession, ensureForensicSession } from "@/src/server/forensics/forensic-context";
import { computeFeeEdgeMetrics } from "@/src/server/forensics/fee-edge-metrics.service";
import { evaluateFeeAwareEntryPolicy } from "@/src/server/forensics/fee-aware-entry-policy.service";
import { buildP2ForensicReports } from "@/src/server/forensics/p2-forensic-report.service";
import { buildSlotOpportunityReport } from "@/src/server/forensics/slot-opportunity-report.service";
import {
  buildStrategyComparisonInputRows,
  compareStrategyConfigurations,
  filterRowsWithoutLookAhead,
} from "@/src/server/forensics/strategy-comparison-harness.service";
import {
  buildTdiDecisionRecord,
  classifyTdiWaitReason,
} from "@/src/server/forensics/tdi-decision-forensics.service";
import { buildVolatilityBreakoutValidationReport } from "@/src/server/forensics/volatility-breakout-validation.service";
import { createPnlLedgerEntry } from "@/src/server/forensics/pnl-ledger.service";
import {
  beginSimulationIntegrityGuard,
  SimulationIntegrityViolation,
} from "@/src/server/forensics/simulation-integrity.guard";

describe("P2-1 TDI wait reason codes", () => {
  beforeEach(() => clearForensicSession());

  it("classifies NO_SLOT for portfolio/slot competition", () => {
    expect(
      classifyTdiWaitReason({
        masterDecision: "WAIT",
        consensusScore: 73,
        confidence: 68,
        openPositionCount: 3,
        maxSlots: 3,
        rank: 4,
      }),
    ).toBe("NO_SLOT");
  });

  it("classifies BELOW_THRESHOLD for hybrid/EV reject", () => {
    expect(
      classifyTdiWaitReason({
        hybridRejected: true,
        evBelowThreshold: true,
      }),
    ).toBe("BELOW_THRESHOLD");
  });

  it("classifies COOLDOWN, RISK, and NEUTRAL explicitly", () => {
    expect(classifyTdiWaitReason({ cooldownActive: true })).toBe("COOLDOWN");
    expect(classifyTdiWaitReason({ riskBlocked: true })).toBe("RISK");
    expect(
      classifyTdiWaitReason({
        masterDecision: "WAIT",
        consensusScore: 48,
        confidence: 42,
      }),
    ).toBe("NEUTRAL");
  });

  it("persists waitReasonCode on every TDI WAIT record", () => {
    ensureForensicSession({ sessionId: "tdi-test", mode: "paper" });
    const record = bridgeTdiDecision({
      candidateId: "tdi:AVNTTRY:1",
      symbol: "AVNTTRY",
      verdict: "WAIT",
      masterDecision: "WAIT",
      consensusScore: 73,
      confidence: 68,
      openPositionCount: 3,
      maxSlots: 3,
      rank: 5,
      reasonDetail: "High score candidate waiting for slot",
    });
    expect(record.waitReasonCode).toBe("NO_SLOT");
    expect(record.verdict).toBe("WAIT");
  });
});

describe("P2-2 slot opportunity report", () => {
  it("builds top-3 selected vs next-best using decision-time data", () => {
    const session = ensureForensicSession({ sessionId: "slot-test", mode: "paper" });
    session.candidates = [
      {
        candidateId: "c1",
        symbol: "AVNTTRY",
        candidateTimestamp: "2026-08-13T19:00:00.000Z",
        source: "scanner",
        ranking: 1,
        strategyScore: 78,
        marketContext: { marketRegimeStrategy: "RANGE_MEAN_REVERSION", marketRegime: "RANGE_SIDEWAYS" },
      },
      {
        candidateId: "c2",
        symbol: "ATMTRY",
        candidateTimestamp: "2026-08-13T19:00:05.000Z",
        source: "scanner",
        ranking: 2,
        strategyScore: 73,
        marketContext: { marketRegimeStrategy: "MOMENTUM_CONTINUATION", marketRegime: "WEAK_BULLISH_TREND" },
      },
      {
        candidateId: "c3",
        symbol: "REDTRY",
        candidateTimestamp: "2026-08-13T19:00:10.000Z",
        source: "scanner",
        ranking: 3,
        strategyScore: 71,
        marketContext: { marketRegimeStrategy: "BREAKOUT_CONTINUATION", marketRegime: "ROCKET_PUMP" },
      },
      {
        candidateId: "c4",
        symbol: "VICTRY",
        candidateTimestamp: "2026-08-13T19:00:15.000Z",
        source: "scanner",
        ranking: 4,
        strategyScore: 69,
        marketContext: { marketRegimeStrategy: "RANGE_MEAN_REVERSION", marketRegime: "RANGE_SIDEWAYS" },
      },
    ];
    session.tdiDecisions = [
      buildTdiDecisionRecord({
        candidateId: "c1",
        symbol: "AVNTTRY",
        verdict: "APPROVED",
        rank: 1,
        reasonDetail: "approved",
      }),
      buildTdiDecisionRecord({
        candidateId: "c2",
        symbol: "ATMTRY",
        verdict: "WAIT",
        rank: 2,
        openPositionCount: 3,
        maxSlots: 3,
        consensusScore: 73,
        confidence: 70,
        reasonDetail: "slot wait",
      }),
    ];
    session.orders = [{ symbol: "AVNTTRY", side: "BUY", entryPrice: 5, quantity: 100, fees: 0.1, exchange: "x", executionMode: "paper", timestamp: "t", reconciled: true }];
    const report = buildSlotOpportunityReport({ session, maxPositions: 3 });
    expect(report.maxPositions).toBe(3);
    expect(report.rows.length).toBeGreaterThan(0);
    expect(report.rows[0]?.selected.symbol).toBe("AVNTTRY");
    expect(report.rows[0]?.nextBest?.symbol).toBeDefined();
    expect(report.deterministicHash).toHaveLength(16);
  });
});

describe("P2-3 strategy comparison harness", () => {
  it("compares baseline vs candidate config deterministically without look-ahead", () => {
    const rows = buildStrategyComparisonInputRows({
      pnlEntries: [
        createPnlLedgerEntry({
          tradeId: "t1",
          symbol: "AVNTTRY",
          side: "LONG",
          entryPrice: 5,
          exitPrice: 4.9,
          quantity: 100,
          entryFee: 0.08,
          exitFee: 0.08,
        }),
        createPnlLedgerEntry({
          tradeId: "t2",
          symbol: "ATMTRY",
          side: "LONG",
          entryPrice: 10,
          exitPrice: 10.3,
          quantity: 50,
          entryFee: 0.05,
          exitFee: 0.05,
        }),
      ],
      strategyByTradeId: { t1: "RANGE_MEAN_REVERSION", t2: "MOMENTUM_CONTINUATION" },
      regimeByTradeId: { t1: "CHAOS", t2: "TREND" },
      entryTimingBySymbol: {
        AVNTTRY: {
          candidateId: "c1",
          symbol: "AVNTTRY",
          entryTimestamp: "2026-08-13T19:00:00.000Z",
          entryDelayMs: 180000,
          priceAtEntry: 5,
          classification: "POSSIBLY_LATE",
          reasonDetail: "late",
        },
      },
    });
    const filtered = filterRowsWithoutLookAhead(rows);
    const report = compareStrategyConfigurations({
      rows: filtered,
      baseline: { label: "current", policyFlags: {} },
      candidate: {
        label: "candidate",
        policyFlags: { regimeGating: true, feeFloor: true, entryTimingProtection: true },
      },
    });
    expect(report.promotionReady).toBe(false);
    expect(report.baseline.metrics.sampleSize).toBe(2);
    expect(report.candidate.metrics.sampleSize).toBeLessThanOrEqual(2);
    expect(report.deterministicHash).toHaveLength(16);
  });
});

describe("P2-4 fee-aware entry policy", () => {
  it("observes fee drag by default and only blocks when explicitly enabled", () => {
    const weakEdge = computeFeeEdgeMetrics({
      entryPrice: 5,
      quantity: 100,
      takeProfitPercent: 0.2,
      stopLossPercent: 0.8,
      takerFeeRate: 0.0015,
    });
    const observe = evaluateFeeAwareEntryPolicy({ metrics: weakEdge, blockingEnabled: false });
    expect(observe.verdict).toBe("OBSERVE");
    const block = evaluateFeeAwareEntryPolicy({ metrics: weakEdge, blockingEnabled: true });
    expect(block.verdict).toBe("BLOCK");
  });

  it("records fee policy evaluation in forensic session", () => {
    ensureForensicSession({ sessionId: "fee-policy", mode: "paper" });
    const metrics = computeFeeEdgeMetrics({
      entryPrice: 10,
      quantity: 50,
      takeProfitPercent: 2,
      stopLossPercent: 1,
    });
    bridgeFeeAwareEntryPolicy({
      candidateId: "exec:ATMTRY:1",
      symbol: "ATMTRY",
      metrics,
      blockingEnabled: false,
    });
    const p2 = buildP2ForensicReports(ensureForensicSession({ sessionId: "fee-policy", mode: "paper" }));
    expect(p2.feePolicySamples.length).toBeGreaterThan(0);
  });
});

describe("P2-5 volatility breakout follow-up", () => {
  it("does not declare breakout superior on small samples", () => {
    const report = buildVolatilityBreakoutValidationReport({
      strategies: [
        {
          strategy: "MOMENTUM_CONTINUATION",
          sampleSize: 3,
          tradeCount: 3,
          winRate: 0.6667,
          grossPnL: 0.5,
          fees: 0.2,
          netPnL: 0.3,
          expectancy: 0.1,
          profitFactor: 2,
          maxDrawdown: 0.1,
          averageHoldingTimeMs: 120000,
          regimeBreakdown: {},
        },
      ],
      minimumSampleRequired: 20,
    });
    expect(report.sufficientData).toBe(false);
    expect(report.recommendation).toBe("INSUFFICIENT_DATA");
    expect(report.reasonDetail).toContain("n=3");
  });
});

describe("P2 integrity", () => {
  it("rejects look-ahead in simulation guard", () => {
    const guard = beginSimulationIntegrityGuard({
      sessionId: "p2-integrity",
      decisionTimestamp: 1000,
      stage: "decision",
    });
    expect(() => guard.assertDataTimestamp("future.close", 5000)).toThrow(SimulationIntegrityViolation);
  });

  it("buildTdiDecisionRecord is deterministic for same inputs", () => {
    const input = {
      candidateId: "tdi:1",
      symbol: "AVNTTRY",
      verdict: "WAIT" as const,
      masterDecision: "WAIT",
      consensusScore: 73,
      confidence: 70,
      openPositionCount: 3,
      maxSlots: 3,
      rank: 4,
      reasonDetail: "slot competition",
      timestamp: "2026-08-13T20:00:00.000Z",
    };
    expect(buildTdiDecisionRecord(input)).toEqual(buildTdiDecisionRecord(input));
  });
});
