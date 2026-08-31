import { describe, expect, it, beforeEach } from "vitest";
import {
  getCanonicalCandidateStore,
  resetCanonicalCandidateStoreForTests,
} from "@/src/server/candidate/candidate-store.service";

function candidateId(seed: string) {
  return `cand-${seed}`;
}

describe("candidate handoff invariants", () => {
  beforeEach(() => {
    resetCanonicalCandidateStoreForTests();
  });

  it("DISCOVERED candidate store'a yazilir", () => {
    const store = getCanonicalCandidateStore();
    store.createCandidate({
      candidateId: candidateId("discovered"),
      symbol: "BTCUSDT",
      lane: "STEADY",
      detectedAt: Date.now(),
      detectedPrice: 100,
    });
    expect(store.getCandidate(candidateId("discovered"))?.state).toBe("DISCOVERED");
  });

  it("MICRO_CONFIRMED -> FINAL_RANKED -> EXECUTION_READY zinciri korunur", () => {
    const store = getCanonicalCandidateStore();
    const id = candidateId("handoff");
    store.createCandidate({
      candidateId: id,
      symbol: "ETHUSDT",
      lane: "EARLY",
      detectedAt: Date.now(),
      detectedPrice: 50,
    });
    store.transitionCandidate(id, "HOT");
    store.transitionCandidate(id, "MICRO_ANALYZED");
    store.transitionCandidate(id, "MICRO_CONFIRMED");
    store.transitionCandidate(id, "FINAL_RANKED");
    store.transitionCandidate(id, "EXECUTION_READY");
    expect(store.getExecutionReadyCandidates().map((r) => r.candidateId)).toContain(id);
  });

  it("EXECUTION_READY -> RISK_ALLOWED -> PAPER_OPENED -> PAPER_CLOSED same candidateId", () => {
    const store = getCanonicalCandidateStore();
    const id = candidateId("replay");
    store.createCandidate({
      candidateId: id,
      symbol: "XRPUSDT",
      lane: "MOMENTUM",
      detectedAt: Date.now(),
      detectedPrice: 1,
    });
    store.transitionCandidate(id, "EXECUTION_READY");
    store.transitionCandidate(id, "RISK_ALLOWED");
    store.transitionCandidate(id, "PAPER_OPENED");
    store.transitionCandidate(id, "PAPER_CLOSED");
    expect(store.getCandidate(id)?.state).toBe("PAPER_CLOSED");
    const recent = store.getTelemetry().recentTransitions.filter((row) => row.candidateId === id);
    expect(new Set(recent.map((row) => row.candidateId)).size).toBe(1);
  });

  it("EXECUTION_READY always gets explicit risk stage before paper attempt", () => {
    const store = getCanonicalCandidateStore();
    const id = candidateId("risk-hop");
    store.createCandidate({
      candidateId: id,
      symbol: "ADAUSDT",
      lane: "STEADY",
      detectedAt: Date.now(),
      detectedPrice: 1,
    });
    store.transitionCandidate(id, "EXECUTION_READY");
    store.transitionCandidate(id, "RISK_PENDING_WITH_REASON", ["RISK_EVALUATION_STARTED"]);
    store.transitionCandidate(id, "RISK_ALLOWED", ["RISK_GATE_ALLOW"]);
    store.transitionCandidate(id, "PAPER_ATTEMPT", ["PAPER_ORDER_SUBMIT_ATTEMPT"]);
    store.transitionCandidate(id, "PAPER_OPENED", ["PAPER_POSITION_OPENED"]);
    const transitions = store
      .getTelemetry()
      .recentTransitions.filter((row) => row.candidateId === id)
      .map((row) => row.state);
    expect(transitions).toContain("RISK_PENDING_WITH_REASON");
    expect(transitions).toContain("PAPER_ATTEMPT");
    expect(transitions[transitions.length - 1]).toBe("PAPER_OPENED");
  });

  it("risk reject does not require paper attempt", () => {
    const store = getCanonicalCandidateStore();
    const id = candidateId("risk-reject");
    store.createCandidate({
      candidateId: id,
      symbol: "DOTUSDT",
      lane: "EARLY",
      detectedAt: Date.now(),
      detectedPrice: 5,
    });
    store.transitionCandidate(id, "EXECUTION_READY");
    store.transitionCandidate(id, "RISK_PENDING_WITH_REASON", ["RISK_EVALUATION_STARTED"]);
    store.transitionCandidate(id, "RISK_REJECTED", ["RISK_SPREAD_TOO_HIGH"]);
    const transitions = store
      .getTelemetry()
      .recentTransitions.filter((row) => row.candidateId === id)
      .map((row) => row.state);
    expect(transitions).toContain("RISK_REJECTED");
    expect(transitions).not.toContain("PAPER_ATTEMPT");
  });

  it("candidate state round boundary boyunca korunur", () => {
    const store = getCanonicalCandidateStore();
    const id = candidateId("boundary");
    store.createCandidate({
      candidateId: id,
      symbol: "SOLUSDT",
      lane: "STEADY",
      detectedAt: Date.now(),
      detectedPrice: 20,
      ttlMs: 120_000,
    });
    store.transitionCandidate(id, "HOT");
    // round boundary simulasyonu (state reset yok)
    store.expireCandidate(Date.now() + 10_000);
    expect(store.getCandidate(id)?.state).toBe("HOT");
  });
});
