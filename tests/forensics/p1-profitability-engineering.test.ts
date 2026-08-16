import { describe, expect, it, beforeEach } from "vitest";
import {
  bridgeEntryTimingForensics,
  bridgeFeeEdgeMetrics,
  bridgeMeanReversionEntry,
  bridgeScannerQualificationForensics,
} from "@/src/server/forensics/forensic-bridge.service";
import { clearForensicSession, ensureForensicSession } from "@/src/server/forensics/forensic-context";
import { buildEvComponentAttributionReport } from "@/src/server/forensics/ev-component-attribution.service";
import { buildMrRegimeGatingExperiment } from "@/src/server/forensics/mr-regime-gating-experiment.service";
import { buildOpportunityFunnelReport } from "@/src/server/forensics/opportunity-funnel.service";
import { buildFeeAwareEdgeResearchReport } from "@/src/server/forensics/fee-aware-edge-research.service";
import { evaluatePromotionGate, buildStrategyRegimeMatrix } from "@/src/server/forensics/promotion-gate.service";
import { buildP1ForensicReports } from "@/src/server/forensics/p1-forensic-report.service";
import { computeFeeEdgeMetrics } from "@/src/server/forensics/fee-edge-metrics.service";
import { createPnlLedgerEntry } from "@/src/server/forensics/pnl-ledger.service";
import {
  classifyLossPattern,
  classifyWinningPattern,
} from "@/src/server/forensics/trade-pattern-analysis.service";
import {
  compareStrategyConfigurations,
  buildStrategyComparisonInputRows,
} from "@/src/server/forensics/strategy-comparison-harness.service";
import {
  beginSimulationIntegrityGuard,
  SimulationIntegrityViolation,
} from "@/src/server/forensics/simulation-integrity.guard";
import { env } from "@/lib/config";

describe("P1-1A MR regime gating experiment", () => {
  it("compares CURRENT_MR vs MR_WITH_REGIME_FILTER deterministically", () => {
    const mrEntries = [
      {
        candidateId: "1",
        tradeId: "t1",
        symbol: "A",
        side: "LONG" as const,
        strategyId: "RANGE_MEAN_REVERSION",
        strategySelectionReason: "range",
        forensicRegime: "RANGE" as const,
        marketRegime: "RANGE_SIDEWAYS",
        volatilityPercent: 0.8,
        trendStrength: 0.2,
        liquidityScore: 50,
        momentumPercent: 0.1,
        shortMomentumPercent: 0.05,
        entryPrice: 10,
        entryTimestamp: "2026-08-13T19:00:00.000Z",
      },
      {
        candidateId: "2",
        tradeId: "t2",
        symbol: "B",
        side: "SHORT" as const,
        strategyId: "RANGE_MEAN_REVERSION",
        strategySelectionReason: "range",
        forensicRegime: "HIGH_VOLATILITY" as const,
        marketRegime: "HIGH_VOLATILITY_CHAOS",
        volatilityPercent: 2.2,
        trendStrength: 0.5,
        liquidityScore: 40,
        momentumPercent: 0.3,
        shortMomentumPercent: 0.2,
        entryPrice: 20,
        entryTimestamp: "2026-08-13T19:10:00.000Z",
      },
    ];
    const pnlEntries = [
      createPnlLedgerEntry({ tradeId: "t1", symbol: "A", side: "LONG", entryPrice: 10, exitPrice: 10.2, quantity: 10, entryFee: 0.01, exitFee: 0.01 }),
      createPnlLedgerEntry({ tradeId: "t2", symbol: "B", side: "SHORT", entryPrice: 20, exitPrice: 20.5, quantity: 5, entryFee: 0.01, exitFee: 0.01 }),
    ];
    const experiment = buildMrRegimeGatingExperiment({ mrEntries, pnlEntries });
    expect(experiment.baselineLabel).toBe("CURRENT_MR");
    expect(experiment.candidateLabel).toBe("MR_WITH_REGIME_FILTER");
    expect(experiment.baseline.sampleSize).toBe(2);
    expect(experiment.candidate.sampleSize).toBeLessThanOrEqual(experiment.baseline.sampleSize);
    expect(experiment.promotionStatus).not.toBe("PROMOTABLE");
    expect(experiment.deterministicHash).toHaveLength(16);
  });
});

describe("P1-3A EV component attribution", () => {
  it("builds EV component contribution report without changing formula", () => {
    const report = buildEvComponentAttributionReport({
      evAudits: [
        {
          candidateId: "ev:1",
          symbol: "AVNTTRY",
          formulaVersion: "hybrid-v1",
          expectedValue: 15.8,
          expectedProfit: 20,
          expectedLoss: 4,
          fees: 0.15,
          winProbability: 0.62,
          expectedRiskReward: 1.8,
          threshold: 55,
          verdict: "APPROVE",
          reasonCode: "EV_PASS",
          timestamp: "2026-08-13T19:00:00.000Z",
        },
      ],
    });
    expect(report.components.length).toBe(5);
    expect(report.dominantComponent).toBeTruthy();
    expect(report.components.every((row) => row.evidenceQuality !== undefined)).toBe(true);
    expect(report.deterministicHash).toHaveLength(16);
  });
});

describe("P1-6 loss pattern classification", () => {
  it("requires evidence for each loss classification", () => {
    const feeDrag = classifyLossPattern({
      tradeId: "t1",
      symbol: "X",
      strategy: "RANGE_MEAN_REVERSION",
      regime: "RANGE",
      netPnL: -0.2,
      grossPnL: -0.05,
      totalFee: 0.15,
    });
    expect(feeDrag.classification).toBe("FEE_DRAG");
    expect(feeDrag.evidence.length).toBeGreaterThan(0);

    const regime = classifyLossPattern({
      tradeId: "t2",
      symbol: "Y",
      strategy: "RANGE_MEAN_REVERSION",
      regime: "TREND",
      netPnL: -1,
      grossPnL: -0.8,
      totalFee: 0.2,
      forensicRegime: "TREND",
    });
    expect(regime.classification).toBe("REGIME_MISMATCH");
  });
});

describe("P1-7 winning pattern extraction", () => {
  it("classifies wins as FACT/REPEATED_PATTERN/HYPOTHESIS based on sample size", () => {
    const hypothesis = classifyWinningPattern({
      tradeId: "w1",
      symbol: "Z",
      strategy: "VOLATILITY_BREAKOUT",
      regime: "HIGH_VOLATILITY",
      netPnL: 1.5,
      sampleSize: 3,
      exitReason: "TAKE_PROFIT",
    });
    expect(hypothesis.classification).toBe("HYPOTHESIS");

    const fact = classifyWinningPattern({
      tradeId: "w2",
      symbol: "Z",
      strategy: "VOLATILITY_BREAKOUT",
      regime: "HIGH_VOLATILITY",
      netPnL: 2,
      sampleSize: 8,
      exitReason: "TAKE_PROFIT",
    });
    expect(fact.classification).toBe("FACT");
  });
});

describe("P1-8 opportunity funnel", () => {
  beforeEach(() => clearForensicSession());

  it("aggregates stage losses from forensic session", () => {
    const session = ensureForensicSession({ sessionId: "funnel-test", mode: "paper" });
    session.candidates = [{ symbol: "A", candidateTimestamp: new Date().toISOString() } as never];
    session.rejectionCountsByStage = { scanner: 2, decision: 3, ai: 1 };
    session.rejectionCountsByReason = { SCANNER_REJECT: 2, TDI_REJECTED: 3, AI_FAILED: 1 };
    session.tdiDecisions = [{ symbol: "A", verdict: "WAIT", waitReasonCode: "NO_SLOT" } as never];
    const funnel = buildOpportunityFunnelReport(session);
    expect(funnel.totalDiscovered).toBe(1);
    expect(funnel.stages.length).toBeGreaterThan(0);
    expect(funnel.lossByReason.FILTERED_OUT?.count).toBeGreaterThan(0);
    expect(funnel.deterministicHash).toHaveLength(16);
  });
});

describe("P1-10 fee-aware edge research", () => {
  it("classifies fee-erasing vs fee-safe edge without blocking", () => {
    const metrics = computeFeeEdgeMetrics({
      entryPrice: 5,
      quantity: 100,
      takeProfitPercent: 0.1,
      stopLossPercent: 0.5,
      takerFeeRate: 0.0015,
    });
    const report = buildFeeAwareEdgeResearchReport({
      decisions: [
        {
          candidateId: "exec:A:1",
          symbol: "ATRY",
          stage: "ev",
          verdict: "APPROVE",
          reasonCode: "FEE_EDGE_METRICS",
          reasonDetail: JSON.stringify(metrics),
        },
      ],
    });
    expect(report.sampleSize).toBe(1);
    expect(report.rows[0]?.classification).toBe("FEE_ERASING_EDGE");
    expect(report.deterministicHash).toHaveLength(16);
  });
});

describe("P1-11 A/B harness", () => {
  it("compares single experimental change without auto-promotion", () => {
    const rows = buildStrategyComparisonInputRows({
      pnlEntries: [
        createPnlLedgerEntry({ tradeId: "t1", symbol: "A", side: "LONG", entryPrice: 10, exitPrice: 10.5, quantity: 10, entryFee: 0.01, exitFee: 0.01 }),
        createPnlLedgerEntry({ tradeId: "t2", symbol: "B", side: "LONG", entryPrice: 20, exitPrice: 19, quantity: 5, entryFee: 0.01, exitFee: 0.01 }),
      ],
      strategyByTradeId: { t1: "RANGE_MEAN_REVERSION", t2: "RANGE_MEAN_REVERSION" },
      regimeByTradeId: { t1: "RANGE", t2: "HIGH_VOLATILITY" },
    });
    const comparison = compareStrategyConfigurations({
      rows,
      baseline: { label: "current", policyFlags: {} },
      candidate: { label: "mr-regime-filter", policyFlags: { regimeGating: true } },
    });
    expect(comparison.promotionReady).toBe(false);
    expect(comparison.candidate.metrics.sampleSize).toBeLessThanOrEqual(comparison.baseline.metrics.sampleSize);
  });
});

describe("P1-12 promotion gate", () => {
  it("marks insufficient sample as RESEARCH_ONLY or REJECTED, never auto-promotes", () => {
    const gate = evaluatePromotionGate({
      changeId: "test-change",
      description: "test",
      before: {
        sampleSize: 5,
        tradeCount: 5,
        winRate: 0.2,
        grossPnL: -1,
        fees: 0.5,
        netPnL: -1.5,
        expectancy: -0.3,
        profitFactor: 0.5,
        maxDrawdown: 1.5,
        feeDragRatio: 0.5,
      },
      after: {
        sampleSize: 3,
        tradeCount: 3,
        winRate: 0.33,
        grossPnL: -0.5,
        fees: 0.3,
        netPnL: -0.8,
        expectancy: -0.27,
        profitFactor: 0.6,
        maxDrawdown: 0.8,
        feeDragRatio: 0.6,
      },
      sampleSize: 5,
      minSampleSize: 20,
      acceptanceTest: "tests/forensics/p1-profitability-engineering.test.ts",
    });
    expect(gate.promoted).toBe(false);
    expect(gate.status).not.toBe("PROMOTABLE");
    expect(gate.criteria.some((row) => row.rule.includes("Minimum sample"))).toBe(true);
  });
});

describe("P1-5 strategy x regime matrix", () => {
  it("builds strategy x regime performance matrix", () => {
    const matrix = buildStrategyRegimeMatrix({
      pnlEntries: [
        createPnlLedgerEntry({ tradeId: "t1", symbol: "A", side: "LONG", entryPrice: 10, exitPrice: 10.2, quantity: 10, entryFee: 0.01, exitFee: 0.01 }),
      ],
      strategyByTradeId: { t1: "RANGE_MEAN_REVERSION" },
      regimeByTradeId: { t1: "RANGE" },
    });
    expect(matrix.cells.some((cell) => cell.strategy === "RANGE_MEAN_REVERSION" && cell.regime === "RANGE")).toBe(true);
    expect(matrix.deterministicHash).toHaveLength(16);
  });
});

describe("P1 bundle integration", () => {
  beforeEach(() => clearForensicSession());

  it("builds full P1 forensic bundle with all new artifacts", () => {
    const session = ensureForensicSession({ sessionId: "p1-bundle", mode: "paper" });
    bridgeMeanReversionEntry({
      candidateId: "mr:1",
      symbol: "AVNTTRY",
      side: "LONG",
      strategyId: "RANGE_MEAN_REVERSION",
      strategySelectionReason: "range",
      marketRegime: "RANGE_SIDEWAYS",
      volatilityPercent: 0.9,
      volume24h: env.SCANNER_MIN_VOLUME_24H * 2,
      spreadPercent: 0.04,
      momentumPercent: 0.1,
      shortMomentumPercent: 0.05,
      liquidityScore: 50,
      entryPrice: 5,
    });
    bridgeScannerQualificationForensics({
      context: {
        symbol: "VICTRY",
        volume24h: env.SCANNER_MIN_VOLUME_24H * 0.5,
        spreadPercent: 0.05,
        volatilityPercent: 1.2,
        momentumPercent: 0.4,
        tradable: false,
        rejectReasons: ["Low liquidity"],
        metadata: { marketRegime: "RANGE_SIDEWAYS" },
      } as never,
      score: { symbol: "VICTRY", score: 28, confidence: 30, status: "REJECTED", reasons: [], metrics: {} },
      inCycle: false,
      inUniverse: true,
      ranked: false,
      aiScope: false,
    });
    const metrics = computeFeeEdgeMetrics({ entryPrice: 5, quantity: 100, takeProfitPercent: 2, stopLossPercent: 1 });
    bridgeFeeEdgeMetrics({ candidateId: "exec:1", symbol: "AVNTTRY", metrics });
    bridgeEntryTimingForensics({
      candidateId: "exec:1",
      symbol: "AVNTTRY",
      side: "LONG",
      priceAtEntry: 5.05,
    });
    session.evAudits = [
      {
        candidateId: "ev:1",
        symbol: "AVNTTRY",
        formulaVersion: "hybrid-v1",
        expectedValue: 15.8,
        expectedProfit: 18,
        expectedLoss: 3,
        fees: 0.15,
        winProbability: 0.6,
        threshold: 55,
        verdict: "APPROVE",
        reasonCode: "EV_PASS",
        timestamp: new Date().toISOString(),
      },
    ];
    const bundle = buildP1ForensicReports(session);
    expect(bundle.evComponentAttribution?.sampleSize).toBe(1);
    expect(bundle.strategyRegimeMatrix?.cells).toBeDefined();
    expect(bundle.opportunityFunnel?.stages.length).toBeGreaterThan(0);
    expect(bundle.mrRegimeGatingExperiment?.baselineLabel).toBe("CURRENT_MR");
    expect(bundle.promotionGate?.promoted).toBe(false);
    expect(bundle.feeAwareEdgeResearch?.sampleSize).toBeGreaterThanOrEqual(0);
  });
});

describe("P1 integrity", () => {
  it("rejects look-ahead in simulation guard", () => {
    const guard = beginSimulationIntegrityGuard({
      sessionId: "p1-no-lookahead",
      decisionTimestamp: 1000,
      stage: "decision",
    });
    expect(() => guard.assertDataTimestamp("future", 2000)).toThrow(SimulationIntegrityViolation);
  });
});
