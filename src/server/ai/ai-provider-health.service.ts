import type { AIProviderResult } from "@/src/types/ai";

export const AI_PROVIDER_HEALTH_STATES = [
  "HEALTHY",
  "DEGRADED",
  "TIMEOUT",
  "UNAVAILABLE",
  "RATE_LIMITED",
  "INVALID_RESPONSE",
  "ABORTED",
] as const;

export type AiProviderHealthState = (typeof AI_PROVIDER_HEALTH_STATES)[number];

export type AiProviderHealthGate = "ALL_HEALTHY" | "PARTIAL_DEGRADATION" | "ALL_DEGRADED";

export type AiPathClassification =
  | "NORMAL"
  | "PARTIAL_DEGRADED"
  | "ALL_DEGRADED"
  | "POLICY_REJECTION"
  | "RELIABILITY_FAILURE";

export type AiProviderHealthRecord = {
  provider: string;
  requestId: string;
  startedAt: string;
  endedAt: string;
  latencyMs: number;
  healthState: AiProviderHealthState;
  errorCode?: string;
  retryCount?: number;
  responseReceived: boolean;
  lane?: string;
};

export type AiProviderHealthEvaluation = {
  gate: AiProviderHealthGate;
  aiPath: AiPathClassification;
  records: AiProviderHealthRecord[];
  counts: Record<AiProviderHealthState, number>;
  eligibleForConsensus: AIProviderResult[];
  telemetry: {
    aiProviderHealth: AiProviderHealthGate;
    aiProviderHealthCounts: Record<AiProviderHealthState, number>;
    aiDegradedCount: number;
    aiTimeoutCount: number;
    aiUnavailableCount: number;
    aiInvalidResponseCount: number;
    aiRetryCount: number;
    aiAllProvidersDegradedCount: number;
  };
};

function emptyCounts(): Record<AiProviderHealthState, number> {
  return {
    HEALTHY: 0,
    DEGRADED: 0,
    TIMEOUT: 0,
    UNAVAILABLE: 0,
    RATE_LIMITED: 0,
    INVALID_RESPONSE: 0,
    ABORTED: 0,
  };
}

export function classifyProviderHealthState(row: AIProviderResult): AiProviderHealthState {
  const errorText = String(row.error ?? "").toLowerCase();
  const failure = String(row.failureCategory ?? "").toLowerCase();

  if (errorText.includes("abort") || failure.includes("abort")) return "ABORTED";
  if (failure.includes("timeout") || errorText.includes("timeout")) return "TIMEOUT";
  if (failure.includes("rate") || errorText.includes("rate limit")) return "RATE_LIMITED";
  if (failure.includes("json") || errorText.includes("invalid")) return "INVALID_RESPONSE";

  if (!row.ok || !row.output) {
    return failure.includes("remote") ? "UNAVAILABLE" : "UNAVAILABLE";
  }

  const meta = row.output.metadata as Record<string, unknown> | undefined;
  const remote = Boolean(row.remoteOk ?? meta?.remoteOk ?? meta?.remote);
  if (remote) return "HEALTHY";
  if (row.degraded || meta?.degraded === true) return "DEGRADED";
  return "DEGRADED";
}

export function isConsensusEligibleHealth(state: AiProviderHealthState): boolean {
  return state === "HEALTHY";
}

function isAiProviderHealthState(value: unknown): value is AiProviderHealthState {
  return typeof value === "string" && AI_PROVIDER_HEALTH_STATES.includes(value as AiProviderHealthState);
}

export function resolveHealthState(row: AIProviderResult): AiProviderHealthState {
  return isAiProviderHealthState(row.healthState) ? row.healthState : classifyProviderHealthState(row);
}

export function attachProviderHealthState(row: AIProviderResult): AIProviderResult {
  const healthState = classifyProviderHealthState(row);
  const meta = (row.output?.metadata as Record<string, unknown> | undefined) ?? {};
  const unavailableEvidence = !isConsensusEligibleHealth(healthState);
  return {
    ...row,
    healthState,
    output: row.output
      ? {
          ...row.output,
          metadata: {
            ...meta,
            healthState,
            unavailableEvidence,
            expertEvidenceState: unavailableEvidence ? "UNAVAILABLE_EVIDENCE" : "AVAILABLE",
          },
        }
      : undefined,
  };
}

export function buildProviderHealthRecord(
  row: AIProviderResult,
  startedAt: string,
  lane?: string,
  retryCount = 0,
): AiProviderHealthRecord {
  const healthState = resolveHealthState(row);
  return {
    provider: row.providerId,
    requestId: `${row.providerId}:${lane ?? "lane"}:${startedAt}`,
    startedAt,
    endedAt: new Date().toISOString(),
    latencyMs: row.latencyMs,
    healthState,
    errorCode: row.error ?? row.failureCategory ?? undefined,
    retryCount,
    responseReceived: Boolean(row.ok && row.output),
    lane,
  };
}

export function evaluateProviderHealthGate(
  laneResults: AIProviderResult[],
  startedAt = new Date().toISOString(),
): AiProviderHealthEvaluation {
  const annotated = laneResults.map((row) => attachProviderHealthState(row));
  const records = annotated.map((row, index) =>
    buildProviderHealthRecord(row, startedAt, ["technical", "momentum", "risk"][index], 0),
  );
  const counts = emptyCounts();
  for (const row of annotated) {
    const state = resolveHealthState(row);
    counts[state] += 1;
  }

  const healthyCount = counts.HEALTHY;
  const degradedCount = counts.DEGRADED;
  const unavailableCount =
    counts.UNAVAILABLE + counts.TIMEOUT + counts.INVALID_RESPONSE + counts.RATE_LIMITED + counts.ABORTED;
  const eligibleForConsensus = annotated.filter((row) => isConsensusEligibleHealth(resolveHealthState(row)));

  let gate: AiProviderHealthGate = "ALL_DEGRADED";
  if (healthyCount > 0 && degradedCount === 0 && unavailableCount === 0) gate = "ALL_HEALTHY";
  else if (healthyCount > 0) gate = "PARTIAL_DEGRADATION";
  else if (eligibleForConsensus.length > 0) gate = "PARTIAL_DEGRADATION";

  let aiPath: AiPathClassification = "RELIABILITY_FAILURE";
  if (gate === "ALL_HEALTHY") aiPath = "NORMAL";
  else if (gate === "PARTIAL_DEGRADATION") aiPath = "PARTIAL_DEGRADED";
  else aiPath = "ALL_DEGRADED";

  const telemetry = {
    aiProviderHealth: gate,
    aiProviderHealthCounts: counts,
    aiDegradedCount: degradedCount,
    aiTimeoutCount: counts.TIMEOUT,
    aiUnavailableCount: unavailableCount,
    aiInvalidResponseCount: counts.INVALID_RESPONSE,
    aiRetryCount: records.reduce((acc, row) => acc + (row.retryCount ?? 0), 0),
    aiAllProvidersDegradedCount: gate === "ALL_DEGRADED" ? annotated.length : 0,
  };

  return {
    gate,
    aiPath,
    records,
    counts,
    eligibleForConsensus,
    telemetry,
  };
}

export function buildAllProvidersDegradedConsensusResult(input: {
  symbol: string;
  outputs: AIProviderResult[];
  health: AiProviderHealthEvaluation;
  generatedAt?: string;
}) {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  return {
    finalDecision: "NO_TRADE" as const,
    finalConfidence: 0,
    finalRiskScore: 100,
    score: 0,
    explanation: `AI_PROVIDER_DEGRADED: all lane providers unavailable/degraded; consensus suppressed (${input.health.gate})`,
    outputs: input.outputs,
    rejected: true,
    rejectReason: "AI_PROVIDER_DEGRADED",
    generatedAt,
    consensusTelemetry: {
      ...input.health.telemetry,
      aiPath: input.health.aiPath,
    },
  };
}

export function consensusVoteLabel(row: AIProviderResult): string {
  const state = resolveHealthState(row);
  if (!isConsensusEligibleHealth(state)) return "UNAVAILABLE_EVIDENCE";
  return row.output?.decision ?? "UNKNOWN";
}
