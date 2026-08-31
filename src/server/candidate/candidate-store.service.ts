import type { FinalRankedCandidate, MicroEvaluateResult } from "@/src/server/microstructure/types";
import type { OpportunityCandidate, OpportunityScanResult } from "@/src/server/opportunity/types";
import { createRuntimeInstanceId } from "@/src/server/runtime/instance-id";
import { recordCanonicalEvent } from "@/src/server/forensics/canonical-event.service";

export type CandidateLifecycleState =
  | "DISCOVERED"
  | "WATCHING"
  | "HOT"
  | "MICRO_WARMING"
  | "MICRO_ANALYZED"
  | "MICRO_CONFIRMED"
  | "MICRO_REJECTED"
  | "FINAL_RANKED"
  | "EXECUTION_READY"
  | "NOT_EXECUTION_READY"
  | "RISK_PENDING"
  | "RISK_ALLOWED"
  | "RISK_REJECTED"
  | "PAPER_ATTEMPT"
  | "PAPER_OPENED"
  | "PAPER_REJECTED"
  | "PAPER_CLOSED"
  | "EXPIRED"
  | "ERROR";

export type HandoffErrorCode =
  | "HANDOFF_IDENTITY_MISSING"
  | "HANDOFF_CANDIDATE_NOT_FOUND"
  | "HANDOFF_ILLEGAL_TRANSITION"
  | "HANDOFF_DUPLICATE_EXECUTION"
  | "HANDOFF_STATE_MISMATCH"
  | "PIPELINE_INVARIANT_VIOLATION";

export type CanonicalCandidateRecord = {
  candidateId: string;
  symbol: string;
  lane: string;
  state: CandidateLifecycleState;
  firstDetectedAt: number;
  detectedPrice: number;
  confirmedAt?: number | null;
  finalRankAt?: number | null;
  executionDecisionAt?: number | null;
  executionIntentId?: string | null;
  opportunityScore?: number | null;
  microScore?: number | null;
  liquidityScore?: number | null;
  finalScore?: number | null;
  reasonCodes: string[];
  stageReasons: string[];
  terminalStage: CandidateLifecycleState | null;
  terminalReason: string | null;
  decisionClass?: "DATA_INVALID" | "QUALITY_TOO_LOW" | null;
  timing?: FinalRankedCandidate["timing"];
  lastUpdatedAt: number;
  expiresAt: number;
  instances: {
    opportunityInstanceId?: string;
    microInstanceId?: string;
    candidateStoreInstanceId: string;
  };
};

type CandidateStoreTelemetry = {
  instanceId: string;
  active: number;
  executionReady: number;
  transitions: number;
  created: number;
  expired: number;
  byState: Record<string, number>;
  transitionByState: Record<string, number>;
  handoffErrors: Array<{
    at: number;
    code: HandoffErrorCode;
    candidateId: string | null;
    symbol: string | null;
    detail: string;
  }>;
  handoffErrorCounts: Record<HandoffErrorCode, number>;
  pipelineInvariantViolations: number;
  funnel: {
    microAnalyzed: number;
    microConfirmed: number;
    microRejected: number;
    microPending: number;
    finalRanked: number;
    executionReady: number;
    notExecutionReady: number;
    rankPending: number;
    riskPending: number;
    riskAllowed: number;
    riskRejected: number;
    paperAttempt: number;
    paperOpened: number;
    paperRejected: number;
    paperPending: number;
  };
  recentTransitions: Array<{
    at: number;
    candidateId: string;
    symbol: string;
    lane: string;
    state: CandidateLifecycleState;
    reasons: string[];
  }>;
};

const ACTIVE_STATES = new Set<CandidateLifecycleState>([
  "DISCOVERED",
  "WATCHING",
  "HOT",
  "MICRO_WARMING",
  "MICRO_ANALYZED",
  "MICRO_CONFIRMED",
  "FINAL_RANKED",
  "EXECUTION_READY",
  "NOT_EXECUTION_READY",
  "RISK_PENDING",
  "RISK_ALLOWED",
  "RISK_REJECTED",
  "PAPER_ATTEMPT",
  "PAPER_OPENED",
  "PAPER_REJECTED",
]);

const TERMINAL_STATES = new Set<CandidateLifecycleState>([
  "NOT_EXECUTION_READY",
  "MICRO_REJECTED",
  "RISK_REJECTED",
  "PAPER_REJECTED",
  "PAPER_CLOSED",
  "EXPIRED",
  "ERROR",
]);

const ALLOWED_TRANSITIONS: Record<CandidateLifecycleState, ReadonlySet<CandidateLifecycleState>> = {
  DISCOVERED: new Set(["WATCHING", "HOT", "MICRO_WARMING", "EXPIRED", "ERROR"]),
  WATCHING: new Set(["HOT", "MICRO_WARMING", "EXPIRED", "ERROR"]),
  HOT: new Set(["MICRO_WARMING", "MICRO_ANALYZED", "EXPIRED", "ERROR"]),
  MICRO_WARMING: new Set(["MICRO_ANALYZED", "EXPIRED", "ERROR"]),
  MICRO_ANALYZED: new Set(["MICRO_CONFIRMED", "MICRO_REJECTED", "EXPIRED", "ERROR"]),
  MICRO_CONFIRMED: new Set(["FINAL_RANKED", "EXPIRED", "ERROR"]),
  MICRO_REJECTED: new Set(["EXPIRED", "ERROR"]),
  FINAL_RANKED: new Set(["EXECUTION_READY", "NOT_EXECUTION_READY", "EXPIRED", "ERROR"]),
  EXECUTION_READY: new Set(["RISK_PENDING", "EXPIRED", "ERROR"]),
  NOT_EXECUTION_READY: new Set(["EXPIRED", "ERROR"]),
  RISK_PENDING: new Set(["RISK_ALLOWED", "RISK_REJECTED", "EXPIRED", "ERROR"]),
  RISK_ALLOWED: new Set(["PAPER_ATTEMPT", "EXPIRED", "ERROR"]),
  RISK_REJECTED: new Set(["EXPIRED", "ERROR"]),
  PAPER_ATTEMPT: new Set(["PAPER_OPENED", "PAPER_REJECTED", "ERROR"]),
  PAPER_OPENED: new Set(["PAPER_CLOSED", "ERROR"]),
  PAPER_REJECTED: new Set(["EXPIRED", "ERROR"]),
  PAPER_CLOSED: new Set(["EXPIRED"]),
  EXPIRED: new Set(),
  ERROR: new Set(),
};

class CandidateStore {
  readonly instanceId = createRuntimeInstanceId("candidate-store");
  private readonly rows = new Map<string, CanonicalCandidateRecord>();
  private transitions = 0;
  private created = 0;
  private expired = 0;
  private invariantViolations = 0;
  private readonly events: CandidateStoreTelemetry["recentTransitions"] = [];
  private readonly handoffErrors: CandidateStoreTelemetry["handoffErrors"] = [];
  private readonly transitionByState = new Map<CandidateLifecycleState, number>();
  private readonly executionIntents = new Map<string, string>();

  createCandidate(input: {
    candidateId: string;
    symbol: string;
    lane: string;
    detectedAt: number;
    detectedPrice: number;
    opportunityScore?: number;
    reasonCodes?: string[];
    opportunityInstanceId?: string;
    ttlMs?: number;
  }) {
    const normalizedCandidateId = this.normalizeCandidateId(input.candidateId);
    const existing = this.rows.get(normalizedCandidateId);
    if (existing) return existing;
    const now = Date.now();
    const row: CanonicalCandidateRecord = {
      candidateId: normalizedCandidateId,
      symbol: input.symbol.toUpperCase(),
      lane: input.lane,
      state: "DISCOVERED",
      firstDetectedAt: input.detectedAt,
      detectedPrice: input.detectedPrice,
      opportunityScore: input.opportunityScore ?? null,
      reasonCodes: [...new Set(input.reasonCodes ?? [])],
      stageReasons: [],
      terminalStage: null,
      terminalReason: null,
      lastUpdatedAt: now,
      expiresAt: now + Math.max(30_000, input.ttlMs ?? 10 * 60_000),
      instances: {
        opportunityInstanceId: input.opportunityInstanceId,
        candidateStoreInstanceId: this.instanceId,
      },
    };
    this.rows.set(normalizedCandidateId, row);
    this.created += 1;
    return row;
  }

  updateCandidate(candidateId: string, patch: Partial<CanonicalCandidateRecord>) {
    const normalizedCandidateId = this.normalizeCandidateId(candidateId);
    const row = this.rows.get(normalizedCandidateId);
    if (!row) return null;
    if (patch.candidateId && patch.candidateId !== normalizedCandidateId) {
      this.recordHandoffError({
        code: "HANDOFF_STATE_MISMATCH",
        candidateId: normalizedCandidateId,
        symbol: row.symbol,
        detail: "candidateId is immutable",
      });
      return null;
    }
    if (patch.symbol && patch.symbol.toUpperCase() !== row.symbol) {
      this.recordHandoffError({
        code: "HANDOFF_STATE_MISMATCH",
        candidateId: normalizedCandidateId,
        symbol: row.symbol,
        detail: `symbol mismatch (${patch.symbol} !== ${row.symbol})`,
      });
      return null;
    }
    if (patch.lane && patch.lane !== row.lane) {
      this.recordHandoffError({
        code: "HANDOFF_STATE_MISMATCH",
        candidateId: normalizedCandidateId,
        symbol: row.symbol,
        detail: `lane mismatch (${patch.lane} !== ${row.lane})`,
      });
      return null;
    }
    const next: CanonicalCandidateRecord = {
      ...row,
      ...patch,
      reasonCodes: patch.reasonCodes ? [...new Set(patch.reasonCodes)] : row.reasonCodes,
      stageReasons: patch.stageReasons ? [...new Set(patch.stageReasons)] : row.stageReasons,
      lastUpdatedAt: Date.now(),
    };
    this.rows.set(normalizedCandidateId, next);
    return next;
  }

  getCandidate(candidateId: string) {
    const normalizedCandidateId = this.normalizeCandidateId(candidateId, false);
    if (!normalizedCandidateId) return null;
    return this.rows.get(normalizedCandidateId) ?? null;
  }

  getActiveCandidates() {
    this.expireCandidate();
    return [...this.rows.values()].filter((row) => ACTIVE_STATES.has(row.state));
  }

  transitionCandidate(candidateId: string, state: CandidateLifecycleState, reasons?: string[]) {
    const normalizedCandidateId = this.normalizeCandidateId(candidateId, false);
    if (!normalizedCandidateId) {
      this.recordHandoffError({
        code: "HANDOFF_IDENTITY_MISSING",
        candidateId: null,
        symbol: null,
        detail: "transitionCandidate called without candidateId",
      });
      return null;
    }
    const row = this.rows.get(normalizedCandidateId);
    if (!row) {
      this.recordHandoffError({
        code: "HANDOFF_CANDIDATE_NOT_FOUND",
        candidateId: normalizedCandidateId,
        symbol: null,
        detail: `transition target state=${state}`,
      });
      return null;
    }
    if (row.state !== state) {
      const allowed = ALLOWED_TRANSITIONS[row.state];
      if (!allowed.has(state)) {
        this.recordHandoffError({
          code: "HANDOFF_ILLEGAL_TRANSITION",
          candidateId: normalizedCandidateId,
          symbol: row.symbol,
          detail: `${row.state} -> ${state}`,
        });
        return null;
      }
    }
    this.transitions += 1;
    row.state = state;
    row.lastUpdatedAt = Date.now();
    if (reasons?.length) {
      row.stageReasons = [...new Set([...row.stageReasons, ...reasons])];
    }
    if (state === "MICRO_CONFIRMED") row.confirmedAt = Date.now();
    if (state === "FINAL_RANKED") row.finalRankAt = Date.now();
    if (state === "EXECUTION_READY" || state === "NOT_EXECUTION_READY") {
      row.executionDecisionAt = Date.now();
    }
    const normalizedReasons = (reasons ?? []).filter(Boolean);
    if (TERMINAL_STATES.has(state)) {
      row.terminalStage = state;
      row.terminalReason = normalizedReasons[0] ?? `TERMINAL_${state}`;
    } else {
      row.terminalStage = null;
      row.terminalReason = null;
    }
    this.rows.set(normalizedCandidateId, row);
    this.transitionByState.set(state, (this.transitionByState.get(state) ?? 0) + 1);
    this.events.push({
      at: row.lastUpdatedAt,
      candidateId: row.candidateId,
      symbol: row.symbol,
      lane: row.lane,
      state,
      reasons: normalizedReasons,
    });
    if (this.events.length > 10_000) this.events.splice(0, this.events.length - 10_000);
    recordCanonicalEvent({
      candidateId: row.candidateId,
      symbol: row.symbol,
      eventType: toLifecycleEventType(state),
      sourceService: "candidate-store",
      sourceInstanceId: this.instanceId,
      payload: {
        lane: row.lane,
        lifecycleState: state,
        terminalStage: row.terminalStage,
        terminalReason: row.terminalReason,
        reasonCodes: normalizedReasons.length > 0 ? normalizedReasons : ["UNSPECIFIED_REASON"],
        stageReasons: row.stageReasons,
      },
    });
    this.assertFunnelInvariants();
    return row;
  }

  expireCandidate(now = Date.now()) {
    for (const [id, row] of this.rows) {
      if (row.state === "PAPER_CLOSED" || row.state === "EXPIRED") continue;
      if (row.expiresAt <= now) {
        this.transitionCandidate(id, "EXPIRED", ["CANDIDATE_TTL_EXPIRED"]);
        this.expired += 1;
      }
    }
  }

  getExecutionReadyCandidates() {
    this.expireCandidate();
    return [...this.rows.values()].filter((row) => row.state === "EXECUTION_READY");
  }

  ingestOpportunityScan(input: {
    result: OpportunityScanResult;
    opportunityInstanceId: string;
    ttlMs?: number;
  }) {
    const now = Date.now();
    for (const row of input.result.ranked) {
      if (!row.candidateId?.trim()) {
        this.recordHandoffError({
          code: "HANDOFF_IDENTITY_MISSING",
          candidateId: null,
          symbol: row.symbol,
          detail: "opportunity candidate missing candidateId",
        });
        continue;
      }
      const created = this.createCandidate({
        candidateId: row.candidateId,
        symbol: row.symbol,
        lane: row.primaryLane,
        detectedAt: row.firstDetectedAt,
        detectedPrice: row.firstDetectionPrice,
        opportunityScore: row.score,
        reasonCodes: row.reasonCodes,
        opportunityInstanceId: input.opportunityInstanceId,
        ttlMs: input.ttlMs,
      });
      const mapped = mapOpportunityState(row.state);
      created.opportunityScore = row.score;
      created.lane = row.primaryLane;
      created.reasonCodes = [...new Set([...(created.reasonCodes ?? []), ...(row.reasonCodes ?? [])])];
      created.expiresAt = now + Math.max(30_000, input.ttlMs ?? 10 * 60_000);
      this.rows.set(created.candidateId, created);
      this.transitionCandidate(created.candidateId, mapped, row.reasonCodes);
    }
  }

  ingestMicroEvaluation(input: {
    result: MicroEvaluateResult;
    microInstanceId: string;
    ttlMs?: number;
  }) {
    const now = Date.now();
    for (const row of input.result.ranked) {
      const normalizedCandidateId = this.normalizeCandidateId(row.candidateId, false);
      if (!normalizedCandidateId) {
        this.recordHandoffError({
          code: "HANDOFF_IDENTITY_MISSING",
          candidateId: null,
          symbol: row.symbol,
          detail: "micro result missing candidateId",
        });
        continue;
      }
      const created = this.rows.get(normalizedCandidateId);
      if (!created) {
        this.recordHandoffError({
          code: "HANDOFF_CANDIDATE_NOT_FOUND",
          candidateId: normalizedCandidateId,
          symbol: row.symbol,
          detail: "micro result candidate was not discovered by opportunity stage",
        });
        continue;
      }
      if (created.symbol !== row.symbol.toUpperCase()) {
        this.recordHandoffError({
          code: "HANDOFF_STATE_MISMATCH",
          candidateId: normalizedCandidateId,
          symbol: row.symbol,
          detail: `symbol mismatch (${row.symbol} !== ${created.symbol})`,
        });
        this.transitionCandidate(normalizedCandidateId, "ERROR", ["HANDOFF_STATE_MISMATCH"]);
        continue;
      }
      created.instances.microInstanceId = input.microInstanceId;
      created.microScore = row.microScore;
      created.liquidityScore = row.liquidityScore;
      created.finalScore = row.smoothedScore;
      created.timing = row.timing;
      created.reasonCodes = [...new Set([...(created.reasonCodes ?? []), ...(row.reasonCodes ?? [])])];
      created.expiresAt = now + Math.max(30_000, input.ttlMs ?? 10 * 60_000);
      this.rows.set(created.candidateId, created);

      const outcomeReasons = normalizeMicroOutcomeReasons(row);
      this.transitionCandidate(created.candidateId, "MICRO_ANALYZED", outcomeReasons);
      if (row.state === "WARMING") {
        this.transitionCandidate(created.candidateId, "MICRO_WARMING", outcomeReasons);
        continue;
      }
      if (row.state === "MICRO_CONFIRMED" || row.state === "EXECUTION_READY") {
        this.transitionCandidate(created.candidateId, "MICRO_CONFIRMED", outcomeReasons);
        this.transitionCandidate(created.candidateId, "FINAL_RANKED", outcomeReasons);
      }
      if (row.state === "EXECUTION_READY") {
        created.decisionClass = null;
        this.transitionCandidate(created.candidateId, "EXECUTION_READY", outcomeReasons);
      } else if (row.state === "MICRO_CONFIRMED" || row.state === "COOLING") {
        created.decisionClass = classifyDecisionClass(outcomeReasons);
        this.transitionCandidate(created.candidateId, "NOT_EXECUTION_READY", outcomeReasons);
      } else if (row.state === "HARD_REJECT") {
        created.decisionClass = "DATA_INVALID";
        this.transitionCandidate(created.candidateId, "MICRO_REJECTED", outcomeReasons);
      } else if (row.state === "EXPIRED") {
        this.transitionCandidate(created.candidateId, "EXPIRED", outcomeReasons);
      } else {
        this.recordHandoffError({
          code: "PIPELINE_INVARIANT_VIOLATION",
          candidateId: created.candidateId,
          symbol: created.symbol,
          detail: `MICRO_ANALYZED produced unresolved row.state=${row.state}`,
        });
      }
    }
  }

  registerExecutionIntent(input: {
    candidateId: string;
    executionIntentId: string;
    strategyContext: string;
  }): { ok: true } | { ok: false; code: HandoffErrorCode; detail: string } {
    const candidateId = this.normalizeCandidateId(input.candidateId, false);
    const executionIntentId = input.executionIntentId.trim();
    const strategyContext = input.strategyContext.trim().toUpperCase();
    if (!candidateId || !executionIntentId || !strategyContext) {
      this.recordHandoffError({
        code: "HANDOFF_IDENTITY_MISSING",
        candidateId: candidateId ?? null,
        symbol: null,
        detail: "registerExecutionIntent missing required identity fields",
      });
      return { ok: false, code: "HANDOFF_IDENTITY_MISSING", detail: "missing identity fields" };
    }
    const row = this.rows.get(candidateId);
    if (!row) {
      this.recordHandoffError({
        code: "HANDOFF_CANDIDATE_NOT_FOUND",
        candidateId,
        symbol: null,
        detail: "registerExecutionIntent candidate not found",
      });
      return { ok: false, code: "HANDOFF_CANDIDATE_NOT_FOUND", detail: "candidate not found" };
    }
    const uniqueKey = `${candidateId}|${strategyContext}`;
    const existing = this.executionIntents.get(uniqueKey);
    if (existing && existing !== executionIntentId) {
      this.recordHandoffError({
        code: "HANDOFF_DUPLICATE_EXECUTION",
        candidateId,
        symbol: row.symbol,
        detail: `duplicate execution intent for ${strategyContext}`,
      });
      return {
        ok: false,
        code: "HANDOFF_DUPLICATE_EXECUTION",
        detail: `existing executionIntentId=${existing}`,
      };
    }
    this.executionIntents.set(uniqueKey, executionIntentId);
    row.executionIntentId = executionIntentId;
    row.lastUpdatedAt = Date.now();
    this.rows.set(candidateId, row);
    return { ok: true };
  }

  getTelemetry(): CandidateStoreTelemetry {
    this.expireCandidate();
    const byState: Record<string, number> = {};
    for (const row of this.rows.values()) {
      byState[row.state] = (byState[row.state] ?? 0) + 1;
    }
    const transitionByState: Record<string, number> = {};
    for (const [state, count] of this.transitionByState.entries()) {
      transitionByState[state] = count;
    }

    const handoffErrorCounts = {
      HANDOFF_IDENTITY_MISSING: 0,
      HANDOFF_CANDIDATE_NOT_FOUND: 0,
      HANDOFF_ILLEGAL_TRANSITION: 0,
      HANDOFF_DUPLICATE_EXECUTION: 0,
      HANDOFF_STATE_MISMATCH: 0,
      PIPELINE_INVARIANT_VIOLATION: 0,
    } satisfies Record<HandoffErrorCode, number>;
    for (const row of this.handoffErrors) {
      handoffErrorCounts[row.code] = (handoffErrorCounts[row.code] ?? 0) + 1;
    }

    const microAnalyzed = transitionByState.MICRO_ANALYZED ?? 0;
    const microConfirmed = transitionByState.MICRO_CONFIRMED ?? 0;
    const microRejected = transitionByState.MICRO_REJECTED ?? 0;
    const finalRanked = transitionByState.FINAL_RANKED ?? 0;
    const executionReady = transitionByState.EXECUTION_READY ?? 0;
    const notExecutionReady = transitionByState.NOT_EXECUTION_READY ?? 0;
    const riskPending = transitionByState.RISK_PENDING ?? 0;
    const riskAllowed = transitionByState.RISK_ALLOWED ?? 0;
    const riskRejected = transitionByState.RISK_REJECTED ?? 0;
    const paperAttempt = transitionByState.PAPER_ATTEMPT ?? 0;
    const paperOpened = transitionByState.PAPER_OPENED ?? 0;
    const paperRejected = transitionByState.PAPER_REJECTED ?? 0;

    return {
      instanceId: this.instanceId,
      active: this.getActiveCandidates().length,
      executionReady: this.getExecutionReadyCandidates().length,
      transitions: this.transitions,
      created: this.created,
      expired: this.expired,
      byState,
      transitionByState,
      handoffErrors: this.handoffErrors.slice(-500),
      handoffErrorCounts,
      pipelineInvariantViolations: this.invariantViolations,
      funnel: {
        microAnalyzed,
        microConfirmed,
        microRejected,
        microPending: Math.max(0, microAnalyzed - (microConfirmed + microRejected)),
        finalRanked,
        executionReady,
        notExecutionReady,
        rankPending: Math.max(0, microConfirmed - finalRanked),
        riskPending,
        riskAllowed,
        riskRejected,
        paperAttempt,
        paperOpened,
        paperRejected,
        paperPending: Math.max(0, riskAllowed - (paperOpened + paperRejected + paperAttempt)),
      },
      recentTransitions: this.events.slice(-500),
    };
  }

  resetForTests() {
    this.rows.clear();
    this.transitions = 0;
    this.created = 0;
    this.expired = 0;
    this.invariantViolations = 0;
    this.events.length = 0;
    this.handoffErrors.length = 0;
    this.transitionByState.clear();
    this.executionIntents.clear();
  }

  private normalizeCandidateId(candidateId: string): string;
  private normalizeCandidateId(candidateId: string, strict: true): string;
  private normalizeCandidateId(candidateId: string, strict: false): string | null;
  private normalizeCandidateId(candidateId: string, strict = true) {
    const normalized = String(candidateId ?? "").trim();
    if (!normalized) {
      if (strict) throw new Error("HANDOFF_IDENTITY_MISSING");
      return null;
    }
    return normalized;
  }

  private recordHandoffError(input: {
    code: HandoffErrorCode;
    candidateId: string | null;
    symbol: string | null;
    detail: string;
  }) {
    this.handoffErrors.push({
      at: Date.now(),
      code: input.code,
      candidateId: input.candidateId,
      symbol: input.symbol ? input.symbol.toUpperCase() : null,
      detail: input.detail,
    });
    if (this.handoffErrors.length > 10_000) {
      this.handoffErrors.splice(0, this.handoffErrors.length - 10_000);
    }
  }

  private assertFunnelInvariants() {
    const c = (state: CandidateLifecycleState) => this.transitionByState.get(state) ?? 0;
    const checks: Array<{ ok: boolean; detail: string }> = [
      {
        ok: c("MICRO_ANALYZED") >= c("MICRO_CONFIRMED") + c("MICRO_REJECTED"),
        detail: "MICRO_ANALYZED < MICRO_CONFIRMED + MICRO_REJECTED",
      },
      {
        ok: c("MICRO_CONFIRMED") >= c("FINAL_RANKED"),
        detail: "MICRO_CONFIRMED < FINAL_RANKED",
      },
      {
        ok: c("FINAL_RANKED") >= c("EXECUTION_READY") + c("NOT_EXECUTION_READY"),
        detail: "FINAL_RANKED < EXECUTION_READY + NOT_EXECUTION_READY",
      },
      {
        ok: c("EXECUTION_READY") >= c("RISK_PENDING"),
        detail: "EXECUTION_READY < RISK_PENDING",
      },
      {
        ok: c("RISK_PENDING") >= c("RISK_ALLOWED") + c("RISK_REJECTED"),
        detail: "RISK_PENDING < RISK_ALLOWED + RISK_REJECTED",
      },
      {
        ok: c("RISK_ALLOWED") >= c("PAPER_ATTEMPT"),
        detail: "RISK_ALLOWED < PAPER_ATTEMPT",
      },
      {
        ok: c("PAPER_ATTEMPT") >= c("PAPER_OPENED") + c("PAPER_REJECTED"),
        detail: "PAPER_ATTEMPT < PAPER_OPENED + PAPER_REJECTED",
      },
    ];
    for (const check of checks) {
      if (!check.ok) {
        this.invariantViolations += 1;
        this.recordHandoffError({
          code: "PIPELINE_INVARIANT_VIOLATION",
          candidateId: null,
          symbol: null,
          detail: check.detail,
        });
      }
    }
  }
}

function mapOpportunityState(state: OpportunityCandidate["state"]): CandidateLifecycleState {
  switch (state) {
    case "PROMOTED":
    case "HOT":
      return "HOT";
    case "WATCHING":
      return "WATCHING";
    case "EXPIRED":
      return "EXPIRED";
    default:
      return "DISCOVERED";
  }
}

function normalizeMicroOutcomeReasons(row: FinalRankedCandidate): string[] {
  const source = [...(row.reasonCodes ?? [])];
  const mapped = new Set<string>();
  for (const code of source) {
    if (code.startsWith("EXECUTION_")) mapped.add(code);
  }
  const has = (code: string) => source.some((item) => item === code);
  if (row.state === "WARMING") mapped.add("MICRO_WARMUP_INCOMPLETE");
  if (has("MICRO_DATA_STALE")) mapped.add("MICRO_DATA_STALE");
  if (has("MICRO_LOW_ACTIVITY")) mapped.add("MICRO_LOW_ACTIVITY");
  if (has("MICRO_SELL_FLOW_DOMINANT")) mapped.add("MICRO_SELL_FLOW_DOMINANT");
  if (has("MICRO_WIDE_SPREAD")) mapped.add("MICRO_WIDE_SPREAD");
  if (has("MICRO_EXHAUSTION")) mapped.add("MICRO_EXHAUSTION");
  if (has("MICRO_FAILED_BREAKOUT")) mapped.add("MICRO_FAILED_BREAKOUT");
  if (has("MICRO_FLOW_DIVERGENCE")) mapped.add("MICRO_FLOW_DIVERGENCE");
  if (has("MICRO_BID_WITHDRAWAL")) mapped.add("MICRO_INSUFFICIENT_BID_SUPPORT");
  if (!has("MICRO_ASK_DEPLETION")) mapped.add("MICRO_NO_ASK_DEPLETION");
  if (!has("MICRO_BID_SUPPORT")) mapped.add("MICRO_INSUFFICIENT_BID_SUPPORT");
  if (row.state === "HARD_REJECT" && mapped.size === 0) mapped.add("MICRO_HARD_REJECT");
  if (row.state === "MICRO_CONFIRMED" || row.state === "EXECUTION_READY") {
    mapped.add("MICRO_POSITIVE_CONFIRM");
  }
  if (mapped.size === 0) mapped.add("MICRO_NEUTRAL_STATE");
  return [...mapped];
}

function classifyDecisionClass(reasons: string[]): "DATA_INVALID" | "QUALITY_TOO_LOW" {
  const dataInvalid = reasons.some((reason) =>
    ["MICRO_DATA_STALE", "MICRO_INVALID_BOOK", "MICRO_ZERO_LIQUIDITY", "MICRO_EXTREME_SPREAD"].includes(reason),
  );
  return dataInvalid ? "DATA_INVALID" : "QUALITY_TOO_LOW";
}

function toLifecycleEventType(state: CandidateLifecycleState) {
  const map: Record<CandidateLifecycleState, string> = {
    DISCOVERED: "CANDIDATE_DISCOVERED",
    WATCHING: "CANDIDATE_WATCHING",
    HOT: "CANDIDATE_HOT",
    MICRO_WARMING: "MICRO_WARMING",
    MICRO_ANALYZED: "MICRO_ANALYZED",
    MICRO_CONFIRMED: "MICRO_CONFIRMED",
    MICRO_REJECTED: "MICRO_REJECTED",
    FINAL_RANKED: "FINAL_RANKED",
    EXECUTION_READY: "EXECUTION_READY",
    NOT_EXECUTION_READY: "NOT_EXECUTION_READY",
    RISK_PENDING: "RISK_PENDING",
    RISK_ALLOWED: "RISK_ALLOWED",
    RISK_REJECTED: "RISK_REJECTED",
    PAPER_ATTEMPT: "PAPER_ATTEMPT",
    PAPER_OPENED: "PAPER_OPENED",
    PAPER_REJECTED: "PAPER_REJECTED",
    PAPER_CLOSED: "PAPER_CLOSED",
    EXPIRED: "CANDIDATE_EXPIRED",
    ERROR: "CANDIDATE_ERROR",
  };
  return map[state];
}

const globalRef = globalThis as typeof globalThis & {
  __canonicalCandidateStore?: CandidateStore;
};

export function getCanonicalCandidateStore() {
  if (!globalRef.__canonicalCandidateStore) {
    globalRef.__canonicalCandidateStore = new CandidateStore();
  }
  return globalRef.__canonicalCandidateStore;
}

export function resetCanonicalCandidateStoreForTests() {
  const store = getCanonicalCandidateStore();
  store.resetForTests();
  return store;
}
