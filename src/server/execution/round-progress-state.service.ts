import { resolveRoundWatchdogStaleMs } from "@/src/server/execution/cooperative-async.service";
import type { RoundRuntimeSnapshot } from "@/src/server/execution/round-runtime.types";

export type RoundProgressState =
  | "ACTIVE_PROGRESS"
  | "SCANNER_ACTIVE"
  | "AI_ACTIVE"
  | "TDI_ACTIVE"
  | "HEARTBEAT_ONLY"
  | "DEPENDENCY_DEGRADED"
  | "WAITING_FOR_RETRY"
  | "WAITING_FOR_PROVIDER"
  | "WAITING_FOR_DB"
  | "TERMINALIZING"
  | "BUDGET_EXCEEDED"
  | "STALLED"
  | "FAILED";

export type RoundProgressAssessment = {
  progressState: RoundProgressState;
  reasonCode: string;
  reasonDetail: string;
  heartbeatAt: string | null;
  lastProgressAt: string | null;
  heartbeatAgeMs: number;
  progressAgeMs: number;
  stallElapsedMs: number;
  elapsedMs: number;
  selectionBudgetMs: number;
  selectionBudgetRemainingMs: number;
  stallThresholdMs: number;
  progressStaleThresholdMs: number;
  possiblyHungGraceMs: number;
  evidence: Record<string, unknown>;
};

function parseIsoMs(value: string | undefined | null) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function resolvePossiblyHungGraceMs(stallThresholdMs: number, selectionBudgetMs: number) {
  return Math.min(
    Math.max(60_000, stallThresholdMs),
    Math.max(90_000, Math.floor(selectionBudgetMs * 0.15)),
  );
}

function resolveProgressStaleThresholdMs(stallThresholdMs: number, selectionBudgetMs: number) {
  return Math.min(
    Math.max(120_000, stallThresholdMs),
    Math.max(180_000, Math.floor(selectionBudgetMs * 0.35)),
  );
}

function hasMeaningfulProgressSignals(runtime: RoundRuntimeSnapshot) {
  const processed = Number(runtime.candidatesProcessed ?? 0);
  const aiProcessed = Number(runtime.aiProcessed ?? 0);
  const scannerTotal = Number(runtime.scannerTotal ?? 0);
  const pumpProcessed = Number(runtime.pumpProcessed ?? 0);
  const intraRoundPct = Number(runtime.intraRoundPct ?? runtime.progressBreakdown?.intraRound ?? 0);
  return (
    processed > 0 ||
    aiProcessed > 0 ||
    pumpProcessed > 0 ||
    scannerTotal > 0 ||
    intraRoundPct >= 5
  );
}

export function assessRoundProgressState(input: {
  runtime: RoundRuntimeSnapshot | null | undefined;
  selectionBudgetMs?: number;
  selectionStartedAt?: number;
  nowMs?: number;
}): RoundProgressAssessment {
  const nowMs = input.nowMs ?? Date.now();
  const runtime = input.runtime ?? null;
  const selectionBudgetMs = Math.max(
    60_000,
    Number(runtime?.selectionBudgetMs ?? input.selectionBudgetMs ?? 0) || 1_200_000,
  );
  const selectionStartedAt =
    typeof input.selectionStartedAt === "number"
      ? input.selectionStartedAt
      : runtime?.elapsedMs != null
        ? nowMs - Number(runtime.elapsedMs)
        : nowMs;
  const elapsedMs = Math.max(0, nowMs - selectionStartedAt);
  const selectionBudgetRemainingMs = Math.max(0, selectionBudgetMs - elapsedMs);
  const stallThresholdMs = resolveRoundWatchdogStaleMs();
  const progressStaleThresholdMs = resolveProgressStaleThresholdMs(stallThresholdMs, selectionBudgetMs);
  const possiblyHungGraceMs = resolvePossiblyHungGraceMs(stallThresholdMs, selectionBudgetMs);

  const heartbeatAt = runtime?.heartbeatAt ?? null;
  const lastProgressAt =
    runtime?.lastMeaningfulProgressAt ??
    runtime?.lastProgressAt ??
    heartbeatAt;
  const heartbeatAgeMs = heartbeatAt ? Math.max(0, nowMs - (parseIsoMs(heartbeatAt) ?? nowMs)) : Number.POSITIVE_INFINITY;
  const progressAgeMs = lastProgressAt ? Math.max(0, nowMs - (parseIsoMs(lastProgressAt) ?? nowMs)) : heartbeatAgeMs;
  const stallElapsedMs = Math.max(heartbeatAgeMs, progressAgeMs);
  const meaningfulProgress = runtime ? hasMeaningfulProgressSignals(runtime) : false;
  const dependencyDegraded =
    Number(runtime?.marketDataFailures ?? 0) > 0 ||
    Number(runtime?.dbTransientFailures ?? 0) > 0 ||
    Number(runtime?.fallbackCount ?? 0) > 0;
  const step = String(runtime?.step ?? "");
  const message = String(runtime?.message ?? "").toLowerCase();

  const evidence = {
    step: runtime?.step ?? null,
    selectionAttempt: runtime?.selectionAttempt ?? null,
    candidatesProcessed: runtime?.candidatesProcessed ?? 0,
    aiProcessed: runtime?.aiProcessed ?? 0,
    aiTotal: runtime?.aiTotal ?? 0,
    scannerTotal: runtime?.scannerTotal ?? 0,
    intraRoundPct: runtime?.intraRoundPct ?? null,
    currentPipeline: runtime?.currentPipeline ?? null,
    meaningfulProgress,
    dependencyDegraded,
    lastMeaningfulProgressAt: runtime?.lastMeaningfulProgressAt ?? null,
    lastRawProgressAt: runtime?.lastProgressAt ?? null,
  };

  if (elapsedMs >= selectionBudgetMs) {
    return {
      progressState: "BUDGET_EXCEEDED",
      reasonCode: "SELECTION_BUDGET_EXCEEDED",
      reasonDetail: `Selection budget elapsed (${Math.floor(elapsedMs / 1000)}s >= ${Math.floor(selectionBudgetMs / 1000)}s)`,
      heartbeatAt,
      lastProgressAt,
      heartbeatAgeMs,
      progressAgeMs,
      stallElapsedMs,
      elapsedMs,
      selectionBudgetMs,
      selectionBudgetRemainingMs: 0,
      stallThresholdMs,
      progressStaleThresholdMs,
      possiblyHungGraceMs,
      evidence,
    };
  }

  if (step === "ROUND_COMPLETED" || step === "ROUND_FAILED" || step === "TIMEOUT") {
    return {
      progressState: "TERMINALIZING",
      reasonCode: "ROUND_TERMINALIZING",
      reasonDetail: `Round terminal transition in progress (${step})`,
      heartbeatAt,
      lastProgressAt,
      heartbeatAgeMs,
      progressAgeMs,
      stallElapsedMs,
      elapsedMs,
      selectionBudgetMs,
      selectionBudgetRemainingMs,
      stallThresholdMs,
      progressStaleThresholdMs,
      possiblyHungGraceMs,
      evidence,
    };
  }

  if (
    message.includes("retry") &&
    heartbeatAgeMs < stallThresholdMs &&
    progressAgeMs < progressStaleThresholdMs + possiblyHungGraceMs
  ) {
    return {
      progressState: "WAITING_FOR_RETRY",
      reasonCode: "DEPENDENCY_RETRY_IN_PROGRESS",
      reasonDetail: "Bounded retry loop is active and still within watchdog threshold",
      heartbeatAt,
      lastProgressAt,
      heartbeatAgeMs,
      progressAgeMs,
      stallElapsedMs,
      elapsedMs,
      selectionBudgetMs,
      selectionBudgetRemainingMs,
      stallThresholdMs,
      progressStaleThresholdMs,
      possiblyHungGraceMs,
      evidence,
    };
  }

  if (
    (message.includes("provider") || message.includes("consensus")) &&
    step === "AI_ANALYSIS" &&
    heartbeatAgeMs < stallThresholdMs &&
    progressAgeMs < progressStaleThresholdMs + possiblyHungGraceMs
  ) {
    return {
      progressState: "WAITING_FOR_PROVIDER",
      reasonCode: "PROVIDER_WAIT_IN_PROGRESS",
      reasonDetail: "AI provider wait in progress with fresh heartbeat",
      heartbeatAt,
      lastProgressAt,
      heartbeatAgeMs,
      progressAgeMs,
      stallElapsedMs,
      elapsedMs,
      selectionBudgetMs,
      selectionBudgetRemainingMs,
      stallThresholdMs,
      progressStaleThresholdMs,
      possiblyHungGraceMs,
      evidence,
    };
  }

  if (
    Number(runtime?.dbTransientFailures ?? 0) > 0 &&
    heartbeatAgeMs < stallThresholdMs &&
    progressAgeMs < progressStaleThresholdMs + possiblyHungGraceMs
  ) {
    return {
      progressState: "WAITING_FOR_DB",
      reasonCode: "DB_WAIT_DEGRADED",
      reasonDetail: "DB degraded path is active with bounded retries",
      heartbeatAt,
      lastProgressAt,
      heartbeatAgeMs,
      progressAgeMs,
      stallElapsedMs,
      elapsedMs,
      selectionBudgetMs,
      selectionBudgetRemainingMs,
      stallThresholdMs,
      progressStaleThresholdMs,
      possiblyHungGraceMs,
      evidence,
    };
  }

  if (progressAgeMs < stallThresholdMs && (meaningfulProgress || runtime?.step)) {
    const state =
      step === "AI_ANALYSIS"
        ? "AI_ACTIVE"
        : step === "SCANNING" || step === "FULL_SCAN" || step === "PUMP_SCAN" || step === "PUMP_CONFIRMATION"
          ? "SCANNER_ACTIVE"
          : step === "SYMBOL_SELECTED"
            ? "TDI_ACTIVE"
            : "ACTIVE_PROGRESS";
    return {
      progressState: state,
      reasonCode: "PROGRESS_ADVANCING",
      reasonDetail: "Recent progress within stall threshold while selection budget remains",
      heartbeatAt,
      lastProgressAt,
      heartbeatAgeMs,
      progressAgeMs,
      stallElapsedMs,
      elapsedMs,
      selectionBudgetMs,
      selectionBudgetRemainingMs,
      stallThresholdMs,
      progressStaleThresholdMs,
      possiblyHungGraceMs,
      evidence,
    };
  }

  if (
    dependencyDegraded &&
    heartbeatAgeMs < stallThresholdMs &&
    progressAgeMs >= progressStaleThresholdMs &&
    progressAgeMs < progressStaleThresholdMs + possiblyHungGraceMs
  ) {
    return {
      progressState: "DEPENDENCY_DEGRADED",
      reasonCode: "DEPENDENCY_DEGRADED_RETRYING",
      reasonDetail: "External dependency degraded; bounded retries/fallback still active",
      heartbeatAt,
      lastProgressAt,
      heartbeatAgeMs,
      progressAgeMs,
      stallElapsedMs,
      elapsedMs,
      selectionBudgetMs,
      selectionBudgetRemainingMs,
      stallThresholdMs,
      progressStaleThresholdMs,
      possiblyHungGraceMs,
      evidence,
    };
  }

  if (heartbeatAgeMs < stallThresholdMs && progressAgeMs >= progressStaleThresholdMs) {
    if (progressAgeMs >= progressStaleThresholdMs + possiblyHungGraceMs) {
      return {
        progressState: "STALLED",
        reasonCode: "MEANINGFUL_PROGRESS_STALE",
        reasonDetail: `Heartbeat stayed fresh but meaningful progress exceeded grace window (${Math.floor(progressAgeMs / 1000)}s)`,
        heartbeatAt,
        lastProgressAt,
        heartbeatAgeMs,
        progressAgeMs,
        stallElapsedMs,
        elapsedMs,
        selectionBudgetMs,
        selectionBudgetRemainingMs,
        stallThresholdMs,
        progressStaleThresholdMs,
        possiblyHungGraceMs,
        evidence,
      };
    }
    return {
      progressState: "HEARTBEAT_ONLY",
      reasonCode: "HEARTBEAT_WITHOUT_RECENT_PROGRESS",
      reasonDetail: "Heartbeat fresh but forward progress has not advanced recently",
      heartbeatAt,
      lastProgressAt,
      heartbeatAgeMs,
      progressAgeMs,
      stallElapsedMs,
      elapsedMs,
      selectionBudgetMs,
      selectionBudgetRemainingMs,
      stallThresholdMs,
      progressStaleThresholdMs,
      possiblyHungGraceMs,
      evidence,
    };
  }

  if (stallElapsedMs >= stallThresholdMs && selectionBudgetRemainingMs > 0) {
    return {
      progressState: "STALLED",
      reasonCode: "NO_PROGRESS_TIMEOUT",
      reasonDetail: `No heartbeat/progress within stall threshold (${Math.floor(stallThresholdMs / 1000)}s)`,
      heartbeatAt,
      lastProgressAt,
      heartbeatAgeMs,
      progressAgeMs,
      stallElapsedMs,
      elapsedMs,
      selectionBudgetMs,
      selectionBudgetRemainingMs,
      stallThresholdMs,
      progressStaleThresholdMs,
      possiblyHungGraceMs,
      evidence,
    };
  }

  return {
    progressState: "ACTIVE_PROGRESS",
    reasonCode: "WITHIN_SELECTION_BUDGET",
    reasonDetail: "Selection still within configured budget",
    heartbeatAt,
    lastProgressAt,
    heartbeatAgeMs,
    progressAgeMs,
    stallElapsedMs,
    elapsedMs,
    selectionBudgetMs,
    selectionBudgetRemainingMs,
    stallThresholdMs,
    progressStaleThresholdMs,
    possiblyHungGraceMs,
    evidence,
  };
}

export function shouldBlockRecoveryRestart(assessment: RoundProgressAssessment) {
  return (
    assessment.progressState === "ACTIVE_PROGRESS" ||
    assessment.progressState === "SCANNER_ACTIVE" ||
    assessment.progressState === "AI_ACTIVE" ||
    assessment.progressState === "TDI_ACTIVE" ||
    assessment.progressState === "HEARTBEAT_ONLY" ||
    assessment.progressState === "DEPENDENCY_DEGRADED" ||
    assessment.progressState === "WAITING_FOR_RETRY" ||
    assessment.progressState === "WAITING_FOR_PROVIDER" ||
    assessment.progressState === "WAITING_FOR_DB" ||
    assessment.progressState === "TERMINALIZING"
  );
}

export function mapProgressStateToRecoveryDecision(input: {
  assessment: RoundProgressAssessment;
  proposedAction: string;
}): { recoveryDecision: string; reasonCode: string } {
  if (shouldBlockRecoveryRestart(input.assessment)) {
    return {
      recoveryDecision: "CONTINUE",
      reasonCode: input.assessment.reasonCode,
    };
  }
  if (input.proposedAction === "RESTART_CURRENT_STAGE" || input.proposedAction === "FAIL_CURRENT_ROUND") {
    return {
      recoveryDecision: input.proposedAction,
      reasonCode: input.assessment.reasonCode,
    };
  }
  return {
    recoveryDecision: input.proposedAction || "CONTINUE",
    reasonCode: input.assessment.reasonCode,
  };
}
