import type { OpportunityCandidate, OpportunityScanResult } from "@/src/server/opportunity/types";
import type { FinalRankedCandidate, MicroEvaluateResult } from "@/src/server/microstructure/types";
import { createRuntimeInstanceId } from "@/src/server/runtime/instance-id";

export type CandidateLifecycleState =
  | "DISCOVERED"
  | "WATCHING"
  | "HOT"
  | "MICRO_WARMING"
  | "MICRO_ANALYZED"
  | "MICRO_CONFIRMED"
  | "FINAL_RANKED"
  | "EXECUTION_READY"
  | "NOT_EXECUTION_READY"
  | "RISK_PENDING_WITH_REASON"
  | "RISK_ALLOWED"
  | "RISK_REJECTED"
  | "PAPER_ATTEMPT"
  | "PAPER_OPENED"
  | "PAPER_REJECTED_WITH_REASON"
  | "PAPER_CLOSED"
  | "MICRO_REJECTED"
  | "RANKED_OUT"
  | "EXPIRED";

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
  opportunityScore?: number | null;
  microScore?: number | null;
  liquidityScore?: number | null;
  finalScore?: number | null;
  reasonCodes: string[];
  stageReasons: string[];
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
  "RISK_PENDING_WITH_REASON",
  "RISK_ALLOWED",
  "RISK_REJECTED",
  "PAPER_ATTEMPT",
  "PAPER_OPENED",
  "PAPER_REJECTED_WITH_REASON",
]);

class CandidateStore {
  readonly instanceId = createRuntimeInstanceId("candidate-store");
  private readonly rows = new Map<string, CanonicalCandidateRecord>();
  private transitions = 0;
  private created = 0;
  private expired = 0;
  private readonly events: CandidateStoreTelemetry["recentTransitions"] = [];

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
    const existing = this.rows.get(input.candidateId);
    if (existing) return existing;
    const now = Date.now();
    const row: CanonicalCandidateRecord = {
      candidateId: input.candidateId,
      symbol: input.symbol.toUpperCase(),
      lane: input.lane,
      state: "DISCOVERED",
      firstDetectedAt: input.detectedAt,
      detectedPrice: input.detectedPrice,
      opportunityScore: input.opportunityScore ?? null,
      reasonCodes: [...new Set(input.reasonCodes ?? [])],
      stageReasons: [],
      lastUpdatedAt: now,
      expiresAt: now + Math.max(30_000, input.ttlMs ?? 10 * 60_000),
      instances: {
        opportunityInstanceId: input.opportunityInstanceId,
        candidateStoreInstanceId: this.instanceId,
      },
    };
    this.rows.set(row.candidateId, row);
    this.created += 1;
    return row;
  }

  updateCandidate(candidateId: string, patch: Partial<CanonicalCandidateRecord>) {
    const row = this.rows.get(candidateId);
    if (!row) return null;
    const next: CanonicalCandidateRecord = {
      ...row,
      ...patch,
      reasonCodes: patch.reasonCodes ? [...new Set(patch.reasonCodes)] : row.reasonCodes,
      stageReasons: patch.stageReasons ? [...new Set(patch.stageReasons)] : row.stageReasons,
      lastUpdatedAt: Date.now(),
    };
    this.rows.set(candidateId, next);
    return next;
  }

  getCandidate(candidateId: string) {
    return this.rows.get(candidateId) ?? null;
  }

  getActiveCandidates() {
    this.expireCandidate();
    return [...this.rows.values()].filter((row) => ACTIVE_STATES.has(row.state));
  }

  transitionCandidate(candidateId: string, state: CandidateLifecycleState, reasons?: string[]) {
    const row = this.rows.get(candidateId);
    if (!row) return null;
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
    this.rows.set(candidateId, row);
    this.events.push({
      at: row.lastUpdatedAt,
      candidateId: row.candidateId,
      symbol: row.symbol,
      lane: row.lane,
      state,
      reasons: reasons ?? [],
    });
    if (this.events.length > 10_000) this.events.splice(0, this.events.length - 10_000);
    return row;
  }

  expireCandidate(now = Date.now()) {
    for (const [id, row] of this.rows) {
      if (row.state === "PAPER_CLOSED" || row.state === "EXPIRED") continue;
      if (row.expiresAt <= now) {
        row.state = "EXPIRED";
        row.lastUpdatedAt = now;
        this.rows.set(id, row);
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
      const created = this.createCandidate({
        candidateId: row.candidateId,
        symbol: row.symbol,
        lane: row.lane,
        detectedAt: row.firstDetectedAt,
        detectedPrice: row.firstDetectionPrice,
        opportunityScore: row.opportunityScore,
        reasonCodes: row.reasonCodes,
        ttlMs: input.ttlMs,
      });
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
      }
    }
  }

  getTelemetry(): CandidateStoreTelemetry {
    this.expireCandidate();
    const byState: Record<string, number> = {};
    for (const row of this.rows.values()) {
      byState[row.state] = (byState[row.state] ?? 0) + 1;
    }
    return {
      instanceId: this.instanceId,
      active: this.getActiveCandidates().length,
      executionReady: this.getExecutionReadyCandidates().length,
      transitions: this.transitions,
      created: this.created,
      expired: this.expired,
      byState,
      recentTransitions: this.events.slice(-500),
    };
  }

  resetForTests() {
    this.rows.clear();
    this.transitions = 0;
    this.created = 0;
    this.expired = 0;
    this.events.length = 0;
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
  const has = (code: string) => source.includes(code);
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
