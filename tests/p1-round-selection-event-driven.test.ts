import { describe, expect, it, vi, beforeEach } from "vitest";
import { getCanonicalCandidateStore, resetCanonicalCandidateStoreForTests } from "@/src/server/candidate/candidate-store.service";

vi.mock("@/lib/config", () => ({
  env: {
    AUTO_ROUND_SELECTION_MIN_EVIDENCE_WINDOW_MS: 100,
    AUTO_ROUND_SELECTION_FALLBACK_POLL_INTERVAL_MS: 100,
    AUTO_ROUND_SELECTION_EVENT_DEBOUNCE_MS: 20,
    AUTO_ROUND_SELECTION_DEADLINE_MS: 5000,
    AUTO_ROUND_SCANNER_MAX_CYCLE_SEC: 95,
  },
}));

vi.mock("@/src/server/execution/round-runtime.service", () => ({
  registerRoundCancellation: vi.fn(),
  clearRoundCancellation: vi.fn(),
  cancelRoundSelection: vi.fn(),
  getRoundCancellationSignal: vi.fn(() => ({ aborted: false })),
  startSelectionBudgetEnforcer: vi.fn(() => () => undefined),
  RoundRuntimeController: class {
    private readonly snapshot: Record<string, unknown> = { step: "SCANNING", heartbeatAt: Date.now() };
    async ensureJobActive() {}
    async heartbeat(message?: string) {
      this.snapshot.heartbeatAt = Date.now();
      this.snapshot.message = message;
    }
    checkBudget() {}
    noteProgress(message?: string, patch?: Record<string, unknown>) {
      this.snapshot.message = message ?? this.snapshot.message;
      Object.assign(this.snapshot, patch ?? {});
    }
    noteActivity(message?: string, patch?: Record<string, unknown>) {
      this.noteProgress(message, patch);
    }
    getSnapshot() {
      return this.snapshot;
    }
    async transition(step: string, message: string, patch?: Record<string, unknown>) {
      this.snapshot.step = step;
      this.snapshot.message = message;
      Object.assign(this.snapshot, patch ?? {});
    }
    async failTimeout() {}
    getLastProgressAt() {
      return Date.now();
    }
  },
}));

vi.mock("@/src/server/execution/cooperative-async.service", () => ({
  createAsyncTelemetry: vi.fn(() => ({})),
  startRoundSelectionWatchdog: vi.fn(() => ({ stop: () => undefined })),
  summarizeAsyncTelemetry: vi.fn(() => ({})),
}));
vi.mock("@/src/server/repositories/auto-round.repository", () => ({
  getAutoRoundJobById: vi.fn(async () => ({ stopRequested: false })),
}));
vi.mock("@/src/server/forensics/round-progress-watchdog.service", () => ({
  ensureRoundHangSnapshotForAbnormalTerminal: vi.fn(),
}));
vi.mock("@/src/server/scanner/legacy-scanner-telemetry.service", () => ({
  getLegacyScannerTelemetry: vi.fn(() => ({ runScopedInvocation: 0, runScopedPersistence: 0 })),
}));
vi.mock("@/src/server/forensics/ai-runtime.service", () => ({
  terminalizeOpenAiCandidates: vi.fn(),
}));
vi.mock("@/src/server/forensics/candidate-lifecycle.service", () => ({
  traceCandidateReject: vi.fn(),
  traceCandidateWait: vi.fn(),
}));
vi.mock("@/src/server/market-data/spine/market-data-daemon", () => ({
  getMarketDataDaemon: vi.fn(() => ({ getMarketSnapshot: () => [] })),
}));
vi.mock("@/src/server/shadow-outcome/shadow-outcome-engine", () => ({
  observeCanonicalShadowTick: vi.fn(),
}));
vi.mock("@/src/server/shadow-outcome/persist", () => ({
  persistShadowOutcomes: vi.fn(),
}));
vi.mock("@/src/server/execution/authority-counters.service", () => ({
  setLegacyScannerCounters: vi.fn(),
}));

const scannerCandidate = {
  rank: 1,
  context: {
    symbol: "BTCTRY",
    lastPrice: 100,
    change24h: 1,
    volume24h: 1000000,
    volumeSpikePercent: 0.2,
    spreadPercent: 0.03,
    volatilityPercent: 0.2,
    momentumPercent: 0.3,
    orderBookImbalance: 0.1,
    buyPressure: 0.2,
    shortCandleSignal: 0.1,
    fakeSpikeScore: 0.1,
    pumpIntensity: 0.1,
    pumpRisk: 0.1,
    tradable: true,
    rejectReasons: [],
    metadata: {
      opportunityCandidateId: "cand-evt-1",
    },
  },
  score: {
    symbol: "BTCTRY",
    score: 80,
    confidence: 80,
    status: "QUALIFIED" as const,
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
};

const opportunityScanMock = vi.fn(() => ({ ranked: [], evaluated: 1 }));
vi.mock("@/src/server/opportunity/opportunity-engine", () => ({
  getOpportunityEngine: vi.fn(() => ({
    scan: opportunityScanMock,
  })),
}));
vi.mock("@/src/server/microstructure/microstructure-engine", () => ({
  getMicrostructureEngine: vi.fn(() => ({
    evaluate: () => ({ ranked: [] }),
    toScannerCandidates: () => [scannerCandidate],
  })),
}));
vi.mock("@/src/server/candidate/instance-ownership.service", () => ({
  getCanonicalInstanceOwnership: vi.fn(() => ({ ownerId: "test-owner" })),
}));

describe("P1 event-driven round selection", () => {
  beforeEach(() => {
    resetCanonicalCandidateStoreForTests();
    opportunityScanMock.mockReset();
    opportunityScanMock.mockImplementation(() => ({ ranked: [], evaluated: 1 }));
  });

  it("selects eligible candidate without fixed 90s wait", async () => {
    const store = getCanonicalCandidateStore();
    store.createCandidate({
      candidateId: "cand-evt-1",
      symbol: "BTCTRY",
      lane: "EARLY",
      detectedAt: Date.now(),
      detectedPrice: 100,
    });
    const { runCooperativeRoundSelection } = await import("@/src/server/execution/round-selection.service");
    const start = Date.now();
    const runPromise = runCooperativeRoundSelection({
      jobId: "job-1",
      runId: "run-1",
      roundNo: 1,
      totalRounds: 1,
      attempt: 0,
      maxAttempts: 2,
      selectionStartedAt: Date.now(),
      selectionBudgetMs: 10_000,
      excludedSymbols: [],
      forcePaperProfile: true,
      maxDurationSec: 30,
      scanLimit: 30,
      scanCycles: 1,
      includeLivePumpScan: false,
    });
    setTimeout(() => {
      store.transitionCandidate("cand-evt-1", "WATCHING", ["watch"]);
      store.transitionCandidate("cand-evt-1", "HOT", ["hot"]);
      store.transitionCandidate("cand-evt-1", "MICRO_WARMING", ["warm"]);
      store.transitionCandidate("cand-evt-1", "MICRO_ANALYZED", ["analyzed"]);
      store.transitionCandidate("cand-evt-1", "MICRO_CONFIRMED", ["confirmed"]);
      store.transitionCandidate("cand-evt-1", "FINAL_RANKED", ["ranked"]);
      store.transitionCandidate("cand-evt-1", "EXECUTION_READY", ["ready"]);
    }, 500);
    const result = await runPromise;
    const elapsed = Date.now() - start;
    expect(result.selected?.context.symbol).toBe("BTCTRY");
    expect(result.reason).toContain("CANDIDATE_STORE_EXECUTION_READY");
    expect(elapsed).toBeLessThan(5000);
  });

  it("keeps single winner under duplicate ready transitions", async () => {
    const store = getCanonicalCandidateStore();
    store.createCandidate({
      candidateId: "cand-evt-1",
      symbol: "BTCTRY",
      lane: "EARLY",
      detectedAt: Date.now(),
      detectedPrice: 100,
    });
    const { runCooperativeRoundSelection } = await import("@/src/server/execution/round-selection.service");
    const runPromise = runCooperativeRoundSelection({
      jobId: "job-2",
      runId: "run-2",
      roundNo: 1,
      totalRounds: 1,
      attempt: 0,
      maxAttempts: 2,
      selectionStartedAt: Date.now(),
      selectionBudgetMs: 10_000,
      excludedSymbols: [],
      forcePaperProfile: true,
      maxDurationSec: 30,
      scanLimit: 30,
      scanCycles: 1,
      includeLivePumpScan: false,
    });
    setTimeout(() => {
      store.transitionCandidate("cand-evt-1", "WATCHING", ["watch"]);
      store.transitionCandidate("cand-evt-1", "HOT", ["hot"]);
      store.transitionCandidate("cand-evt-1", "MICRO_WARMING", ["warm"]);
      store.transitionCandidate("cand-evt-1", "MICRO_ANALYZED", ["analyzed"]);
      store.transitionCandidate("cand-evt-1", "MICRO_CONFIRMED", ["confirmed"]);
      store.transitionCandidate("cand-evt-1", "FINAL_RANKED", ["ranked"]);
      store.transitionCandidate("cand-evt-1", "EXECUTION_READY", ["ready-a"]);
      store.transitionCandidate("cand-evt-1", "EXECUTION_READY", ["ready-b"]);
    }, 300);
    const result = await runPromise;
    expect(result.selected?.context.symbol).toBe("BTCTRY");
    expect(result.reason).toContain("cand-evt-1");
  });

  it("applies minimum evidence window to fallback path", async () => {
    const store = getCanonicalCandidateStore();
    store.createCandidate({
      candidateId: "cand-evt-1",
      symbol: "BTCTRY",
      lane: "EARLY",
      detectedAt: Date.now(),
      detectedPrice: 100,
    });
    store.transitionCandidate("cand-evt-1", "WATCHING", ["watch"]);
    store.transitionCandidate("cand-evt-1", "HOT", ["hot"]);
    store.transitionCandidate("cand-evt-1", "MICRO_WARMING", ["warm"]);
    store.transitionCandidate("cand-evt-1", "MICRO_ANALYZED", ["analyzed"]);
    store.transitionCandidate("cand-evt-1", "MICRO_CONFIRMED", ["confirmed"]);
    store.transitionCandidate("cand-evt-1", "FINAL_RANKED", ["ranked"]);
    store.transitionCandidate("cand-evt-1", "EXECUTION_READY", ["ready"]);
    const { runCooperativeRoundSelection } = await import("@/src/server/execution/round-selection.service");
    const startedAt = Date.now();
    const result = await runCooperativeRoundSelection({
      jobId: "job-min-window",
      runId: "run-min-window",
      roundNo: 1,
      totalRounds: 1,
      attempt: 0,
      maxAttempts: 2,
      selectionStartedAt: Date.now(),
      selectionBudgetMs: 10_000,
      excludedSymbols: [],
      forcePaperProfile: true,
      maxDurationSec: 30,
      scanLimit: 30,
      scanCycles: 1,
      includeLivePumpScan: false,
    });
    expect(result.selected?.context.symbol).toBe("BTCTRY");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(90);
  });

  it("converts async selection exceptions to explicit aborted result", async () => {
    opportunityScanMock.mockImplementation(() => {
      throw new Error("boom");
    });
    const { runCooperativeRoundSelection } = await import("@/src/server/execution/round-selection.service");
    const result = await runCooperativeRoundSelection({
      jobId: "job-exception",
      runId: "run-exception",
      roundNo: 1,
      totalRounds: 1,
      attempt: 0,
      maxAttempts: 2,
      selectionStartedAt: Date.now(),
      selectionBudgetMs: 10_000,
      excludedSymbols: [],
      forcePaperProfile: true,
      maxDurationSec: 30,
      scanLimit: 30,
      scanCycles: 1,
      includeLivePumpScan: false,
    });
    expect(result.aborted).toBe(true);
    expect(result.reason).toContain("SELECTION_EXCEPTION:boom");
  });
});
