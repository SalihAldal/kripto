import { describe, expect, it } from "vitest";
import {
  evaluateAiExecutionGate,
  evaluateAiExecutionReadiness,
  resolveAiExecutionGatePolicy,
} from "@/src/server/execution/ai-execution-gate.service";
import type { AIConsensusResult } from "@/src/types/ai";
import {
  bridgeAiExecutionGate,
  bridgeExecutionCandidateForensic,
  bridgeFeeEdgeMetrics,
} from "@/src/server/forensics/forensic-bridge.service";
import { clearForensicSession, ensureForensicSession } from "@/src/server/forensics/forensic-context";
import {
  computeClosedTradeFeeRatio,
  computeFeeEdgeMetrics,
  reconcileFeeStatus,
} from "@/src/server/forensics/fee-edge-metrics.service";
import {
  mapPositionMonitorExit,
  mapReplayWindowExit,
} from "@/src/server/forensics/exit-forensics.service";
import { replayExitFromCandles } from "@/src/server/forensics/exit-replay.engine";
import {
  createPnlLedgerEntry,
  reconcileRoundPnl,
} from "@/src/server/forensics/pnl-ledger.service";
import {
  beginSimulationIntegrityGuard,
  SimulationIntegrityViolation,
} from "@/src/server/forensics/simulation-integrity.guard";

function mockAi(input: {
  finalDecision: string;
  consensus?: string | null;
  withProviders?: boolean;
  omitConsensus?: boolean;
}): AIConsensusResult {
  const consensusValue = input.omitConsensus
    ? undefined
    : input.consensus === null
      ? undefined
      : (input.consensus ?? input.finalDecision);
  return {
    finalDecision: input.finalDecision,
    finalConsensusDecision: consensusValue as AIConsensusResult["finalConsensusDecision"],
    confidence: 80,
    finalConfidence: 80,
    explanation: "test",
    generatedAt: new Date().toISOString(),
    outputs: input.withProviders === false
      ? []
      : [{ providerId: "p1", ok: true, weight: 1, output: { decision: input.finalDecision, confidence: 80 } }],
    decisionPayload: input.omitConsensus
      ? {}
      : {
          consensusEngine: { finalDecision: input.consensus ?? input.finalDecision },
        },
  } as AIConsensusResult;
}

describe("P0-1 AI execution gate", () => {
  const productionPolicy = resolveAiExecutionGatePolicy({ mode: "paper", learningLane: true });

  it("uses ADVISORY as the production default policy", () => {
    expect(productionPolicy).toBe("ADVISORY");
    const gate = evaluateAiExecutionGate({
      aiDecision: "NO_TRADE",
      policy: productionPolicy,
      learningLane: true,
      microTradeEligible: true,
    });
    expect(gate.verdict).toBe("AI_ADVISORY_ONLY");
    expect(gate.executionSide).toBe("BUY");
  });

  it("blocks NO_TRADE under explicit VETO policy", () => {
    const gate = evaluateAiExecutionGate({
      aiDecision: "NO_TRADE",
      policy: "VETO",
      learningLane: true,
      microTradeEligible: true,
    });
    expect(gate.verdict).toBe("AI_GATE_BLOCK");
    expect(gate.executionSide).toBeNull();
    expect(gate.reasonCode).toBe("AI_VETO");
  });

  for (const blocked of ["HOLD", "REJECT", "WAIT"] as const) {
    it(`blocks ${blocked} under VETO policy`, () => {
      const gate = evaluateAiExecutionGate({
        aiDecision: blocked,
        policy: "VETO",
        learningLane: false,
        microTradeEligible: false,
      });
      expect(gate.verdict).toBe("AI_GATE_BLOCK");
      expect(gate.executionSide).toBeNull();
      expect(gate.reasonCode).toBe("AI_VETO");
    });
  }

  it("allows BUY under VETO policy", () => {
    const gate = evaluateAiExecutionGate({
      aiDecision: "BUY",
      policy: "VETO",
      learningLane: false,
      microTradeEligible: false,
      consensusDecision: "BUY",
    });
    expect(gate.verdict).toBe("AI_GATE_PASS");
    expect(gate.executionSide).toBe("BUY");
    expect(gate.reasonCode).toBe("AI_GATE_PASS");
  });

  it("allows SELL under VETO policy when consensus present", () => {
    const gate = evaluateAiExecutionReadiness({
      ai: mockAi({ finalDecision: "SELL", consensus: "SELL" }),
      policy: "VETO",
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_PASS");
    expect(gate.executionSide).toBe("SELL");
  });

  it("blocks when AI verdict is missing", () => {
    const gate = evaluateAiExecutionReadiness({
      ai: mockAi({ finalDecision: "", consensus: "BUY" }),
      policy: "VETO",
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_BLOCK");
    expect(gate.reasonCode).toBe("AI_VERDICT_MISSING");
  });

  it("blocks when consensus is missing despite AI verdict", () => {
    const gate = evaluateAiExecutionReadiness({
      ai: mockAi({ finalDecision: "BUY", omitConsensus: true }),
      policy: "VETO",
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_BLOCK");
    expect(gate.reasonCode).toBe("AI_CONSENSUS_MISSING");
  });

  it("blocks when AI object is missing", () => {
    const gate = evaluateAiExecutionReadiness({
      ai: null,
      policy: "VETO",
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_BLOCK");
    expect(gate.reasonCode).toBe("AI_VERDICT_MISSING");
  });

  it("blocks when provider evidence is missing", () => {
    const gate = evaluateAiExecutionReadiness({
      ai: mockAi({ finalDecision: "BUY", consensus: "BUY", withProviders: false }),
      policy: "VETO",
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_BLOCK");
    expect(gate.reasonCode).toBe("AI_EVIDENCE_MISSING");
  });

  it("advisory policy does not hard-veto NO_TRADE", () => {
    const gate = evaluateAiExecutionGate({
      aiDecision: "NO_TRADE",
      policy: "ADVISORY",
      learningLane: true,
      microTradeEligible: true,
    });
    expect(gate.verdict).toBe("AI_ADVISORY_ONLY");
    expect(gate.reasonCode).toBe("AI_ADVISORY");
    expect(gate.executionSide).toBe("BUY");
  });

  it("advisory-only path proceeds without audited override payload", () => {
    const gate = evaluateAiExecutionGate({
      aiDecision: "NO_TRADE",
      policy: "ADVISORY",
      learningLane: true,
      microTradeEligible: true,
    });
    expect(gate.verdict).toBe("AI_ADVISORY_ONLY");
    expect(gate.policy).toBe("ADVISORY");
    expect(gate.executionSide).toBe("BUY");
    expect(gate.reasonCode).toBe("AI_ADVISORY");
  });

  it("blocks when AI final decision conflicts with consensus", () => {
    const gate = evaluateAiExecutionReadiness({
      ai: mockAi({ finalDecision: "BUY", consensus: "NO_TRADE" }),
      policy: "VETO",
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_BLOCK");
    expect(gate.reasonCode).toBe("AI_DECISION_CONFLICT");
  });

  it("normalizes NO-TRADE spellings and blocks under veto", () => {
    const gate = evaluateAiExecutionReadiness({
      ai: mockAi({ finalDecision: "NO-TRADE", consensus: "NO TRADE" }),
      policy: "VETO",
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_BLOCK");
    expect(gate.reasonCode).toBe("AI_VETO");
  });

  it("persists AI gate verdict in forensic decision trace", () => {
    clearForensicSession();
    ensureForensicSession({ sessionId: "ai-gate-test", mode: "paper" });
    bridgeAiExecutionGate({
      candidateId: "exec:AVNTTRY:1",
      symbol: "AVNTTRY",
      aiVerdict: "NO_TRADE",
      aiFinalDecision: "NO_TRADE",
      consensusDecision: "NO_TRADE",
      aiGatePolicy: "VETO",
      aiGateVerdict: "AI_GATE_BLOCK",
      executionVerdict: "AI_GATE_BLOCK",
      policy: "VETO",
      reasonCode: "NO_TRADE",
      reasonDetail: "blocked",
    });
    const session = ensureForensicSession({ sessionId: "ai-gate-test", mode: "paper" });
    const row = session.decisions.find(
      (r) => r.stage === "execution" && r.reasonCode === "NO_TRADE" && r.verdict === "REJECT",
    );
    expect(row).toBeTruthy();
    const payload = JSON.parse(row!.reasonDetail);
    expect(payload.aiFinalDecision).toBe("NO_TRADE");
    expect(payload.consensusDecision).toBe("NO_TRADE");
    expect(payload.aiGatePolicy).toBe("VETO");
    expect(payload.aiGateVerdict).toBe("AI_GATE_BLOCK");
  });
});

describe("P0-2 exit model classification", () => {
  it("replays TP hit without END_OF_REPLAY", () => {
    const result = replayExitFromCandles({
      side: "LONG",
      entryPrice: 100,
      entryTimestamp: 1000,
      takeProfitPrice: 101,
      stopLossPrice: 98,
      candles: [{ timestamp: 1100, high: 101.2, low: 99.8, close: 101.1 }],
    });
    expect(result?.exitReason).toBe("TAKE_PROFIT");
    expect(result?.exitModel).toBe("REPLAY_WINDOW");
    expect(result?.replayWindowEnded).toBe(false);
  });

  it("replays SL hit", () => {
    const result = replayExitFromCandles({
      side: "LONG",
      entryPrice: 100,
      entryTimestamp: 1000,
      takeProfitPrice: 103,
      stopLossPrice: 99,
      candles: [{ timestamp: 1100, high: 100.2, low: 98.8, close: 99.1 }],
    });
    expect(result?.exitReason).toBe("STOP_LOSS");
  });

  it("respects explicit same-candle TP precedence override", () => {
    const result = replayExitFromCandles({
      side: "LONG",
      entryPrice: 100,
      entryTimestamp: 1000,
      takeProfitPrice: 101,
      stopLossPrice: 99,
      sameCandlePrecedence: "TAKE_PROFIT",
      candles: [{ timestamp: 1100, high: 101.5, low: 98.5, close: 100.2 }],
    });
    expect(result?.exitReason).toBe("TAKE_PROFIT");
    expect(result?.replayPrecedenceRule).toBe("TAKE_PROFIT");
  });

  it("classifies max-hold replay window as TIME_EXIT", () => {
    const maxHoldMs = 60_000;
    const entryTimestamp = 1_000_000;
    const result = replayExitFromCandles({
      side: "LONG",
      entryPrice: 100,
      entryTimestamp,
      takeProfitPrice: 110,
      stopLossPrice: 90,
      maxHoldMs,
      lastCandleTimestamp: entryTimestamp + 120_000,
      candles: [
        { timestamp: entryTimestamp + 30_000, high: 100.5, low: 99.5, close: 100.1 },
        { timestamp: entryTimestamp + 90_000, high: 100.8, low: 99.7, close: 100.2 },
      ],
    });
    expect(result?.exitReason).toBe("TIME_EXIT");
    expect(result?.replayWindowEnded).toBe(false);
    expect(result?.exitTimestamp).toBe(entryTimestamp + 120_000);
  });

  it("classifies dataset window end as END_OF_REPLAY", () => {
    const entryTimestamp = 1_000_000;
    const endTimestamp = entryTimestamp + 30_000;
    const result = replayExitFromCandles({
      side: "LONG",
      entryPrice: 100,
      entryTimestamp,
      takeProfitPrice: 110,
      stopLossPrice: 90,
      endTimestamp,
      candles: [{ timestamp: entryTimestamp + 15_000, high: 100.4, low: 99.6, close: 100.1 }],
    });
    expect(result?.exitReason).toBe("END_OF_REPLAY");
    expect(result?.replayWindowEnded).toBe(true);
  });

  it("maps position monitor exits separately from replay", () => {
    const tpExit = mapPositionMonitorExit({
      closeReason: "TAKE_PROFIT",
      entryPrice: 5.05,
      exitPrice: 5.17,
      entryTimestamp: "2026-08-13T19:00:00.000Z",
      exitTimestamp: "2026-08-13T19:05:00.000Z",
      takeProfitPrice: 5.17,
      stopLossPrice: 4.95,
      side: "LONG",
      quantity: 100,
      openFee: 0.08,
      closeFee: 0.08,
    });
    expect(tpExit.exitModel).toBe("POSITION_MONITOR");
    expect(tpExit.exitReason).toBe("TAKE_PROFIT");
    expect(tpExit.tpLevel).toBe(5.17);

    const strategyExit = mapPositionMonitorExit({
      closeReason: "MOMENTUM_FADE",
      entryPrice: 10,
      exitPrice: 10.05,
      entryTimestamp: Date.now() - 60_000,
      side: "LONG",
      quantity: 10,
    });
    expect(strategyExit.exitReason).toBe("STRATEGY_EXIT");
    expect(strategyExit.strategyExit).toBe(true);
    expect(strategyExit.strategyExitReason).toBe("MOMENTUM_FADE");

    const timeExit = mapPositionMonitorExit({
      closeReason: "TIMEOUT",
      entryPrice: 10,
      exitPrice: 9.95,
      entryTimestamp: Date.now() - 90_000,
      side: "LONG",
      quantity: 10,
      decisionTimestamp: Date.now() - 1_000,
      priceAtMonitorTick: 9.95,
    });
    expect(timeExit.exitReason).toBe("TIME_EXIT");
    expect(timeExit.timeExitReason).toBe("TIMEOUT");

    const replayExit = mapReplayWindowExit({
      exitReason: "END_OF_REPLAY",
      entryPrice: 100,
      exitPrice: 100.2,
      entryTimestamp: 1000,
      exitTimestamp: 2000,
      takeProfitPrice: 101,
      stopLossPrice: 99,
      replayWindowEnded: true,
      replayPrecedenceRule: "STOP_LOSS",
    });
    expect(replayExit.exitModel).toBe("REPLAY_WINDOW");
    expect(replayExit.replayPrecedenceRule).toBe("STOP_LOSS");
  });
});

describe("P0-3 fee-aware metrics", () => {
  it("computes pre-trade fee edge metrics without future data", () => {
    const guard = beginSimulationIntegrityGuard({
      sessionId: "p0-fee-edge-no-lookahead",
      decisionTimestamp: 1000,
      stage: "ev",
    });
    expect(() => guard.assertDataTimestamp("future-candle", 1500)).toThrow(SimulationIntegrityViolation);
    const metrics = computeFeeEdgeMetrics({
      entryPrice: 5.05,
      quantity: 100,
      takeProfitPercent: 2,
      stopLossPercent: 1,
      takerFeeRate: 0.0015,
    });
    expect(metrics.estimatedEntryFee).toBeGreaterThan(0);
    expect(metrics.estimatedExitFee).toBeGreaterThan(0);
    expect(metrics.estimatedRoundTripFees).toBe(metrics.estimatedEntryFee + metrics.estimatedExitFee);
    expect(metrics.estimatedRoundTripFee).toBe(metrics.estimatedRoundTripFees);
    expect(metrics.expectedGrossToFeeRatio).toBeGreaterThan(0);
    expect(metrics.feeToExpectedGrossRatio).toBeGreaterThan(0);
    expect(metrics.minimumGrossToCoverFees).toBe(metrics.estimatedRoundTripFees);
    expect(metrics.expectedNetAfterFeesAtTp).toBe(
      Number((metrics.expectedGrossAtTp - metrics.estimatedRoundTripFees).toFixed(8)),
    );
    expect(metrics.expectedNetPnL).toBe(metrics.expectedNetAfterFeesAtTp);
    expect(metrics.feeEdgeClass).toBeDefined();
  });

  it("records fee metrics on execution candidate forensic trace", () => {
    clearForensicSession();
    const session = ensureForensicSession({ sessionId: "fee-test", mode: "paper" });
    const metrics = computeFeeEdgeMetrics({
      entryPrice: 10,
      quantity: 50,
      takeProfitPercent: 1.5,
      stopLossPercent: 0.8,
    });
    bridgeFeeEdgeMetrics({
      candidateId: "exec:ATMTRY:1",
      symbol: "ATMTRY",
      metrics,
    });
    bridgeExecutionCandidateForensic({
      candidateId: "exec:ATMTRY:1",
      symbol: "ATMTRY",
      aiVerdict: "BUY",
      executionVerdict: "AI_GATE_PASS",
      riskVerdict: "APPROVED",
      sizingVerdict: "qty=50",
      feeEstimate: metrics,
      orderVerdict: "SUBMIT_PENDING",
      timestamp: new Date().toISOString(),
    });
    expect(session.decisions.some((row) => row.reasonCode === "FEE_EDGE_METRICS")).toBe(true);
    expect(session.decisions.some((row) => row.reasonCode === "EXECUTION_CANDIDATE")).toBe(true);
  });

  it("reconciles closed trade netPnL and feeToGrossRatio", () => {
    const entry = createPnlLedgerEntry({
      tradeId: "t-fee",
      symbol: "AVNTTRY",
      side: "LONG",
      entryPrice: 5.05,
      exitPrice: 5.0,
      quantity: 100,
      entryFee: 0.08,
      exitFee: 0.08,
      exitReason: "STOP_LOSS",
      exitModel: "POSITION_MONITOR",
    });
    expect(entry.grossPnL).toBe(Number((-0.05 * 100).toFixed(8)));
    expect(entry.totalFee).toBe(Number((0.16).toFixed(8)));
    expect(entry.netPnL).toBe(Number((entry.grossPnL - entry.totalFee).toFixed(8)));
    expect(entry.feeReconciliationStatus).toBe("PASS");
    expect(entry.feeToGrossRatio).toBe(computeClosedTradeFeeRatio({ grossPnL: entry.grossPnL, totalFee: entry.totalFee }));
    const reconcile = reconcileRoundPnl([entry], entry.netPnL);
    expect(reconcile.reconciled).toBe(true);
  });

  it("captures gross-positive but net-negative fee erosion cases", () => {
    const entry = createPnlLedgerEntry({
      tradeId: "t-fee-erosion",
      symbol: "ATMTRY",
      side: "LONG",
      entryPrice: 10,
      exitPrice: 10.01,
      quantity: 10,
      entryFee: 0.08,
      exitFee: 0.08,
      exitReason: "TAKE_PROFIT",
      exitModel: "POSITION_MONITOR",
    });
    expect(entry.grossPnL).toBeGreaterThan(0);
    expect(entry.netPnL).toBeLessThan(0);
    expect(entry.grossPositiveNetNegative).toBe(true);
    expect(entry.feeEdgeClass).toBe("FEE_EROSION");
    expect(entry.feeReconciliationStatus).toBe("PASS");
  });

  it("marks fee reconciliation FAIL when totals diverge", () => {
    const status = reconcileFeeStatus({
      grossPnL: 1,
      entryFee: 0.1,
      exitFee: 0.1,
      totalFee: 0.5,
      netPnL: 0.5,
    });
    expect(status).toBe("FAIL");
  });
});

describe("P0 simulation integrity", () => {
  it("rejects look-ahead candle access", () => {
    const guard = beginSimulationIntegrityGuard({
      sessionId: "sim-no-lookahead",
      decisionTimestamp: 1000,
      stage: "decision",
    });
    expect(() => guard.assertDataTimestamp("candle.closeTime", 1500)).toThrow(SimulationIntegrityViolation);
  });

  it("replays deterministically for same candle input", () => {
    const input = {
      side: "LONG" as const,
      entryPrice: 100,
      entryTimestamp: 1000,
      takeProfitPrice: 101,
      stopLossPrice: 98,
      candles: [{ timestamp: 1100, high: 101.2, low: 99.8, close: 101.1 }],
    };
    const first = replayExitFromCandles(input);
    const second = replayExitFromCandles(input);
    expect(first).toEqual(second);
  });
});
