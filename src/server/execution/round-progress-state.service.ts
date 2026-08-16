import { resolveRoundWatchdogStaleMs } from "@/src/server/execution/cooperative-async.service";
import type { RoundRuntimeSnapshot } from "@/src/server/execution/round-runtime.types";

export type RoundProgressState =
  | "ACTIVE_PROGRESS"
  | "HEARTBEAT_ONLY"
  | "POSSIBLY_HUNG"
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
  const lastProgressAt = runtime?.lastProgressAt ?? heartbeatAt;
  const heartbeatAgeMs = heartbeatAt ? Math.max(0, nowMs - (parseIsoMs(heartbeatAt) ?? nowMs)) : Number.POSITIVE_INFINITY;
  const progressAgeMs = lastProgressAt ? Math.max(0, nowMs - (parseIsoMs(lastProgressAt) ?? nowMs)) : heartbeatAgeMs;
  const stallElapsedMs = Math.max(heartbeatAgeMs, progressAgeMs);
  const meaningfulProgress = runtime ? hasMeaningfulProgressSignals(runtime) : false;

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
  };

  if (elapsedMs >= selectionBudgetMs) {
    return {
      progressState: "FAILED",
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

  if (progressAgeMs < stallThresholdMs && (meaningfulProgress || runtime?.step)) {
    return {
      progressState: "ACTIVE_PROGRESS",
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

  if (heartbeatAgeMs < stallThresholdMs && progressAgeMs >= progressStaleThresholdMs) {
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

  if (
    stallElapsedMs >= progressStaleThresholdMs &&
    stallElapsedMs < progressStaleThresholdMs + possiblyHungGraceMs &&
    selectionBudgetRemainingMs > 0
  ) {
    return {
      progressState: "POSSIBLY_HUNG",
      reasonCode: "PROGRESS_STALL_GRACE",
      reasonDetail: "Progress stalled but still inside bounded grace window before recovery restart",
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
    assessment.progressState === "HEARTBEAT_ONLY" ||
    assessment.progressState === "POSSIBLY_HUNG"
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
