export type EvidenceStatus = "OBSERVED" | "MISSING" | "CONFLICTING" | "LEGACY";
export type CheckStatus = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED" | "STALE";
export type CandidateAdmissionDecision = "ENTER" | "WAIT" | "REJECT";
export type RoundOperationalOutcome =
  | "NO_CANDIDATE_EXPECTED"
  | "WAIT_EXPECTED"
  | "REJECT_EXPECTED"
  | "OPENED"
  | "EXECUTION_FAILURE"
  | "SELECTION_TIMEOUT"
  | "USER_CANCELLED"
  | "STOPPED_SAFETY"
  | "ENGINEERING_FAILURE"
  | "LEGACY_REASON_NOT_RECORDED"
  | "UNKNOWN_UNRESOLVED";
export type ExecutionOutcome = "NOT_SUBMITTED" | "SUBMITTED" | "PARTIAL_FILL" | "FILLED" | "FAILED" | "UNKNOWN";

export type StructuredTerminalInput = {
  decision?: CandidateAdmissionDecision | null;
  reasonCode?: string | null;
  secondaryReasonCodes?: string[] | null;
  source?: "CANONICAL" | "RUNTIME" | "LEGACY" | null;
};

export type TerminalEvidenceInput = {
  structured?: StructuredTerminalInput | null;
  legacyReason?: string | null;
  runState?: string | null;
  hasCandidate: boolean;
  openedPosition: boolean;
  submittedOrder: boolean;
  fillCount?: number | null;
  executionFailed?: boolean;
};

export type TerminalResolution = {
  decision: CandidateAdmissionDecision | null;
  firstBlocker: string | null;
  secondaryBlockers: string[];
  evidenceStatus: EvidenceStatus;
  roundOutcome: RoundOperationalOutcome;
  executionOutcome: ExecutionOutcome;
  integrityConflicts: string[];
  mappingSource: "STRUCTURED" | "LEGACY_PREFIX" | "UNRESOLVED";
};

const LEGACY_WAIT_PREFIX = ["WAIT:NO_ELIGIBLE_STRATEGY", "WAIT:STRATEGY_CONFLICT", "WAIT:INSUFFICIENT_DATA", "WAIT:STALE_DATA"] as const;
const LEGACY_REJECT_PREFIX = ["REJECT:", "RISK_", "SAFETY_", "FEE_", "SPREAD_", "SLIPPAGE_"] as const;
const LEGACY_TIMEOUT_PREFIX = ["SELECTION_TIMEOUT", "TIMEOUT", "ROUND_TIMEOUT"] as const;

function parseLegacyReason(reason: string | null | undefined) {
  const raw = String(reason ?? "").trim();
  const upper = raw.toUpperCase();
  if (!upper) return { decision: null, firstBlocker: "LEGACY_REASON_NOT_RECORDED", source: "UNRESOLVED" as const };
  if (LEGACY_TIMEOUT_PREFIX.some((x) => upper.startsWith(x) || upper.includes(x))) {
    return { decision: null, firstBlocker: "SELECTION_TIMEOUT", source: "LEGACY_PREFIX" as const };
  }
  const wait = LEGACY_WAIT_PREFIX.find((x) => upper.startsWith(x));
  if (wait) return { decision: "WAIT" as const, firstBlocker: wait.replace("WAIT:", ""), source: "LEGACY_PREFIX" as const };
  if (LEGACY_REJECT_PREFIX.some((x) => upper.startsWith(x))) {
    const [prefix, code] = upper.split(":");
    return { decision: "REJECT" as const, firstBlocker: (code ?? prefix ?? "REJECTED").trim(), source: "LEGACY_PREFIX" as const };
  }
  if (upper.includes("NO_CANDIDATE")) {
    return { decision: null, firstBlocker: "NO_CANDIDATE_EXPECTED", source: "LEGACY_PREFIX" as const };
  }
  if (upper.includes("ENTRY_CONTRACT_NOT_MET")) {
    return { decision: null, firstBlocker: "ENTRY_CONTRACT_NOT_MET", source: "LEGACY_PREFIX" as const };
  }
  return { decision: null, firstBlocker: "LEGACY_REASON_NOT_RECORDED", source: "UNRESOLVED" as const };
}

function resolveExecutionOutcome(input: TerminalEvidenceInput): ExecutionOutcome {
  const fills = Number(input.fillCount ?? 0);
  if (input.executionFailed) return "FAILED";
  if (fills > 1) return "PARTIAL_FILL";
  if (fills === 1) return "FILLED";
  if (input.submittedOrder) return "SUBMITTED";
  if (!input.submittedOrder && !input.openedPosition) return "NOT_SUBMITTED";
  return "UNKNOWN";
}

export function resolveTerminalEvidence(input: TerminalEvidenceInput): TerminalResolution {
  if (!input.hasCandidate) {
    return {
      decision: null,
      firstBlocker: "NO_CANDIDATE_EXPECTED",
      secondaryBlockers: [],
      evidenceStatus: "OBSERVED",
      roundOutcome: "NO_CANDIDATE_EXPECTED",
      executionOutcome: resolveExecutionOutcome(input),
      integrityConflicts: [],
      mappingSource: "STRUCTURED",
    };
  }

  const structured = input.structured ?? null;
  const legacy = parseLegacyReason(input.legacyReason);
  const conflicts: string[] = [];
  let decision: CandidateAdmissionDecision | null = structured?.decision ?? legacy.decision ?? null;
  let firstBlocker = (structured?.reasonCode ?? legacy.firstBlocker ?? null) as string | null;
  const secondary = [...(structured?.secondaryReasonCodes ?? [])].filter(Boolean);
  let mappingSource: TerminalResolution["mappingSource"] = structured?.decision ? "STRUCTURED" : legacy.source;
  let evidenceStatus: EvidenceStatus = structured?.decision ? "OBSERVED" : legacy.source === "LEGACY_PREFIX" ? "LEGACY" : "MISSING";

  if (structured?.decision && legacy.decision && structured.decision !== legacy.decision) {
    evidenceStatus = "CONFLICTING";
    conflicts.push(`DECISION_CONFLICT structured=${structured.decision} legacy=${legacy.decision}`);
  }
  if (structured?.reasonCode && legacy.firstBlocker && structured.reasonCode !== legacy.firstBlocker) {
    evidenceStatus = "CONFLICTING";
    conflicts.push(`REASON_CONFLICT structured=${structured.reasonCode} legacy=${legacy.firstBlocker}`);
  }

  if (firstBlocker === "SELECTION_TIMEOUT") {
    decision = null;
  }

  const executionOutcome = resolveExecutionOutcome(input);
  let roundOutcome: RoundOperationalOutcome;
  if (String(input.runState ?? "").toLowerCase() === "cancelled_user") {
    roundOutcome = "USER_CANCELLED";
  } else if (firstBlocker === "SELECTION_TIMEOUT") {
    roundOutcome = "SELECTION_TIMEOUT";
  } else if (decision === "WAIT") {
    roundOutcome = "WAIT_EXPECTED";
  } else if (decision === "REJECT") {
    roundOutcome = "REJECT_EXPECTED";
  } else if (decision === "ENTER" && input.openedPosition) {
    roundOutcome = "OPENED";
  } else if (decision === "ENTER" && input.executionFailed) {
    roundOutcome = "EXECUTION_FAILURE";
  } else if (!decision && firstBlocker === "LEGACY_REASON_NOT_RECORDED") {
    roundOutcome = "LEGACY_REASON_NOT_RECORDED";
  } else {
    roundOutcome = "UNKNOWN_UNRESOLVED";
  }

  return {
    decision,
    firstBlocker,
    secondaryBlockers: secondary,
    evidenceStatus,
    roundOutcome,
    executionOutcome,
    integrityConflicts: conflicts,
    mappingSource,
  };
}

export type FunnelEventKind =
  | "ROUND"
  | "CANDIDATE"
  | "CANDIDATE_EVALUATION"
  | "CANONICAL_DECISION"
  | "ORDER_INTENT"
  | "SUBMIT_ATTEMPT"
  | "ORDER"
  | "FILL"
  | "POSITION_OPEN"
  | "POSITION_CLOSE";

export type FunnelEvent = {
  eventId: string;
  campaignId: string;
  roundId?: string | null;
  candidateId?: string | null;
  decision?: CandidateAdmissionDecision | null;
  kind: FunnelEventKind;
  timestamp: string;
  orderId?: string | null;
  fillId?: string | null;
  positionId?: string | null;
};

export type FunnelSummary = {
  roundCount: number;
  uniqueCandidateCount: number;
  candidateEvaluationCount: number;
  canonicalDecisionCount: number;
  enterCount: number;
  waitCount: number;
  rejectCount: number;
  uniqueEnteredCandidateCount: number;
  orderIntentCount: number;
  submitAttemptCount: number;
  uniqueOrderCount: number;
  fillEventCount: number;
  openPositionCount: number;
  closedPositionCount: number;
  unknownUnboundCount: number;
};

export function summarizeFunnel(events: FunnelEvent[], campaignId: string): FunnelSummary {
  const seenEvents = new Set<string>();
  const scoped = events
    .filter((x) => x.campaignId === campaignId)
    .filter((x) => {
      if (seenEvents.has(x.eventId)) return false;
      seenEvents.add(x.eventId);
      return true;
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const candidateSet = new Set(scoped.map((x) => x.candidateId).filter(Boolean));
  const enteredCandidates = new Set(
    scoped
      .filter((x) => x.kind === "CANONICAL_DECISION" && x.decision === "ENTER" && x.candidateId)
      .map((x) => x.candidateId as string),
  );
  const orderSet = new Set(scoped.map((x) => x.orderId).filter(Boolean));
  const unknownUnboundCount = scoped.filter(
    (x) => (x.kind === "ORDER" || x.kind === "FILL" || x.kind === "POSITION_OPEN" || x.kind === "POSITION_CLOSE") && !x.candidateId,
  ).length;

  return {
    roundCount: scoped.filter((x) => x.kind === "ROUND").length,
    uniqueCandidateCount: candidateSet.size,
    candidateEvaluationCount: scoped.filter((x) => x.kind === "CANDIDATE_EVALUATION").length,
    canonicalDecisionCount: scoped.filter((x) => x.kind === "CANONICAL_DECISION").length,
    enterCount: scoped.filter((x) => x.kind === "CANONICAL_DECISION" && x.decision === "ENTER").length,
    waitCount: scoped.filter((x) => x.kind === "CANONICAL_DECISION" && x.decision === "WAIT").length,
    rejectCount: scoped.filter((x) => x.kind === "CANONICAL_DECISION" && x.decision === "REJECT").length,
    uniqueEnteredCandidateCount: enteredCandidates.size,
    orderIntentCount: scoped.filter((x) => x.kind === "ORDER_INTENT").length,
    submitAttemptCount: scoped.filter((x) => x.kind === "SUBMIT_ATTEMPT").length,
    uniqueOrderCount: orderSet.size,
    fillEventCount: scoped.filter((x) => x.kind === "FILL").length,
    openPositionCount: scoped.filter((x) => x.kind === "POSITION_OPEN").length,
    closedPositionCount: scoped.filter((x) => x.kind === "POSITION_CLOSE").length,
    unknownUnboundCount,
  };
}

export type AssessmentCheck = {
  checkId: string;
  required: boolean;
  status: CheckStatus;
  evidenceSource: string;
  command?: string;
  exitCode?: number | null;
  startedAt?: string;
  completedAt?: string;
  inspectedHead: string;
  inspectedWorktreeFingerprint: string;
  details?: string;
};

export type RecoveryAssessment = {
  checks: AssessmentCheck[];
  phase1Verdict: "PASS" | "PARTIAL" | "FAIL";
  overallEngineeringReadiness: "PASS" | "PARTIAL" | "FAIL";
  nextPaperPreflight: "GO" | "NO_GO";
  profitabilityEvidence: "NOT_EVALUATED";
};

export function evaluateRecoveryAssessment(checks: AssessmentCheck[]): RecoveryAssessment {
  const required = checks.filter((x) => x.required);
  const requiredPass = required.every((x) => x.status === "PASS");
  const hasFail = required.some((x) => x.status === "FAIL");
  const hasNotRun = required.some((x) => x.status === "NOT_RUN" || x.status === "BLOCKED" || x.status === "STALE");

  const phase1Verdict = hasFail ? "FAIL" : hasNotRun ? "PARTIAL" : "PASS";
  const overallEngineeringReadiness = phase1Verdict === "PASS" ? "PARTIAL" : phase1Verdict;
  const nextPaperPreflight: "GO" | "NO_GO" = requiredPass ? "NO_GO" : "NO_GO";
  return {
    checks,
    phase1Verdict,
    overallEngineeringReadiness,
    nextPaperPreflight,
    profitabilityEvidence: "NOT_EVALUATED",
  };
}
