import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";
import { resolveRoundWatchdogStaleMs } from "@/src/server/execution/cooperative-async.service";
import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";
import { classifyRoundTerminalReason } from "@/src/server/forensics/round-terminal-classification.service";

export type RoundWatchdogAction = "NONE" | "RETRY" | "FAIL_ROUND" | "ESCALATE" | "STOP_SESSION";

export type RoundWatchdogRecord = {
  roundId: string;
  runId?: string;
  jobId?: string;
  lastProgressAt: string;
  lastHeartbeatAt?: string;
  currentStage?: string;
  currentCandidate?: string;
  elapsedSinceProgressMs: number;
  elapsedSinceHeartbeatMs?: number;
  decision: RoundWatchdogAction;
  action: string;
  reasonDetail: string;
  recordedAt: string;
};

const watchdogLog: RoundWatchdogRecord[] = [];

export function resolveRoundProgressStaleMs() {
  return Math.max(60_000, resolveRoundWatchdogStaleMs());
}

const LONG_RUNNING_STAGES = new Set(["POSITION_MONITORING", "POSITION_OPEN", "EXECUTING"]);

export function evaluateRoundProgressStall(input: {
  roundId: string;
  runId?: string;
  jobId?: string;
  lastProgressAt?: string;
  lastHeartbeatAt?: string;
  currentStage?: string;
  currentCandidate?: string;
  workerAlive?: boolean;
}) {
  const now = Date.now();
  const progressAt = input.lastProgressAt ? new Date(input.lastProgressAt).getTime() : 0;
  const heartbeatAt = input.lastHeartbeatAt ? new Date(input.lastHeartbeatAt).getTime() : progressAt;
  const elapsedSinceProgressMs = progressAt > 0 ? now - progressAt : 0;
  const elapsedSinceHeartbeatMs = heartbeatAt > 0 ? now - heartbeatAt : elapsedSinceProgressMs;
  const progressStaleMs = resolveRoundProgressStaleMs();
  const heartbeatStaleMs = resolveRoundWatchdogStaleMs();

  if (input.currentStage && LONG_RUNNING_STAGES.has(input.currentStage)) {
    return buildRecord(input, elapsedSinceProgressMs, elapsedSinceHeartbeatMs, "NONE", "Legitimate long-running stage", "Monitoring active position");
  }

  if (input.workerAlive === false) {
    return buildRecord(input, elapsedSinceProgressMs, elapsedSinceHeartbeatMs, "FAIL_ROUND", STALL_ERROR_CODES.ROUND_STALLED, "Worker not alive");
  }

  if (progressAt > 0 && elapsedSinceProgressMs >= progressStaleMs) {
    if (elapsedSinceHeartbeatMs < heartbeatStaleMs) {
      return buildRecord(
        input,
        elapsedSinceProgressMs,
        elapsedSinceHeartbeatMs,
        "FAIL_ROUND",
        STALL_ERROR_CODES.ROUND_STALLED,
        `No stage progress for ${Math.floor(elapsedSinceProgressMs / 1000)}s while heartbeat continued`,
      );
    }
    return buildRecord(
      input,
      elapsedSinceProgressMs,
      elapsedSinceHeartbeatMs,
      "ESCALATE",
      STALL_ERROR_CODES.ROUND_STALLED,
      `Progress and heartbeat stale (${Math.floor(elapsedSinceProgressMs / 1000)}s)`,
    );
  }

  return buildRecord(input, elapsedSinceProgressMs, elapsedSinceHeartbeatMs, "NONE", "Progress within threshold", "No action");
}

function buildRecord(
  input: {
    roundId: string;
    runId?: string;
    jobId?: string;
    lastProgressAt?: string;
    lastHeartbeatAt?: string;
    currentStage?: string;
    currentCandidate?: string;
  },
  elapsedSinceProgressMs: number,
  elapsedSinceHeartbeatMs: number,
  decision: RoundWatchdogAction,
  action: string,
  reasonDetail: string,
): RoundWatchdogRecord {
  return {
    roundId: input.roundId,
    runId: input.runId,
    jobId: input.jobId,
    lastProgressAt: input.lastProgressAt ?? new Date().toISOString(),
    lastHeartbeatAt: input.lastHeartbeatAt,
    currentStage: input.currentStage,
    currentCandidate: input.currentCandidate,
    elapsedSinceProgressMs,
    elapsedSinceHeartbeatMs,
    decision,
    action,
    reasonDetail,
    recordedAt: new Date().toISOString(),
  };
}

export function recordRoundWatchdogDecision(record: RoundWatchdogRecord) {
  watchdogLog.push(record);
  if (watchdogLog.length > 200) watchdogLog.shift();
  return record;
}

export function getRoundWatchdogLog(limit = 50) {
  return watchdogLog.slice(-limit);
}

export function writeRoundWatchdogArtifact(input: { sessionId: string; roundId: string; record?: RoundWatchdogRecord }) {
  const root = path.join(process.cwd(), "artifacts", "forensics", input.sessionId, "rounds", input.roundId);
  mkdirSync(root, { recursive: true });
  const payload = input.record ?? getRoundWatchdogLog(20).filter((row) => row.roundId === input.roundId).slice(-1)[0] ?? {
    roundId: input.roundId,
    lastProgressAt: new Date().toISOString(),
    elapsedSinceProgressMs: 0,
    decision: "NONE" as const,
    action: "NONE",
    reasonDetail: "No watchdog evaluation recorded",
    recordedAt: new Date().toISOString(),
  };
  const filePath = path.join(root, "round-watchdog.json");
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return filePath;
}

export function writeRoundLivenessArtifact(input: {
  sessionId: string;
  roundId: string;
  nowIso: string;
  currentStage?: string;
  runtime?: Record<string, unknown>;
  watchdog?: Record<string, unknown>;
}) {
  const root = path.join(process.cwd(), "artifacts", "forensics", input.sessionId, "rounds", input.roundId);
  mkdirSync(root, { recursive: true });
  const runtime = input.runtime ?? {};
  const watchdog = input.watchdog ?? {};
  const nowMs = Date.now();
  const heartbeatAtRaw = runtime.heartbeatAt ? String(runtime.heartbeatAt) : null;
  const meaningfulAtRaw =
    runtime.lastMeaningfulProgressAt ? String(runtime.lastMeaningfulProgressAt) : runtime.lastProgressAt ? String(runtime.lastProgressAt) : null;
  const heartbeatAtMs = heartbeatAtRaw ? new Date(heartbeatAtRaw).getTime() : Number.NaN;
  const meaningfulAtMs = meaningfulAtRaw ? new Date(meaningfulAtRaw).getTime() : Number.NaN;
  const heartbeatAgeMs = Number.isFinite(heartbeatAtMs) ? Math.max(0, nowMs - heartbeatAtMs) : null;
  const meaningfulProgressAgeMs = Number.isFinite(meaningfulAtMs) ? Math.max(0, nowMs - meaningfulAtMs) : null;
  const terminalState = (runtime.step as string | undefined) ?? null;
  const livenessPath = path.join(root, "round-liveness.json");
  const livenessPayload = {
    state: String((watchdog as Record<string, unknown>).progressState ?? "UNKNOWN"),
    currentStage: input.currentStage ?? null,
    lastMeaningfulProgressAt: meaningfulAtRaw,
    meaningfulProgressAgeMs,
    lastHeartbeatAt: heartbeatAtRaw,
    heartbeatAgeMs,
    activeWork: {
      scanner: Number(runtime.scannerSymbolsProcessed ?? runtime.candidatesProcessed ?? 0),
      ai: Number(runtime.aiProcessed ?? 0),
      marketData: Number(runtime.marketDataRequests ?? 0),
    },
    activeRetries: Number(runtime.retryCount ?? 0),
    activeCandidates: Number(runtime.candidatesRemaining ?? 0),
    poolActive: Number(runtime.poolActive ?? 0),
    poolQueued: Number(runtime.poolQueued ?? 0),
    remainingBudgetMs: Number((watchdog as Record<string, unknown>).selectionBudgetRemainingMs ?? runtime.estimatedRemainingMs ?? 0),
    abortRequested: Boolean(runtime.cancelled ?? false),
    abortReason: runtime.cancelReason ?? null,
    stallDetectedAt:
      (watchdog as Record<string, unknown>).reasonCode === "NO_PROGRESS_TIMEOUT" ||
      (watchdog as Record<string, unknown>).reasonCode === "MEANINGFUL_PROGRESS_STALE"
        ? input.nowIso
        : null,
    terminalizationStartedAt:
      terminalState === "TIMEOUT" || terminalState === "ROUND_FAILED" || terminalState === "ROUND_COMPLETED" ? input.nowIso : null,
    terminalState,
    terminalizationDurationMs:
      terminalState === "TIMEOUT" || terminalState === "ROUND_FAILED" || terminalState === "ROUND_COMPLETED"
        ? Math.max(0, Number(runtime.elapsedMs ?? 0) - Number(runtime.selectionBudgetMs ?? 0))
        : null,
  };
  writeFileSync(livenessPath, `${JSON.stringify(livenessPayload, null, 2)}\n`, "utf8");
  return livenessPath;
}

export function writeRoundHangSnapshotArtifact(input: {
  sessionId: string;
  roundId: string;
  nowIso: string;
  runId?: string;
  jobId?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  terminalReason?: string | null;
  terminalReasonCode?: string | null;
  currentStage?: string;
  currentCandidate?: string;
  runtime?: Record<string, unknown>;
  watchdog?: Record<string, unknown>;
  activeRetries?: number;
  activeAI?: number;
  activeScannerWork?: number;
  activePumpWork?: number;
  activeDbWork?: number;
  activeDBWork?: number;
  recoveryState?: Record<string, unknown>;
  refs?: {
    selectionTimeBudgetBreakdownRef?: string | null;
    roundLivenessRef?: string | null;
    recoveryTelemetryRef?: string | null;
  };
}) {
  const root = path.join(process.cwd(), "artifacts", "forensics", input.sessionId, "rounds", input.roundId);
  mkdirSync(root, { recursive: true });
  const filePath = path.join(root, "round-hang-snapshot.json");
  const runtime = input.runtime ?? {};
  const watchdog = input.watchdog ?? {};
  const nowMs = Date.now();
  const heartbeatAtRaw = runtime.heartbeatAt ? String(runtime.heartbeatAt) : null;
  const meaningfulAtRaw =
    runtime.lastMeaningfulProgressAt ? String(runtime.lastMeaningfulProgressAt) : runtime.lastProgressAt ? String(runtime.lastProgressAt) : null;
  const heartbeatAtMs = heartbeatAtRaw ? new Date(heartbeatAtRaw).getTime() : Number.NaN;
  const meaningfulAtMs = meaningfulAtRaw ? new Date(meaningfulAtRaw).getTime() : Number.NaN;
  const heartbeatAgeMs = Number.isFinite(heartbeatAtMs) ? Math.max(0, nowMs - heartbeatAtMs) : null;
  const meaningfulProgressAgeMs = Number.isFinite(meaningfulAtMs) ? Math.max(0, nowMs - meaningfulAtMs) : null;
  const selectionBudgetMs = Number(runtime.selectionBudgetMs ?? 0);
  const selectionElapsedMs = Number(runtime.elapsedMs ?? 0);
  const { terminalClass } = classifyRoundTerminalReason({
    reason: input.terminalReason,
    reasonCode: input.terminalReasonCode,
    currentStage: input.currentStage ?? String(runtime.step ?? ""),
  });
  const payload = {
    schemaVersion: "hang-snapshot-v1",
    roundId: input.roundId,
    runId: input.runId ?? null,
    jobId: input.jobId ?? input.sessionId,
    sessionId: input.sessionId,
    terminalReason: input.terminalReason ?? String((watchdog as Record<string, unknown>).reasonDetail ?? ""),
    terminalReasonCode: input.terminalReasonCode ?? String((watchdog as Record<string, unknown>).reasonCode ?? ""),
    terminalClass,
    currentStage: input.currentStage ?? String(runtime.step ?? "UNKNOWN"),
    currentCandidate: input.currentCandidate ?? null,
    startedAt: runtime.startedAt ? String(runtime.startedAt) : input.startedAt ?? null,
    snapshotAt: input.nowIso,
    endedAt: input.endedAt ?? null,
    selectionBudgetMs,
    selectionElapsedMs,
    remainingBudgetMs: Math.max(0, Number(runtime.estimatedRemainingMs ?? selectionBudgetMs - selectionElapsedMs)),
    lastMeaningfulProgressAt: meaningfulAtRaw,
    meaningfulProgressAgeMs,
    lastHeartbeatAt: heartbeatAtRaw,
    heartbeatAgeMs,
    lastScannerProgressAt: runtime.lastScannerProgressAt ? String(runtime.lastScannerProgressAt) : null,
    lastMarketDataProgressAt: runtime.lastMarketDataProgressAt ? String(runtime.lastMarketDataProgressAt) : null,
    lastPumpProgressAt: runtime.lastPumpProgressAt ? String(runtime.lastPumpProgressAt) : null,
    lastAIProgressAt: runtime.lastAIProgressAt ? String(runtime.lastAIProgressAt) : null,
    lastTDIProgressAt: runtime.lastTDIProgressAt ? String(runtime.lastTDIProgressAt) : null,
    lastPersistAt: runtime.lastPersistAt ? String(runtime.lastPersistAt) : null,
    activeCandidates: Number(runtime.candidatesRemaining ?? 0),
    activeAI: input.activeAI ?? Number(runtime.aiProcessed ?? 0),
    activeScannerWork: input.activeScannerWork ?? Number(runtime.scannerSymbolsProcessed ?? 0),
    activePumpWork: input.activePumpWork ?? Number(runtime.pumpProcessed ?? 0),
    activeDBWork: input.activeDBWork ?? input.activeDbWork ?? Number(runtime.dbTransientFailures ?? 0),
    poolActive: Number(runtime.poolActive ?? 0),
    poolQueued: Number(runtime.poolQueued ?? 0),
    retryCount: Number(runtime.retryCount ?? 0),
    activeRetries: input.activeRetries ?? Number(runtime.retryCount ?? 0),
    watchdogState: String((watchdog as Record<string, unknown>).progressState ?? "UNKNOWN"),
    watchdogDecision: String((watchdog as Record<string, unknown>).decision ?? "UNKNOWN"),
    recoveryState: {
      recoveryDecision: (input.recoveryState as Record<string, unknown> | undefined)?.recoveryDecision ?? null,
      reasonCode: (input.recoveryState as Record<string, unknown> | undefined)?.reasonCode ?? null,
      progressState: (input.recoveryState as Record<string, unknown> | undefined)?.progressState ?? null,
      retryCount: Number((input.recoveryState as Record<string, unknown> | undefined)?.recoveryCount ?? 0),
    },
    abortRequested: Boolean(runtime.cancelled ?? false),
    abortReason: runtime.cancelReason ?? null,
    terminalizationStartedAt:
      runtime.terminalizationStartedAt != null
        ? String(runtime.terminalizationStartedAt)
        : terminalClass === "ABNORMAL_RUNTIME_TERMINAL"
          ? input.nowIso
          : null,
    terminalizationDurationMs: Number(runtime.terminalizationDurationMs ?? 0) || null,
    dbTransientFailures: Number(runtime.dbTransientFailures ?? 0),
    marketDataFailures: Number(runtime.marketDataFailures ?? 0),
    fallbackCount: Number(runtime.fallbackCount ?? 0),
    selectionTimeBudgetBreakdownRef:
      input.refs?.selectionTimeBudgetBreakdownRef ?? "selectionTimeBudgetBreakdown.json",
    roundLivenessRef: input.refs?.roundLivenessRef ?? "round-liveness.json",
    recoveryTelemetryRef: input.refs?.recoveryTelemetryRef ?? "recovery-telemetry.json",
  };
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  writeRoundLivenessArtifact({
    sessionId: input.sessionId,
    roundId: input.roundId,
    nowIso: input.nowIso,
    currentStage: input.currentStage,
    runtime: {
      ...runtime,
      scannerSymbolsProcessed: payload.activeScannerWork,
      aiProcessed: payload.activeAI,
      candidatesRemaining: payload.activeCandidates,
      retryCount: payload.activeRetries,
    },
    watchdog,
  });
  return filePath;
}

const hangSnapshotRegistry = new Map<string, string>();

function digestStack(error: Error) {
  return createHash("sha256").update(error.stack ?? error.message).digest("hex").slice(0, 16);
}

function writeHangSnapshotExportError(input: {
  sessionId: string;
  roundId: string;
  reason: string;
  error: Error;
}) {
  try {
    const root = path.join(process.cwd(), "artifacts", "forensics", input.sessionId, "rounds", input.roundId);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      path.join(root, "export-error.json"),
      `${JSON.stringify(
        {
          artifact: "round-hang-snapshot.json",
          roundId: input.roundId,
          reason: input.reason,
          errorType: input.error.name || "EXPORT_FAILED",
          stackDigest: digestStack(input.error),
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch {
    // never block business terminalization for forensic export diagnostics
  }
}

export function ensureRoundHangSnapshotForAbnormalTerminal(input: {
  sessionId: string;
  roundId: string;
  nowIso: string;
  runId?: string;
  jobId?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  terminalReason?: string | null;
  terminalReasonCode?: string | null;
  currentStage?: string;
  currentCandidate?: string;
  runtime?: Record<string, unknown>;
  watchdog?: Record<string, unknown>;
  activeRetries?: number;
  activeAI?: number;
  activeScannerWork?: number;
  activePumpWork?: number;
  activeDBWork?: number;
  recoveryState?: Record<string, unknown>;
}) {
  const classification = classifyRoundTerminalReason({
    reason: input.terminalReason,
    reasonCode: input.terminalReasonCode,
    currentStage: input.currentStage ?? String(input.runtime?.step ?? ""),
  });
  if (classification.terminalClass !== "ABNORMAL_RUNTIME_TERMINAL") {
    return { attempted: false as const, written: false as const, reason: "NORMAL_TERMINAL" };
  }
  const reasonKey = String(input.terminalReasonCode ?? input.terminalReason ?? "UNKNOWN_RUNTIME_TERMINAL").toUpperCase();
  const key = `${input.roundId}::${reasonKey}`;
  if (hangSnapshotRegistry.get(input.roundId) === key) {
    return { attempted: true as const, written: false as const, reason: "IDEMPOTENT_SKIP" };
  }
  const snapshotPath = path.join(
    process.cwd(),
    "artifacts",
    "forensics",
    input.sessionId,
    "rounds",
    input.roundId,
    "round-hang-snapshot.json",
  );
  if (existsSync(snapshotPath)) {
    try {
      const existing = JSON.parse(readFileSync(snapshotPath, "utf8")) as Record<string, unknown>;
      const existingReason = String(existing.terminalReasonCode ?? existing.terminalReason ?? "").toUpperCase();
      if (existingReason === reasonKey) {
        hangSnapshotRegistry.set(input.roundId, key);
        return { attempted: true as const, written: false as const, reason: "EXISTING_MATCH" };
      }
    } catch {
      // parsing failure should not block rewrite attempt
    }
  }
  try {
    writeRoundHangSnapshotArtifact({
      ...input,
      terminalReasonCode: input.terminalReasonCode ?? reasonKey,
      refs: {
        selectionTimeBudgetBreakdownRef: "selectionTimeBudgetBreakdown.json",
        roundLivenessRef: "round-liveness.json",
        recoveryTelemetryRef: "recovery-telemetry.json",
      },
    });
    hangSnapshotRegistry.set(input.roundId, key);
    return { attempted: true as const, written: true as const, reason: "WRITTEN" };
  } catch (error) {
    writeHangSnapshotExportError({
      sessionId: input.sessionId,
      roundId: input.roundId,
      reason: input.terminalReason ?? reasonKey,
      error: error as Error,
    });
    return { attempted: true as const, written: false as const, reason: "EXPORT_FAILED" };
  }
}

export function resolveRoundTerminalBudgetMs() {
  const selectionBudgetSec = Math.max(300, env.AUTO_ROUND_SELECTION_BUDGET_SEC ?? 1200);
  const aiPhaseSec = Math.max(120, env.AUTO_ROUND_AI_PHASE_MAX_SEC ?? 900);
  return (selectionBudgetSec + aiPhaseSec + 300) * 1000;
}
