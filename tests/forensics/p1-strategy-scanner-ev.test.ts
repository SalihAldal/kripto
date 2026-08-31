import { describe, expect, it, beforeEach } from "vitest";
import {
  bridgeEntryTimingForensics,
  bridgeMeanReversionEntry,
  bridgePostEntryNotDiscovered,
  bridgeScannerQualificationForensics,
} from "@/src/server/forensics/forensic-bridge.service";
import { clearForensicSession, ensureForensicSession } from "@/src/server/forensics/forensic-context";
import { buildEvCalibrationReportDeterministic } from "@/src/server/forensics/ev-calibration.service";
import { buildEntryTimingRecord, classifyEntryTiming } from "@/src/server/forensics/entry-timing-forensics.service";
import {
  analyzeMeanReversionPerformance,
  buildStrategyPerformanceReport,
  isMeanReversionStrategy,
} from "@/src/server/forensics/mean-reversion-regime-audit.service";
import { buildP1ForensicReports } from "@/src/server/forensics/p1-forensic-report.service";
import { classifyForensicRegime } from "@/src/server/forensics/regime-classifier.service";
import { buildScannerQualificationRejections } from "@/src/server/forensics/scanner-qualification-forensics.service";
import { createPnlLedgerEntry } from "@/src/server/forensics/pnl-ledger.service";
import { buildScannerCyclePlan } from "@/src/server/scanner/scanner.service";
import {
  beginSimulationIntegrityGuard,
  SimulationIntegrityViolation,
} from "@/src/server/forensics/simulation-integrity.guard";
import type { MarketContext, ScannerScore } from "@/src/types/scanner";
import { env } from "@/lib/config";

function mockContext(overrides: Partial<MarketContext> = {}): MarketContext {
  return {
    symbol: "VICTRY",
    lastPrice: 10,
    change24h: 16.35,
    volume24h: env.SCANNER_MIN_VOLUME_24H * 0.5,
    spreadPercent: 0.05,
    volatilityPercent: 1.2,
    momentumPercent: 0.4,
    buyPressure: 0.52,
    orderBookImbalance: 0.1,
    shortCandleSignal: 1,
    tradable: false,
    rejectReasons: ["Low liquidity"],
    metadata: {
      marketRegime: "RANGE_SIDEWAYS",
      shortMomentumPercent: 0.05,
    },
    ...overrides,
  } as MarketContext;
}

function mockScore(overrides: Partial<ScannerScore> = {}): ScannerScore {
  return {
    symbol: "VICTRY",
    score: 28,
    confidence: 30,
    status: "REJECTED",
    reasons: ["Score below threshold", "Directional edge not clear"],
    metrics: {},
    ...overrides,
  };
}

describe("P1-1 mean reversion regime instrumentation", () => {
  beforeEach(() => clearForensicSession());

  it("instruments MR entries with full regime evidence", () => {
    ensureForensicSession({ sessionId: "mr-test", mode: "paper" });
    const entry = bridgeMeanReversionEntry({
      candidateId: "strategy:VICTRY:1",
      symbol: "VICTRY",
      side: "SHORT",
      strategyId: "RANGE_MEAN_REVERSION",
      strategySelectionReason: "Range sideways regime selected mean reversion",
      marketRegime: "RANGE_SIDEWAYS",
      volatilityPercent: 1.1,
      volume24h: env.SCANNER_MIN_VOLUME_24H * 2,
      spreadPercent: 0.04,
      momentumPercent: -0.2,
      shortMomentumPercent: -0.15,
      liquidityScore: 42,
      entryPrice: 10,
    });
    expect(entry).not.toBeNull();
    expect(entry?.forensicRegime).toBe("RANGE");
    expect(entry?.side).toBe("SHORT");
    expect(entry?.strategySelectionReason).toContain("mean reversion");
    expect(isMeanReversionStrategy("RANGE_MEAN_REVERSION")).toBe(true);
  });

  it("builds offline MR analysis by regime, side, volatility, and hold time", () => {
    const entries = [
      {
        candidateId: "1",
        symbol: "A",
        side: "SHORT" as const,
        strategyId: "RANGE_MEAN_REVERSION",
        strategySelectionReason: "range",
        forensicRegime: "RANGE" as const,
        marketRegime: "RANGE_SIDEWAYS",
        volatilityPercent: 0.7,
        trendStrength: 0.2,
        liquidityScore: 50,
        momentumPercent: -0.1,
        shortMomentumPercent: -0.05,
        entryPrice: 10,
        entryTimestamp: "2026-08-13T19:00:00.000Z",
        tradeId: "t1",
      },
      {
        candidateId: "2",
        symbol: "B",
        side: "LONG" as const,
        strategyId: "RANGE_MEAN_REVERSION",
        strategySelectionReason: "range",
        forensicRegime: "HIGH_VOLATILITY" as const,
        marketRegime: "HIGH_VOLATILITY_CHAOS",
        volatilityPercent: 2.1,
        trendStrength: 0.4,
        liquidityScore: 40,
        momentumPercent: 0.3,
        shortMomentumPercent: 0.2,
        entryPrice: 20,
        entryTimestamp: "2026-08-13T19:10:00.000Z",
        tradeId: "t2",
      },
    ];
    const pnlEntries = [
      createPnlLedgerEntry({
        tradeId: "t1",
        symbol: "A",
        side: "SHORT",
        entryPrice: 10,
        exitPrice: 10.2,
        quantity: 10,
        entryFee: 0.01,
        exitFee: 0.01,
      }),
      createPnlLedgerEntry({
        tradeId: "t2",
        symbol: "B",
        side: "LONG",
        entryPrice: 20,
        exitPrice: 19.5,
        quantity: 5,
        entryFee: 0.01,
        exitFee: 0.01,
      }),
    ];
    const analysis = analyzeMeanReversionPerformance({
      entries,
      pnlEntries,
      exitForensics: [
        {
          tradeId: "t1",
          exitModel: "POSITION_MONITOR",
          exitReason: "STOP_LOSS",
          entryPrice: 10,
          exitPrice: 10.2,
          entryTimestamp: "2026-08-13T19:00:00.000Z",
          exitTimestamp: "2026-08-13T19:02:00.000Z",
          durationMs: 30_000,
        },
        {
          tradeId: "t2",
          exitModel: "POSITION_MONITOR",
          exitReason: "TAKE_PROFIT",
          entryPrice: 20,
          exitPrice: 19.5,
          entryTimestamp: "2026-08-13T19:10:00.000Z",
          exitTimestamp: "2026-08-13T19:20:00.000Z",
          durationMs: 600_000,
        },
      ],
    });
    expect(analysis.totalTrades).toBe(2);
    expect(analysis.byRegime.RANGE?.tradeCount).toBe(1);
    expect(analysis.bySide.SHORT?.tradeCount).toBe(1);
    expect(analysis.byVolatilityBucket["low_lt_0.8"]?.tradeCount).toBe(1);
    expect(analysis.byHoldTimeBucket["lt_1m"]?.tradeCount).toBe(1);
    expect(analysis.deterministicHash).toHaveLength(16);
  });
});

describe("P1-2 scanner NOT_DISCOVERED forensics", () => {
  beforeEach(() => clearForensicSession());

  it("records exact scanner qualification reasons with threshold and actualValue", () => {
    ensureForensicSession({ sessionId: "scan-test", mode: "paper" });
    const rejections = bridgeScannerQualificationForensics({
      context: mockContext(),
      score: mockScore(),
      inCycle: false,
      inUniverse: true,
      ranked: false,
      aiScope: false,
    });
    expect(rejections.some((row) => row.reasonCode === "NOT_IN_CYCLE_SLICE")).toBe(true);
    expect(rejections.some((row) => row.filter === "scanner_min_score")).toBe(true);
    expect(rejections.find((row) => row.filter === "scanner_min_score")?.actualValue).toBe(28);
  });

  it("classifies post-entry NOT_DISCOVERED without using future movement in qualification trail", () => {
    ensureForensicSession({ sessionId: "post-entry", mode: "paper" });
    const record = bridgePostEntryNotDiscovered({
      symbol: "REDTRY",
      subsequentMovePercent: 11.71,
      watchlist: ["BTCTRY", "ETHTRY"],
      cycleSymbols: ["BTCTRY"],
    });
    expect(record.stage).toBe("NOT_DISCOVERED");
    expect(record.analysisScope).toBe("POST_ENTRY_ANALYSIS");
    expect(record.subsequentMovePercent).toBe(11.71);
    expect(record.qualificationTrail.some((row) => row.reasonCode === "NOT_IN_UNIVERSE")).toBe(true);
    expect(record.qualificationTrail.every((row) => row.actualValue !== 11.71)).toBe(true);
  });

  it("maps chaos/high volatility regimes for forensic taxonomy", () => {
    const regime = classifyForensicRegime({
      marketRegime: "HIGH_VOLATILITY_CHAOS",
      volatilityPercent: 2.4,
      volume24h: env.SCANNER_MIN_VOLUME_24H * 2,
      spreadPercent: 0.2,
      chaosProbability: 0.7,
    });
    expect(regime === "CHAOS" || regime === "HIGH_VOLATILITY").toBe(true);
  });

  it("reproduces COW cursor miss and rescues through bounded priority lane", () => {
    const watchlist = Array.from({ length: 304 }).map((_, idx) => `S${idx}TRY`);
    watchlist[0] = "COWTRY";
    const plan = buildScannerCyclePlan({
      watchlist,
      cursor: 224,
      cycleLimit: 79,
      prioritySymbols: [{ symbol: "COWTRY", priorityScore: 99, reason: "TOP_GAINER" }],
      priorityMaxPerCycle: 4,
    });
    expect(plan.rotationSymbols.includes("COWTRY")).toBe(false);
    expect(plan.prioritySymbols).toContain("COWTRY");
    expect(plan.evaluationSymbols).toContain("COWTRY");
    expect(plan.prioritySymbols.length).toBeLessThanOrEqual(4);
  });

  it("deduplicates priority symbols and keeps rotation fairness", () => {
    const watchlist = ["A", "B", "C", "D", "E"].map((row) => `${row}TRY`);
    const plan = buildScannerCyclePlan({
      watchlist,
      cursor: 1,
      cycleLimit: 3,
      prioritySymbols: [
        { symbol: "BTRY", priorityScore: 10, reason: "TOP_GAINER" },
        { symbol: "ATRY", priorityScore: 9, reason: "TOP_GAINER" },
        { symbol: "ATRY", priorityScore: 9, reason: "TOP_GAINER" },
      ],
      priorityMaxPerCycle: 2,
    });
    expect(plan.rotationSymbols).toEqual(["BTRY", "CTRY", "DTRY"]);
    expect(plan.prioritySymbols).toEqual(["ATRY"]);
    expect(plan.evaluationSymbols.slice(-3)).toEqual(plan.rotationSymbols);
    expect(plan.duplicatesRemoved).toBeGreaterThanOrEqual(0);
  });
});

describe("P1-3 EV calibration", () => {
  it("builds deterministic EV calibration buckets", () => {
    const report = buildEvCalibrationReportDeterministic(
      {
        evAudits: [
          {
            candidateId: "ev:1",
            symbol: "AVNTTRY",
            formulaVersion: "hybrid-v1",
            expectedValue: 15.8,
            threshold: 55,
            verdict: "APPROVED",
            reasonCode: "EV_PASS",
            timestamp: "2026-08-13T19:00:00.000Z",
          },
          {
            candidateId: "ev:2",
            symbol: "ATMTRY",
            formulaVersion: "hybrid-v1",
            expectedValue: 16.2,
            threshold: 55,
            verdict: "APPROVED",
            reasonCode: "EV_PASS",
            timestamp: "2026-08-13T19:05:00.000Z",
          },
        ],
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
            exitPrice: 10.2,
            quantity: 50,
            entryFee: 0.05,
            exitFee: 0.05,
          }),
        ],
      },
      "2026-08-13T20:00:00.000Z",
    );
    expect(report.totalSamples).toBeGreaterThan(0);
    expect(report.buckets[0]?.sampleSize).toBeGreaterThan(0);
    expect(report.deterministicHash).toHaveLength(16);
    const second = buildEvCalibrationReportDeterministic(
      {
        evAudits: [
          {
            candidateId: "ev:1",
            symbol: "AVNTTRY",
            formulaVersion: "hybrid-v1",
            expectedValue: 15.8,
            threshold: 55,
            verdict: "APPROVED",
            reasonCode: "EV_PASS",
            timestamp: "2026-08-13T19:00:00.000Z",
          },
        ],
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
        ],
      },
      "2026-08-13T20:00:00.000Z",
    );
    expect(report.deterministicHash).not.toBe(second.deterministicHash);
  });
});

describe("P1-4 entry timing forensics", () => {
  it("classifies entry timing without future data", () => {
    const record = buildEntryTimingRecord({
      candidateId: "exec:AVNTTRY:1",
      symbol: "AVNTTRY",
      side: "LONG",
      candidateTimestamp: "2026-08-13T19:00:00.000Z",
      decisionTimestamp: "2026-08-13T19:00:30.000Z",
      entryTimestamp: "2026-08-13T19:03:30.000Z",
      priceAtCandidate: 5.05,
      priceAtDecision: 5.06,
      priceAtEntry: 5.12,
    });
    expect(record.entryDelayMs).toBe(180_000);
    expect(record.classification).toBe("EDGE_DECAY");
    const good = classifyEntryTiming({
      side: "LONG",
      entryDelayMs: 20_000,
      movementToEntryPercent: 0.05,
    });
    expect(good.classification).toBe("GOOD_ENTRY");
    const chasing = classifyEntryTiming({
      side: "LONG",
      entryDelayMs: 180_000,
      movementToEntryPercent: 0.1,
    });
    expect(chasing.classification).toBe("CHASING");
  });
});

describe("P1-5 strategy performance artifact", () => {
  it("builds canonical strategy report with sample size and regime breakdown", () => {
    const session = ensureForensicSession({ sessionId: "strategy-report", mode: "paper" });
    session.meanReversionEntries = [
      {
        candidateId: "1",
        tradeId: "t1",
        symbol: "AVNTTRY",
        side: "LONG",
        strategyId: "RANGE_MEAN_REVERSION",
        strategySelectionReason: "range",
        forensicRegime: "RANGE",
        marketRegime: "RANGE_SIDEWAYS",
        volatilityPercent: 0.9,
        trendStrength: 0.2,
        liquidityScore: 50,
        momentumPercent: 0.1,
        shortMomentumPercent: 0.05,
        entryPrice: 5,
        entryTimestamp: "2026-08-13T19:00:00.000Z",
      },
    ];
    session.pnlEntries = [
      createPnlLedgerEntry({
        tradeId: "t1",
        symbol: "AVNTTRY",
        side: "LONG",
        entryPrice: 5,
        exitPrice: 4.9,
        quantity: 100,
        entryFee: 0.08,
        exitFee: 0.08,
        exitForensics: {
          exitModel: "POSITION_MONITOR",
          exitReason: "STOP_LOSS",
          entryPrice: 5,
          exitPrice: 4.9,
          entryTimestamp: "2026-08-13T19:00:00.000Z",
          exitTimestamp: "2026-08-13T19:05:00.000Z",
          durationMs: 300_000,
        },
      }),
    ];
    const reports = buildP1ForensicReports(session);
    const row = reports.strategyPerformance?.strategies.find((item) => item.strategy === "RANGE_MEAN_REVERSION");
    expect(row?.sampleSize).toBe(1);
    expect(row?.tradeCount).toBe(1);
    expect(row?.netPnL).toBeLessThan(0);
    expect(row?.regimeBreakdown.RANGE?.tradeCount).toBe(1);
    expect(reports.strategyPerformance?.deterministicHash).toHaveLength(16);
  });
});

describe("P1 integrity", () => {
  it("rejects look-ahead in simulation guard", () => {
    const guard = beginSimulationIntegrityGuard({
      sessionId: "p1-integrity",
      decisionTimestamp: 1000,
      stage: "scanner",
    });
    expect(() => guard.assertDataTimestamp("future.close", 2000)).toThrow(SimulationIntegrityViolation);
  });

  it("produces deterministic scanner rejection reasons", () => {
    const first = buildScannerQualificationRejections({
      context: mockContext({ symbol: "REDTRY" }),
      score: mockScore({ symbol: "REDTRY", score: 22 }),
      inCycle: false,
      inUniverse: true,
      ranked: false,
      aiScope: false,
    });
    const second = buildScannerQualificationRejections({
      context: mockContext({ symbol: "REDTRY" }),
      score: mockScore({ symbol: "REDTRY", score: 22 }),
      inCycle: false,
      inUniverse: true,
      ranked: false,
      aiScope: false,
    });
    expect(first).toEqual(second);
  });
});
