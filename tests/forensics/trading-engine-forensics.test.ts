import { describe, expect, it, beforeEach } from "vitest";
import {
  bridgeAiProviderResult,
  bridgeConsensusResult,
  bridgeExecutionDecision,
  bridgeHybridEv,
  bridgePaperFill,
  bridgeRiskSizing,
  bridgeScannerObservability,
  explainCandidateNotTraded,
  beginForensicPaperSession,
  clearForensicSession,
} from "@/src/server/forensics";
import { summarizeConsensus } from "@/src/server/ai/consensus-engine";
import { buildNativePaperDiagnostics } from "@/src/server/forensics/native-paper-diagnostics.service";
import { replayExitFromCandles } from "@/src/server/forensics/exit-replay.engine";
import {
  beginSimulationIntegrityGuard,
  resetSimulationIntegrityChecks,
  SimulationIntegrityViolation,
} from "@/src/server/forensics/simulation-integrity.guard";
import {
  buildPnlLedgerSummary,
  createPnlLedgerEntry,
  reconcileRoundPnl,
} from "@/src/server/forensics/pnl-ledger.service";
import {
  createPaperSessionSnapshot,
  detectStalePaperSession,
  recoverStalePaperSession,
  transitionPaperSession,
} from "@/src/server/forensics/paper-session-state.service";
import {
  assertBinanceFailureIsExplicit,
  classifyBinanceFailure,
  recordBinanceRequest,
} from "@/src/server/forensics/binance-request-audit.service";
import { PaperDbUnavailableError } from "@/src/server/forensics/db-health.service";
import type { AIProviderResult } from "@/src/types/ai";

function mockProvider(decision: "BUY" | "SELL" | "HOLD" | "NO_TRADE", remote = true): AIProviderResult {
  return {
    providerId: "provider-1",
    providerName: "Provider 1",
    ok: true,
    latencyMs: 10,
    output: {
      decision,
      confidence: 72,
      riskScore: 35,
      targetPrice: 105,
      stopPrice: 98,
      expectedMovePercent: 2,
      expectedMoveRange: { min: 1, max: 3 },
      targetPercent: 2,
      stopPercent: 1,
      timeHorizonMinutes: 30,
      estimatedDurationSec: 1800,
      riskReason: "ok",
      invalidationReason: "none",
      reasoningShort: "test",
      metadata: { remote, remoteOk: remote, degraded: !remote },
    },
  };
}

describe("trading engine forensics", () => {
  beforeEach(() => {
    clearForensicSession();
    resetSimulationIntegrityChecks();
  });

  it("records scanner rejection with terminal trace", () => {
    beginForensicPaperSession({ sessionId: "test-scanner" });
    bridgeScannerObservability({
      decisionId: "d1",
      symbol: "AVNTTRY",
      scannerScore: 42,
      scannerConfidence: 38,
      status: "REJECT",
      reasons: ["Tape yetersiz"],
      metrics: { lastPrice: 5.05, change24h: 3.2 },
    });
    const explained = explainCandidateNotTraded("AVNTTRY");
    expect(explained.found).toBe(true);
    expect(explained.records.some((row) => row.reasonCode.includes("Tape") || row.stage === "scanner")).toBe(true);
  });

  it("keeps candidate trace from scanner to decision", () => {
    beginForensicPaperSession({ sessionId: "test-candidate" });
    bridgeScannerObservability({
      decisionId: "d2",
      symbol: "ATMTRY",
      scannerScore: 61,
      scannerConfidence: 58,
      status: "QUALIFIED",
      reasons: [],
    });
    bridgeExecutionDecision({
      candidateId: "scanner:ATMTRY:abc",
      symbol: "ATMTRY",
      approved: false,
      reasonCode: "EV_REJECT",
      reasonDetail: "Edge below threshold",
    });
    const explained = explainCandidateNotTraded("ATMTRY");
    expect(explained.records.length).toBeGreaterThan(0);
  });

  it("distinguishes remote vs degraded AI states", () => {
    beginForensicPaperSession({ sessionId: "test-ai" });
    const remote = bridgeAiProviderResult({
      symbol: "AVNTTRY",
      provider: "openai",
      model: "gpt-test",
      latencyMs: 120,
      ok: true,
      remote: true,
      degraded: false,
    });
    const degraded = bridgeAiProviderResult({
      symbol: "AVNTTRY",
      provider: "openai",
      model: "gpt-test",
      latencyMs: 80,
      ok: false,
      remote: false,
      degraded: true,
      reason: "timeout",
    });
    expect(remote.executionMode).toBe("REMOTE");
    expect(degraded.executionMode).toBe("AI_DEGRADED");
    expect(remote.success).toBe(true);
    expect(degraded.success).toBe(false);
  });

  it("produces deterministic consensus for same provider inputs", () => {
    const providers = [mockProvider("BUY"), mockProvider("BUY"), mockProvider("BUY", true)];
    const first = summarizeConsensus(providers);
    const second = summarizeConsensus(providers);
    expect(first.finalDecision).toBe(second.finalDecision);
    expect(first.finalConfidence).toBe(second.finalConfidence);
    expect(first.score).toBe(second.score);
  });

  it("never silently passes EV UNKNOWN", () => {
    beginForensicPaperSession({ sessionId: "test-ev" });
    const audit = bridgeHybridEv({
      candidateId: "ev:1",
      symbol: "AVNTTRY",
      expectedValue: undefined,
      threshold: 55,
      verdict: "UNKNOWN",
      reasonCode: "EV_UNKNOWN",
    });
    const explained = explainCandidateNotTraded("AVNTTRY");
    expect(audit.verdict).toBe("UNKNOWN");
    expect(explained.records.some((row) => row.verdict === "UNKNOWN" || row.reasonCode === "EV_UNKNOWN")).toBe(true);
  });

  it("records risk and sizing rejection traces", () => {
    beginForensicPaperSession({ sessionId: "test-risk" });
    bridgeRiskSizing({
      candidateId: "risk:1",
      symbol: "AVNTTRY",
      approved: false,
      rejectionReason: "Daily loss limit reached",
      requestedSize: 95000,
      computedSize: 0,
    });
    const explained = explainCandidateNotTraded("AVNTTRY");
    expect(explained.records.some((row) => row.stage === "risk" || row.stage === "sizing")).toBe(true);
  });

  it("reconciles paper order audit fields", () => {
    beginForensicPaperSession({ sessionId: "test-order" });
    const order = bridgePaperFill({
      symbol: "AVNTTRY",
      side: "BUY",
      entryPrice: 5.0525,
      quantity: 100,
      fees: 0.15,
      orderId: "ord-1",
      fillId: "fill-1",
      positionId: "pos-1",
      roundId: "round-1",
      reconciled: true,
    });
    expect(order.reconciled).toBe(true);
    expect(order.orderId).toBe("ord-1");
  });

  it("replays TP before SL on same candle with SL precedence default", () => {
    const result = replayExitFromCandles({
      side: "LONG",
      entryPrice: 100,
      entryTimestamp: 1000,
      takeProfitPrice: 101,
      stopLossPrice: 99,
      candles: [{ timestamp: 1100, high: 101.5, low: 98.5, close: 100.2 }],
    });
    expect(result?.exitReason).toBe("STOP_LOSS");
  });

  it("replays TP hit", () => {
    const result = replayExitFromCandles({
      side: "LONG",
      entryPrice: 100,
      entryTimestamp: 1000,
      takeProfitPrice: 101,
      stopLossPrice: 98,
      candles: [{ timestamp: 1100, high: 101.2, low: 99.8, close: 101.1 }],
    });
    expect(result?.exitReason).toBe("TAKE_PROFIT");
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

  it("fails simulation integrity on future candle access", () => {
    const guard = beginSimulationIntegrityGuard({
      sessionId: "sim-1",
      decisionTimestamp: 1000,
      stage: "decision",
    });
    expect(() => guard.assertDataTimestamp("candle.closeTime", 1500)).toThrow(SimulationIntegrityViolation);
  });

  it("reconciles canonical PnL ledger", () => {
    const entries = [
      createPnlLedgerEntry({
        tradeId: "t1",
        symbol: "AVNTTRY",
        side: "LONG",
        entryPrice: 5.0525,
        exitPrice: 5.17,
        quantity: 100,
        entryFee: 0.08,
        exitFee: 0.08,
        exitReason: "TAKE_PROFIT",
      }),
      createPnlLedgerEntry({
        tradeId: "t2",
        symbol: "ATMTRY",
        side: "LONG",
        entryPrice: 10,
        exitPrice: 9.8,
        quantity: 50,
        entryFee: 0.05,
        exitFee: 0.05,
        exitReason: "STOP_LOSS",
      }),
    ];
    const summary = buildPnlLedgerSummary(entries);
    const reconcile = reconcileRoundPnl(entries, summary.netPnL);
    expect(reconcile.reconciled).toBe(true);
    expect(summary.tradeCount).toBe(2);
  });

  it("detects stale paper session and recovers to FAILED", () => {
    let snapshot = createPaperSessionSnapshot({ sessionId: "sess-1", status: "RUNNING_ROUND" });
    snapshot = {
      ...snapshot,
      lastProgressAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    };
    const stale = detectStalePaperSession(snapshot);
    expect(stale.stale).toBe(true);
    const recovered = recoverStalePaperSession(snapshot);
    expect(recovered.status).toBe("FAILED");
  });

  it("marks Binance failures explicit when zero candidates", () => {
    recordBinanceRequest({ endpoint: "/api/v3/ticker/24hr", latencyMs: 1200, status: 429, retry: 2, backoffMs: 500 });
    const result = assertBinanceFailureIsExplicit({ endpoint: "/api/v3/ticker/24hr", status: 429, candidateCount: 0 });
    expect(result.explicit).toBe(true);
    expect(classifyBinanceFailure(429)).toBe("RATE_LIMIT");
  });

  it("throws PaperDbUnavailableError type", () => {
    const err = new PaperDbUnavailableError("db down");
    expect(err.code).toBe("PAPER_DB_UNAVAILABLE");
  });

  it("builds native diagnostic artifact counts", () => {
    const session = beginForensicPaperSession({ sessionId: "diag-1" });
    bridgeScannerObservability({
      decisionId: "d3",
      symbol: "AVNTTRY",
      scannerScore: 40,
      scannerConfidence: 35,
      status: "REJECT",
      reasons: ["Kalite dusuk"],
    });
    const diagnostics = buildNativePaperDiagnostics(session);
    expect(diagnostics.scannerCount).toBeGreaterThan(0);
    expect(diagnostics.rejectionCountsByStage.scanner ?? diagnostics.rejectionCountsByStage.decision).toBeDefined();
  });

  it("records consensus audit without opaque output", () => {
    beginForensicPaperSession({ sessionId: "consensus-1" });
    bridgeConsensusResult({
      symbol: "AVNTTRY",
      consensus: {
        finalDecision: "NO_TRADE",
        finalConfidence: 52,
        finalRiskScore: 44,
        score: 0.1,
        explanation: "threshold not met",
        outputs: [],
        rejected: true,
        generatedAt: new Date().toISOString(),
      },
      providers: [mockProvider("HOLD"), mockProvider("HOLD")],
    });
    const explained = explainCandidateNotTraded("AVNTTRY");
    expect(explained.records.some((row) => row.stage === "consensus")).toBe(true);
  });

  it("transitions paper session states deterministically", () => {
    let snapshot = createPaperSessionSnapshot({ sessionId: "state-1" });
    snapshot = transitionPaperSession(snapshot, "ROUND_INITIALIZING", { currentRound: 1 });
    snapshot = transitionPaperSession(snapshot, "RUNNING_ROUND");
    expect(snapshot.status).toBe("RUNNING_ROUND");
    expect(snapshot.currentRound).toBe(1);
  });
});
