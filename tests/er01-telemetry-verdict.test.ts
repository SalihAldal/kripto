import { describe, expect, it } from "vitest";
import { evaluateRecoveryAssessment, resolveTerminalEvidence, summarizeFunnel, type FunnelEvent } from "@/src/server/forensics/er01-telemetry-verdict";

function baseTerminal() {
  return {
    structured: null,
    legacyReason: null,
    runState: "tur_tamamlandi",
    hasCandidate: true,
    openedPosition: false,
    submittedOrder: false,
    fillCount: 0,
    executionFailed: false,
  } as const;
}

describe("ER01 terminal contract", () => {
  it("1 preserves structured ENTER", () => {
    const out = resolveTerminalEvidence({
      ...baseTerminal(),
      structured: { decision: "ENTER", reasonCode: null, secondaryReasonCodes: [], source: "CANONICAL" },
      openedPosition: true,
    });
    expect(out.decision).toBe("ENTER");
    expect(out.roundOutcome).toBe("OPENED");
  });

  it("2 WAIT:NO_ELIGIBLE_STRATEGY stays WAIT", () => {
    const out = resolveTerminalEvidence({ ...baseTerminal(), legacyReason: "WAIT:NO_ELIGIBLE_STRATEGY" });
    expect(out.decision).toBe("WAIT");
    expect(out.firstBlocker).toBe("NO_ELIGIBLE_STRATEGY");
  });

  it("3 WAIT:STRATEGY_CONFLICT stays WAIT", () => {
    const out = resolveTerminalEvidence({ ...baseTerminal(), legacyReason: "WAIT:STRATEGY_CONFLICT" });
    expect(out.decision).toBe("WAIT");
    expect(out.firstBlocker).toBe("STRATEGY_CONFLICT");
  });

  it("4 structured REJECT is not rewritten by text", () => {
    const out = resolveTerminalEvidence({
      ...baseTerminal(),
      structured: { decision: "REJECT", reasonCode: "RISK_REJECTED", secondaryReasonCodes: [], source: "CANONICAL" },
      legacyReason: "WAIT:STALE_DATA spread mentioned",
    });
    expect(out.decision).toBe("REJECT");
    expect(out.firstBlocker).toBe("RISK_REJECTED");
  });

  it("5 timeout stays operational timeout", () => {
    const out = resolveTerminalEvidence({ ...baseTerminal(), legacyReason: "SELECTION_TIMEOUT: scanner budget exceeded" });
    expect(out.decision).toBeNull();
    expect(out.roundOutcome).toBe("SELECTION_TIMEOUT");
  });

  it("6 missing legacy reason becomes missing evidence", () => {
    const out = resolveTerminalEvidence(baseTerminal());
    expect(out.evidenceStatus).toBe("MISSING");
    expect(out.firstBlocker).toBe("LEGACY_REASON_NOT_RECORDED");
  });

  it("7 structured vs legacy conflict is explicit", () => {
    const out = resolveTerminalEvidence({
      ...baseTerminal(),
      structured: { decision: "WAIT", reasonCode: "NO_ELIGIBLE_STRATEGY", source: "CANONICAL", secondaryReasonCodes: [] },
      legacyReason: "REJECT:RISK_REJECTED",
    });
    expect(out.evidenceStatus).toBe("CONFLICTING");
    expect(out.integrityConflicts.length).toBeGreaterThan(0);
  });

  it("8 no-candidate does not create candidate decision", () => {
    const out = resolveTerminalEvidence({ ...baseTerminal(), hasCandidate: false });
    expect(out.decision).toBeNull();
    expect(out.roundOutcome).toBe("NO_CANDIDATE_EXPECTED");
  });

  it("9 ENTER history remains when submit fails", () => {
    const out = resolveTerminalEvidence({
      ...baseTerminal(),
      structured: { decision: "ENTER", reasonCode: null, source: "CANONICAL", secondaryReasonCodes: [] },
      executionFailed: true,
      submittedOrder: true,
    });
    expect(out.decision).toBe("ENTER");
    expect(out.roundOutcome).toBe("EXECUTION_FAILURE");
  });

  it("10 risk reject is not engineering failure", () => {
    const out = resolveTerminalEvidence({
      ...baseTerminal(),
      legacyReason: "REJECT:RISK_REJECTED",
      runState: "tur_basarisiz",
    });
    expect(out.roundOutcome).toBe("REJECT_EXPECTED");
  });
});

describe("ER01 funnel aggregation", () => {
  const t = (n: number) => new Date(1_700_000_000_000 + n * 1000).toISOString();

  it("11 same candidate with multi events stays separated by kind", () => {
    const events: FunnelEvent[] = [
      { eventId: "r1", campaignId: "c1", kind: "ROUND", timestamp: t(1), roundId: "1" },
      { eventId: "c1", campaignId: "c1", kind: "CANDIDATE", timestamp: t(2), candidateId: "A" },
      { eventId: "d1", campaignId: "c1", kind: "CANONICAL_DECISION", timestamp: t(3), candidateId: "A", decision: "WAIT" },
      { eventId: "d2", campaignId: "c1", kind: "CANONICAL_DECISION", timestamp: t(4), candidateId: "A", decision: "ENTER" },
    ];
    const s = summarizeFunnel(events, "c1");
    expect(s.uniqueCandidateCount).toBe(1);
    expect(s.waitCount).toBe(1);
    expect(s.enterCount).toBe(1);
  });

  it("12 duplicate event counted once", () => {
    const events: FunnelEvent[] = [
      { eventId: "x", campaignId: "c1", kind: "ROUND", timestamp: t(1) },
      { eventId: "x", campaignId: "c1", kind: "ROUND", timestamp: t(1) },
    ];
    expect(summarizeFunnel(events, "c1").roundCount).toBe(1);
  });

  it("13 WAIT then ENTER ordering keeps both events", () => {
    const s = summarizeFunnel(
      [
        { eventId: "w", campaignId: "c1", kind: "CANONICAL_DECISION", timestamp: t(1), candidateId: "A", decision: "WAIT" },
        { eventId: "e", campaignId: "c1", kind: "CANONICAL_DECISION", timestamp: t(2), candidateId: "A", decision: "ENTER" },
      ],
      "c1",
    );
    expect(s.canonicalDecisionCount).toBe(2);
    expect(s.uniqueEnteredCandidateCount).toBe(1);
  });

  it("14 partial fills can exceed order count", () => {
    const s = summarizeFunnel(
      [
        { eventId: "o1", campaignId: "c1", kind: "ORDER", timestamp: t(1), orderId: "O1" },
        { eventId: "f1", campaignId: "c1", kind: "FILL", timestamp: t(2), orderId: "O1", fillId: "F1" },
        { eventId: "f2", campaignId: "c1", kind: "FILL", timestamp: t(3), orderId: "O1", fillId: "F2" },
      ],
      "c1",
    );
    expect(s.uniqueOrderCount).toBe(1);
    expect(s.fillEventCount).toBe(2);
  });

  it("15 data from different campaigns does not mix", () => {
    const s = summarizeFunnel(
      [
        { eventId: "a", campaignId: "c1", kind: "ROUND", timestamp: t(1) },
        { eventId: "b", campaignId: "c2", kind: "ROUND", timestamp: t(1) },
      ],
      "c1",
    );
    expect(s.roundCount).toBe(1);
  });

  it("16 missing candidate id is not auto fabricated", () => {
    const s = summarizeFunnel([{ eventId: "o", campaignId: "c1", kind: "ORDER", timestamp: t(1), orderId: "O1" }], "c1");
    expect(s.uniqueCandidateCount).toBe(0);
  });

  it("17 unbound order/fill are reported", () => {
    const s = summarizeFunnel(
      [
        { eventId: "o", campaignId: "c1", kind: "ORDER", timestamp: t(1), orderId: "O1" },
        { eventId: "f", campaignId: "c1", kind: "FILL", timestamp: t(2), orderId: "O1", fillId: "F1" },
      ],
      "c1",
    );
    expect(s.unknownUnboundCount).toBe(2);
  });

  it("18 missing market timestamp is not converted in funnel layer", () => {
    const s = summarizeFunnel([{ eventId: "r", campaignId: "c1", kind: "ROUND", timestamp: t(1) }], "c1");
    expect(s.roundCount).toBe(1);
  });
});

describe("ER01 verdict evaluator", () => {
  function baseCheck(status: "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED" | "STALE", checkId: string) {
    return {
      checkId,
      required: true,
      status,
      evidenceSource: "test",
      inspectedHead: "h1",
      inspectedWorktreeFingerprint: "h1:w1",
    } as const;
  }

  it("19 build fail yields phase fail and no-go", () => {
    const out = evaluateRecoveryAssessment([baseCheck("PASS", "typecheck"), baseCheck("FAIL", "build")]);
    expect(out.phase1Verdict).toBe("FAIL");
    expect(out.nextPaperPreflight).toBe("NO_GO");
  });

  it("20 required not-run yields no-go", () => {
    const out = evaluateRecoveryAssessment([baseCheck("PASS", "typecheck"), baseCheck("NOT_RUN", "tests")]);
    expect(out.phase1Verdict).toBe("PARTIAL");
    expect(out.nextPaperPreflight).toBe("NO_GO");
  });

  it("21 smoke not-run yields no-go", () => {
    const out = evaluateRecoveryAssessment([baseCheck("PASS", "build"), baseCheck("NOT_RUN", "smoke")]);
    expect(out.nextPaperPreflight).toBe("NO_GO");
  });

  it("22 unknown live submit cannot imply safety pass", () => {
    const out = evaluateRecoveryAssessment([baseCheck("PASS", "build"), baseCheck("BLOCKED", "live-submit-count")]);
    expect(out.phase1Verdict).toBe("PARTIAL");
  });

  it("23 unmeasured drift stays partial", () => {
    const out = evaluateRecoveryAssessment([baseCheck("PASS", "build"), baseCheck("NOT_RUN", "config-drift")]);
    expect(out.phase1Verdict).toBe("PARTIAL");
  });

  it("24 stale evidence keeps no-go", () => {
    const out = evaluateRecoveryAssessment([baseCheck("STALE", "head-mismatch")]);
    expect(out.phase1Verdict).toBe("PARTIAL");
  });

  it("25 previous pass artifact does not force pass", () => {
    const out = evaluateRecoveryAssessment([baseCheck("PASS", "old-artifact"), baseCheck("NOT_RUN", "current-tests")]);
    expect(out.phase1Verdict).toBe("PARTIAL");
  });

  it("26 markdown/json can share same assessment object", () => {
    const out = evaluateRecoveryAssessment([baseCheck("PASS", "db-read"), baseCheck("NOT_RUN", "smoke")]);
    const asJson = JSON.stringify(out);
    expect(asJson).toContain("\"nextPaperPreflight\":\"NO_GO\"");
  });

  it("27 zero counts alone do not imply go", () => {
    const out = evaluateRecoveryAssessment([baseCheck("PASS", "zero-candidate"), baseCheck("NOT_RUN", "required-suite")]);
    expect(out.nextPaperPreflight).toBe("NO_GO");
  });

  it("28 partial report set is not completed assessment", () => {
    const out = evaluateRecoveryAssessment([baseCheck("PASS", "typecheck"), baseCheck("BLOCKED", "build")]);
    expect(out.phase1Verdict).toBe("PARTIAL");
  });
});
