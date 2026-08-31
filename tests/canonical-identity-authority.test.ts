import { describe, expect, it, beforeEach } from "vitest";
import {
  getCanonicalCandidateStore,
  resetCanonicalCandidateStoreForTests,
} from "@/src/server/candidate/candidate-store.service";
import { evaluateAiExecutionReadiness, resolveAiExecutionGatePolicy } from "@/src/server/execution/ai-execution-gate.service";
import {
  getCanonicalAuthorityCounters,
  resetCanonicalAuthorityCountersForTests,
  recordTdiEvaluation,
  recordLearningEvaluation,
} from "@/src/server/execution/authority-counters.service";
import { evaluateCanonicalRiskDecision } from "@/src/server/risk/canonical-risk-decision.service";
import { tdiShadow } from "@/src/server/microstructure/final-ranker";
import { PaperRuntimeEngine } from "@/src/server/paper-runtime/paper-engine";

describe("canonical identity + authority", () => {
  beforeEach(() => {
    resetCanonicalCandidateStoreForTests();
    resetCanonicalAuthorityCountersForTests();
  });

  it("candidate identity deterministic handoff chain preserves same id", () => {
    const store = getCanonicalCandidateStore();
    const id = "cand-A";
    store.createCandidate({
      candidateId: id,
      symbol: "BTCUSDT",
      lane: "EARLY",
      detectedAt: Date.now(),
      detectedPrice: 100,
    });
    store.transitionCandidate(id, "HOT");
    store.transitionCandidate(id, "MICRO_WARMING");
    store.transitionCandidate(id, "MICRO_ANALYZED");
    store.transitionCandidate(id, "MICRO_CONFIRMED");
    store.transitionCandidate(id, "FINAL_RANKED");
    store.transitionCandidate(id, "EXECUTION_READY");
    store.transitionCandidate(id, "RISK_PENDING");
    store.transitionCandidate(id, "RISK_ALLOWED");
    store.transitionCandidate(id, "PAPER_ATTEMPT");
    store.transitionCandidate(id, "PAPER_OPENED");
    expect(store.getCandidate(id)?.candidateId).toBe(id);
    expect(store.getCandidate(id)?.state).toBe("PAPER_OPENED");
  });

  it("illegal transition is blocked with machine-readable error", () => {
    const store = getCanonicalCandidateStore();
    const id = "cand-illegal";
    store.createCandidate({
      candidateId: id,
      symbol: "ETHUSDT",
      lane: "STEADY",
      detectedAt: Date.now(),
      detectedPrice: 10,
    });
    const illegal = store.transitionCandidate(id, "PAPER_OPENED");
    expect(illegal).toBeNull();
    expect(store.getTelemetry().handoffErrorCounts.HANDOFF_ILLEGAL_TRANSITION).toBeGreaterThanOrEqual(1);
  });

  it("missing candidateId cannot transition and emits HANDOFF_IDENTITY_MISSING", () => {
    const store = getCanonicalCandidateStore();
    const moved = store.transitionCandidate("", "RISK_PENDING");
    expect(moved).toBeNull();
    expect(store.getTelemetry().handoffErrorCounts.HANDOFF_IDENTITY_MISSING).toBeGreaterThanOrEqual(1);
  });

  it("unknown candidate transition emits HANDOFF_CANDIDATE_NOT_FOUND", () => {
    const store = getCanonicalCandidateStore();
    const moved = store.transitionCandidate("cand-missing", "RISK_PENDING");
    expect(moved).toBeNull();
    expect(store.getTelemetry().handoffErrorCounts.HANDOFF_CANDIDATE_NOT_FOUND).toBeGreaterThanOrEqual(1);
  });

  it("same symbol two candidates remain isolated (no symbol fallback)", () => {
    const store = getCanonicalCandidateStore();
    for (const id of ["cand-early", "cand-cont"]) {
      store.createCandidate({
        candidateId: id,
        symbol: "SOLUSDT",
        lane: id === "cand-early" ? "EARLY" : "CONTINUATION",
        detectedAt: Date.now(),
        detectedPrice: 20,
      });
    }
    store.transitionCandidate("cand-early", "HOT");
    store.transitionCandidate("cand-early", "MICRO_WARMING");
    store.transitionCandidate("cand-early", "MICRO_ANALYZED");
    store.transitionCandidate("cand-early", "MICRO_CONFIRMED");
    store.transitionCandidate("cand-early", "FINAL_RANKED");
    store.transitionCandidate("cand-early", "EXECUTION_READY");

    store.transitionCandidate("cand-cont", "HOT");
    store.transitionCandidate("cand-cont", "MICRO_WARMING");
    store.transitionCandidate("cand-cont", "MICRO_ANALYZED");
    store.transitionCandidate("cand-cont", "MICRO_REJECTED");

    expect(store.getCandidate("cand-early")?.state).toBe("EXECUTION_READY");
    expect(store.getCandidate("cand-cont")?.state).toBe("MICRO_REJECTED");
  });

  it("duplicate execution intent for same candidate is rejected", () => {
    const store = getCanonicalCandidateStore();
    const id = "cand-dup";
    store.createCandidate({
      candidateId: id,
      symbol: "XRPUSDT",
      lane: "MOMENTUM",
      detectedAt: Date.now(),
      detectedPrice: 1,
    });
    const first = store.registerExecutionIntent({
      candidateId: id,
      executionIntentId: "exec-1",
      strategyContext: "EARLY:BUY",
    });
    const second = store.registerExecutionIntent({
      candidateId: id,
      executionIntentId: "exec-2",
      strategyContext: "EARLY:BUY",
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(store.getTelemetry().handoffErrorCounts.HANDOFF_DUPLICATE_EXECUTION).toBeGreaterThanOrEqual(1);
  });

  it("AI timeout/no-opinion remains advisory and hard veto count stays zero", () => {
    const policy = resolveAiExecutionGatePolicy({ mode: "live", learningLane: false });
    expect(policy).toBe("ADVISORY");
    const result = evaluateAiExecutionReadiness({
      ai: null,
      policy,
      learningLane: false,
      microTradeEligible: true,
    });
    expect(result.verdict).toBe("AI_ADVISORY_ONLY");
    expect(getCanonicalAuthorityCounters().aiHardVetoCount).toBe(0);
  });

  it("TDI stays shadow/advisory and cannot hard reject", () => {
    const tdi = tdiShadow("REJECT", 72);
    recordTdiEvaluation({ decision: tdi.decision });
    const counters = getCanonicalAuthorityCounters();
    expect(tdi.canReject).toBe(false);
    expect(counters.tdiHardVetoCount).toBe(0);
  });

  it("Learning advisory reject increments advisory counter only", () => {
    recordLearningEvaluation({ advisoryRejected: true, hardVeto: false });
    const counters = getCanonicalAuthorityCounters();
    expect(counters.learningAdvisoryRejectCount).toBe(1);
    expect(counters.learningHardVetoCount).toBe(0);
  });

  it("Risk authority rejects stale data deterministically", async () => {
    const risk = await evaluateCanonicalRiskDecision({
      candidateId: "cand-risk",
      userId: "u1",
      symbol: "BTCUSDT",
      confidencePercent: 90,
      spreadPercent: 0.01,
      liquidity24h: 1_000_000,
      expectedProfitPercent: 1,
      slippagePercent: 0.01,
      volatilityPercent: 1,
      riskPerTradePercent: 0.5,
      staleDataMaxAgeMs: 1000,
      dataAgeMs: 30_000,
    });
    expect(risk.verdict).toBe("REJECT");
    expect(risk.reasonCodes).toContain("RISK_STALE_DATA");
  });

  it("Paper runtime requires candidate + execution intent identities", () => {
    const engine = new PaperRuntimeEngine();
    const result = engine.submit(
      {
        intentId: "i1",
        executionIntentId: "",
        candidateId: "",
        symbol: "AAAUSDT",
        side: "BUY",
        orderType: "MARKET",
        quantity: 1,
        signalPrice: 100,
        signalAt: Date.now(),
        lane: "EARLY",
        score: 80,
        stopPct: 1,
        takeProfitPct: 2,
      },
      {
        symbol: "AAAUSDT",
        last: 100,
        bids: [{ price: 99.9, quantity: 100 }],
        asks: [{ price: 100.1, quantity: 100 }],
        eventTime: Date.now(),
      },
      Date.now(),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("HANDOFF_IDENTITY_MISSING");
  });
});
