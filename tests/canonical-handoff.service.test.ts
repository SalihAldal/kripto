import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachCanonicalHandoff,
  buildCanonicalAdvisoryAiShell,
  buildCanonicalHandoffMetadata,
  hydrateCanonicalHandoffCandidate,
  parseCanonicalHandoff,
  validateCanonicalHandoffRecord,
} from "@/src/server/execution/canonical-handoff.service";
import {
  getCanonicalCandidateStore,
  resetCanonicalCandidateStoreForTests,
} from "@/src/server/candidate/candidate-store.service";
import type { ScannerCandidate } from "@/src/types/scanner";

vi.mock("@/src/server/ai/analysis-orchestrator", () => ({
  runAIConsensusFromInput: vi.fn(),
}));
vi.mock("@/src/server/scanner/ai-request-formatter", () => ({
  formatAIRequest: vi.fn(async () => ({ symbol: "BTCTRY" })),
}));
vi.mock("@/src/server/config/strategy-runtime.service", () => ({
  getRuntimeStrategyParams: vi.fn(async () => ({})),
}));

const baseCandidate = (): ScannerCandidate => ({
  rank: 1,
  context: {
    symbol: "BTCTRY",
    lastPrice: 100,
    change24h: 1,
    volume24h: 1_000_000,
    volumeSpikePercent: 0.1,
    spreadPercent: 0.02,
    volatilityPercent: 0.3,
    momentumPercent: 0.4,
    orderBookImbalance: 0.1,
    buyPressure: 0.2,
    shortCandleSignal: 0.5,
    fakeSpikeScore: 0.1,
    pumpIntensity: 0.1,
    pumpRisk: 0.1,
    tradable: true,
    rejectReasons: [],
    metadata: { opportunityCandidateId: "cand-handoff-1" },
  },
  score: {
    symbol: "BTCTRY",
    score: 80,
    confidence: 75,
    status: "QUALIFIED",
    reasons: [],
    metrics: {
      momentum: 1,
      microMomentum: 1,
      volume: 1,
      spread: 1,
      volatility: 1,
      orderBook: 1,
      pressure: 1,
      microFlow: 1,
      velocity: 1,
      candle: 1,
      fakeSpikePenalty: 0,
      liquidityPenalty: 0,
      pumpBoost: 0,
      pumpRiskPenalty: 0,
    },
  },
});

describe("canonical handoff contract", () => {
  beforeEach(() => {
    resetCanonicalCandidateStoreForTests();
    vi.clearAllMocks();
  });

  it("toScannerCandidates-style candidate has no ai until hydration", () => {
    const candidate = baseCandidate();
    expect(candidate.ai).toBeUndefined();
    expect(parseCanonicalHandoff(candidate)).toBeNull();
  });

  it("rejects stale canonical record", () => {
    const store = getCanonicalCandidateStore();
    store.createCandidate({
      candidateId: "cand-handoff-1",
      symbol: "BTCTRY",
      lane: "STEADY",
      detectedAt: Date.now() - 120_000,
      detectedPrice: 100,
    });
    const record = store.getCandidate("cand-handoff-1")!;
    const handoff = buildCanonicalHandoffMetadata({
      candidateId: "cand-handoff-1",
      symbol: "BTCTRY",
      record: { ...record, lastUpdatedAt: Date.now() - 120_000, expiresAt: Date.now() + 60_000, state: "EXECUTION_READY" },
    });
    const validation = validateCanonicalHandoffRecord(handoff);
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.reasonCode).toMatch(/HANDOFF_CANDIDATE_(STALE|NOT_READY)/);
  });

  it("hydrates real AI consensus at boundary when provider returns BUY", async () => {
    const { runAIConsensusFromInput } = await import("@/src/server/ai/analysis-orchestrator");
    vi.mocked(runAIConsensusFromInput).mockResolvedValue({
      finalDecision: "BUY",
      finalConfidence: 72,
      finalRiskScore: 30,
      score: 72,
      explanation: "fixture consensus",
      outputs: [{ ok: true, output: { decision: "BUY" }, providerId: "p1", model: "m", remoteOk: true }],
      rejected: false,
      generatedAt: new Date().toISOString(),
    });
    const store = getCanonicalCandidateStore();
    store.createCandidate({
      candidateId: "cand-handoff-1",
      symbol: "BTCTRY",
      lane: "STEADY",
      detectedAt: Date.now(),
      detectedPrice: 100,
    });
    store.transitionCandidate("cand-handoff-1", "EXECUTION_READY");
    const record = store.getCandidate("cand-handoff-1")!;
    const handoff = buildCanonicalHandoffMetadata({
      candidateId: "cand-handoff-1",
      symbol: "BTCTRY",
      record: { ...record, state: "EXECUTION_READY", lastUpdatedAt: Date.now(), expiresAt: Date.now() + 120_000 },
    });
    const hydrated = await hydrateCanonicalHandoffCandidate({
      candidate: baseCandidate(),
      handoff,
      allowAdvisoryShell: true,
    });
    expect(hydrated.aiSource).toBe("hydrated_consensus");
    expect(hydrated.candidate.ai?.finalDecision).toBe("BUY");
    const attached = attachCanonicalHandoff(hydrated.candidate, hydrated.handoff);
    expect(parseCanonicalHandoff(attached)?.candidateId).toBe("cand-handoff-1");
  });

  it("advisory shell is not BUY when hydration fails", async () => {
    const { runAIConsensusFromInput } = await import("@/src/server/ai/analysis-orchestrator");
    vi.mocked(runAIConsensusFromInput).mockRejectedValue(new Error("provider timeout"));
    const store = getCanonicalCandidateStore();
    store.createCandidate({
      candidateId: "cand-handoff-1",
      symbol: "BTCTRY",
      lane: "STEADY",
      detectedAt: Date.now(),
      detectedPrice: 100,
    });
    const record = store.getCandidate("cand-handoff-1")!;
    const handoff = buildCanonicalHandoffMetadata({
      candidateId: "cand-handoff-1",
      symbol: "BTCTRY",
      record: { ...record, state: "EXECUTION_READY", lastUpdatedAt: Date.now(), expiresAt: Date.now() + 120_000 },
    });
    const hydrated = await hydrateCanonicalHandoffCandidate({
      candidate: baseCandidate(),
      handoff,
      allowAdvisoryShell: true,
    });
    expect(hydrated.aiSource).toBe("advisory_shell");
    expect(hydrated.candidate.ai?.finalDecision).toBe("NO_TRADE");
    expect(hydrated.candidate.ai?.finalDecision).not.toBe("BUY");
  });

  it("advisory shell builder never emits BUY", () => {
    const shell = buildCanonicalAdvisoryAiShell({
      symbol: "BTCTRY",
      lastPrice: 100,
      scannerConfidence: 75,
      reasonCode: "AI_HYDRATION_FAILED",
      reasonDetail: "timeout",
    });
    expect(shell.finalDecision).not.toBe("BUY");
    expect(shell.finalDecision).toBe("NO_TRADE");
  });
});
