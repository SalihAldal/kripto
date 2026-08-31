import { afterEach, describe, expect, it } from "vitest";
import { resetCanonicalCandidateStoreForTests, getCanonicalCandidateStore } from "@/src/server/candidate/candidate-store.service";
import { clearForensicSession, setForensicSession } from "@/src/server/forensics/forensic-context";
import { getCanonicalEventLog, resetCanonicalEventLog } from "@/src/server/forensics/canonical-event.service";
import { buildEdgeAccountingReport } from "@/src/server/forensics/edge-accounting-calculator.service";

const RUN_ID = "known-good-run";
const CANDIDATE_ID = "AAAUSDT:known-good";

describe("known-good funnel viability", () => {
  afterEach(() => {
    clearForensicSession();
    resetCanonicalCandidateStoreForTests();
    resetCanonicalEventLog();
  });

  it("drives canonical candidate lifecycle to paper open/close", () => {
    setForensicSession({
      sessionId: "known-good-session",
      runId: RUN_ID,
      mode: "paper",
      startedAt: new Date().toISOString(),
      terminals: [],
      scannerCycles: [],
      candidates: [],
      aiCalls: [],
      consensus: [],
      evAudits: [],
      decisions: [],
      riskSizing: [],
      orders: [],
      pnlEntries: [],
      rejectionCountsByStage: {},
      rejectionCountsByReason: {},
    });
    const store = getCanonicalCandidateStore();
    store.createCandidate({
      candidateId: CANDIDATE_ID,
      symbol: "AAAUSDT",
      lane: "STEADY",
      detectedAt: Date.now(),
      detectedPrice: 100,
      opportunityScore: 92,
      reasonCodes: ["KNOWN_GOOD_FIXTURE"],
    });
    store.transitionCandidate(CANDIDATE_ID, "WATCHING");
    store.transitionCandidate(CANDIDATE_ID, "HOT");
    store.transitionCandidate(CANDIDATE_ID, "MICRO_ANALYZED");
    store.transitionCandidate(CANDIDATE_ID, "MICRO_CONFIRMED");
    store.transitionCandidate(CANDIDATE_ID, "FINAL_RANKED");
    store.transitionCandidate(CANDIDATE_ID, "EXECUTION_READY");
    store.transitionCandidate(CANDIDATE_ID, "RISK_PENDING");
    store.transitionCandidate(CANDIDATE_ID, "RISK_ALLOWED");
    store.transitionCandidate(CANDIDATE_ID, "PAPER_ATTEMPT");
    store.transitionCandidate(CANDIDATE_ID, "PAPER_OPENED");
    store.transitionCandidate(CANDIDATE_ID, "PAPER_CLOSED");

    const telemetry = store.getTelemetry();
    expect(telemetry.pipelineInvariantViolations).toBe(0);
    expect(telemetry.transitionByState.HOT ?? 0).toBeGreaterThanOrEqual(1);
    expect(telemetry.transitionByState.MICRO_CONFIRMED ?? 0).toBeGreaterThanOrEqual(1);
    expect(telemetry.transitionByState.FINAL_RANKED ?? 0).toBeGreaterThanOrEqual(1);
    expect(telemetry.transitionByState.EXECUTION_READY ?? 0).toBeGreaterThanOrEqual(1);
    expect(telemetry.transitionByState.RISK_ALLOWED ?? 0).toBeGreaterThanOrEqual(1);
    expect(telemetry.transitionByState.PAPER_OPENED ?? 0).toBeGreaterThanOrEqual(1);
    expect(telemetry.transitionByState.PAPER_CLOSED ?? 0).toBeGreaterThanOrEqual(1);

    const events = getCanonicalEventLog(RUN_ID);
    expect(events.every((row) => row.candidateId === CANDIDATE_ID)).toBe(true);

    const tracked = [
      {
        snapshot: {
          candidateId: CANDIDATE_ID,
          symbol: "AAAUSDT",
          primaryLane: "STEADY",
          firstDetectedAt: Date.now() - 65 * 60_000,
          firstDetectionPrice: 100,
          opportunityScore: 92,
          microScore: 84,
          finalScore: 93,
          initialRank: 1,
        },
        latestRank: 1,
        outcomes: [
          {
            horizonMin: 60,
            mfePct: 6.4,
            maePct: -1.2,
            returnPct: 3.1,
            timeToMfeMs: 22 * 60_000,
            complete: true,
            quality: "OK",
            status: "COMPLETE",
            invalidReason: null,
          },
        ],
      },
    ];

    const report = buildEdgeAccountingReport({
      tracked: tracked as unknown as Record<string, unknown>[],
      canonicalEvents: events as unknown as Record<string, unknown>[],
      orders: [
        { candidateId: CANDIDATE_ID, side: "BUY", entryPrice: 100 },
        { candidateId: CANDIDATE_ID, side: "SELL", entryPrice: 102.4 },
      ] as unknown as Record<string, unknown>[],
      pnlEntries: [],
    });
    expect(report.profitableTradeConversion.mfe2?.paperTraded).toBe(1);
    expect(report.profitableTradeConversion.mfe2?.conversionPercent).toBe(100);
  });
});
