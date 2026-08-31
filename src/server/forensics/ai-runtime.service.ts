import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createCandidateId } from "@/src/server/forensics/forensic-collector.service";
import { traceCandidateFailed } from "@/src/server/forensics/candidate-lifecycle.service";
import { STALL_ERROR_CODES, type StallErrorRecord } from "@/src/server/forensics/stall-error-taxonomy";
import {
  ensureRoundHangSnapshotForAbnormalTerminal,
  writeRoundLivenessArtifact,
} from "@/src/server/forensics/round-progress-watchdog.service";

export type AiCandidateStatus =
  | "STARTED"
  | "COMPLETED"
  | "CANCELLED"
  | "AI_FAILED"
  | "AI_TIMEOUT"
  | "CONSENSUS_FAILED"
  | "CONSENSUS_TIMEOUT";

export type AiCandidateRecord = {
  candidateId: string;
  symbol: string;
  provider?: string;
  model?: string;
  executionMode?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: AiCandidateStatus;
  timeoutMs?: number;
  timeoutAt?: string;
  aborted?: boolean;
  abortReason?: string;
  cancelledAt?: string;
  cancelReason?: string;
  signalPropagated?: boolean;
  retryCount: number;
  consensusStage?: string;
  reasonCode?: string;
  errorType?: string;
  reasonDetail?: string;
};

export type AiBatchProgress = {
  roundId: string;
  runId?: string;
  processed: number;
  total: number;
  currentCandidate?: string;
  currentStage?: string;
  startedAt: string;
  lastProgressAt: string;
  successCount: number;
  failedCount: number;
  timeoutCount: number;
  concurrency: number;
  candidates: AiCandidateRecord[];
};

export type ConsensusAuditRecord = {
  symbol: string;
  candidateId: string;
  consensusStart: string;
  consensusEnd?: string;
  durationMs?: number;
  providerVotes?: Array<{ provider: string; decision?: string; weight?: number }>;
  finalDecision?: string;
  confidence?: number;
  status: "COMPLETED" | "CONSENSUS_TIMEOUT" | "CONSENSUS_FAILED" | "AI_PROVIDER_DEGRADED";
  reasonDetail?: string;
};

const batchByRound = new Map<string, AiBatchProgress>();
const consensusAudits: ConsensusAuditRecord[] = [];

function batchKey(roundId: string, runId?: string) {
  return `${roundId}:${runId ?? "default"}`;
}

export function beginAiBatch(input: {
  roundId: string;
  runId?: string;
  total: number;
  concurrency: number;
}) {
  const key = batchKey(input.roundId, input.runId);
  const now = new Date().toISOString();
  const row: AiBatchProgress = {
    roundId: input.roundId,
    runId: input.runId,
    processed: 0,
    total: input.total,
    startedAt: now,
    lastProgressAt: now,
    successCount: 0,
    failedCount: 0,
    timeoutCount: 0,
    concurrency: input.concurrency,
    candidates: [],
  };
  batchByRound.set(key, row);
  return row;
}

export function getAiBatchProgress(roundId: string, runId?: string) {
  return batchByRound.get(batchKey(roundId, runId));
}

export function startAiCandidate(input: {
  roundId: string;
  runId?: string;
  symbol: string;
  stage?: string;
  timeoutMs?: number;
  provider?: string;
  model?: string;
  executionMode?: string;
}) {
  const key = batchKey(input.roundId, input.runId);
  const batch = batchByRound.get(key);
  const startedAt = new Date().toISOString();
  const record: AiCandidateRecord = {
    candidateId: createCandidateId(input.symbol, "ai"),
    symbol: input.symbol.toUpperCase(),
    provider: input.provider,
    model: input.model,
    executionMode: input.executionMode,
    startedAt,
    status: "STARTED",
    timeoutMs: input.timeoutMs,
    retryCount: 0,
    consensusStage: input.stage ?? "ai",
  };
  if (batch) {
    batch.currentCandidate = record.symbol;
    batch.currentStage = input.stage ?? "ai";
    batch.lastProgressAt = startedAt;
    batch.candidates.push(record);
    if (batch.candidates.length > 200) batch.candidates.shift();
  }
  return record;
}

function findOpenCandidate(batch: AiBatchProgress, symbol: string) {
  for (let i = batch.candidates.length - 1; i >= 0; i -= 1) {
    const row = batch.candidates[i];
    if (row.symbol === symbol.toUpperCase() && row.status === "STARTED") return row;
  }
  return undefined;
}

function terminalizeRow(
  row: AiCandidateRecord,
  input: {
    status: AiCandidateStatus;
    reasonCode?: string;
    errorType?: string;
    reasonDetail?: string;
    timeout?: boolean;
    timeoutAt?: string;
    aborted?: boolean;
    abortReason?: string;
    cancelledAt?: string;
    cancelReason?: string;
    signalPropagated?: boolean;
    retryCount?: number;
    consensusStage?: string;
    provider?: string;
    model?: string;
  },
) {
  const completedAt = input.timeoutAt ?? input.cancelledAt ?? new Date().toISOString();
  row.completedAt = completedAt;
  row.durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(row.startedAt).getTime());
  row.status = input.status;
  row.reasonCode = input.reasonCode;
  row.errorType = input.errorType;
  row.reasonDetail = input.reasonDetail;
  row.retryCount = input.retryCount ?? row.retryCount;
  row.consensusStage = input.consensusStage ?? row.consensusStage;
  if (input.provider) row.provider = input.provider;
  if (input.model) row.model = input.model;
  if (input.timeout) {
    row.timeoutAt = input.timeoutAt ?? completedAt;
    row.aborted = input.aborted ?? true;
    row.abortReason = input.abortReason ?? input.reasonDetail;
  }
  if (input.cancelledAt || input.cancelReason) {
    row.cancelledAt = input.cancelledAt ?? completedAt;
    row.cancelReason = input.cancelReason;
    row.signalPropagated = input.signalPropagated ?? true;
    row.aborted = input.aborted ?? true;
    row.abortReason = input.abortReason ?? input.cancelReason;
  }
}

export function completeAiCandidate(input: {
  roundId: string;
  runId?: string;
  symbol: string;
  status?: AiCandidateStatus;
  retryCount?: number;
  consensusStage?: string;
  reasonDetail?: string;
  provider?: string;
  model?: string;
}) {
  const key = batchKey(input.roundId, input.runId);
  const batch = batchByRound.get(key);
  if (!batch) return null;
  const row = findOpenCandidate(batch, input.symbol);
  if (!row) return null;
  const status = input.status ?? "COMPLETED";
  terminalizeRow(row, {
    status,
    reasonDetail: input.reasonDetail,
    retryCount: input.retryCount,
    consensusStage: input.consensusStage,
    provider: input.provider,
    model: input.model,
  });
  batch.processed += 1;
  batch.lastProgressAt = row.completedAt ?? new Date().toISOString();
  if (status === "COMPLETED") batch.successCount += 1;
  else if (status === "AI_TIMEOUT" || status === "CONSENSUS_TIMEOUT") batch.timeoutCount += 1;
  else batch.failedCount += 1;
  return row;
}

export function cancelAiCandidate(input: {
  roundId: string;
  runId?: string;
  symbol: string;
  reasonCode?: string;
  reasonDetail: string;
  cancelledAt?: string;
  signalPropagated?: boolean;
  abortReason?: string;
  provider?: string;
  model?: string;
}) {
  const row = completeAiCandidate({
    roundId: input.roundId,
    runId: input.runId,
    symbol: input.symbol,
    status: "CANCELLED",
    reasonDetail: input.reasonDetail,
    provider: input.provider,
    model: input.model,
  });
  if (!row) return null;
  terminalizeRow(row, {
    status: "CANCELLED",
    reasonCode: input.reasonCode ?? STALL_ERROR_CODES.AI_TIMEOUT,
    errorType: "RoundSelectionAbortError",
    reasonDetail: input.reasonDetail,
    cancelledAt: input.cancelledAt ?? new Date().toISOString(),
    cancelReason: input.reasonDetail,
    signalPropagated: input.signalPropagated ?? true,
    aborted: true,
    abortReason: input.abortReason ?? input.reasonDetail,
  });
  return row;
}

export function failAiCandidate(input: {
  roundId: string;
  runId?: string;
  symbol: string;
  reasonCode: keyof typeof STALL_ERROR_CODES | string;
  errorType: string;
  reasonDetail: string;
  retryCount?: number;
  timeout?: boolean;
  timeoutAt?: string;
  aborted?: boolean;
  abortReason?: string;
  signalPropagated?: boolean;
  provider?: string;
  model?: string;
}) {
  const status: AiCandidateStatus =
    input.reasonCode === STALL_ERROR_CODES.CONSENSUS_TIMEOUT || input.timeout
      ? input.reasonCode === STALL_ERROR_CODES.CONSENSUS_TIMEOUT
        ? "CONSENSUS_TIMEOUT"
        : "AI_TIMEOUT"
      : input.reasonCode === STALL_ERROR_CODES.CONSENSUS_FAILED
        ? "CONSENSUS_FAILED"
        : "AI_FAILED";
  const row = completeAiCandidate({
    roundId: input.roundId,
    runId: input.runId,
    symbol: input.symbol,
    status,
    retryCount: input.retryCount,
    reasonDetail: input.reasonDetail,
    provider: input.provider,
    model: input.model,
  });
  if (row) {
    row.reasonCode = input.reasonCode;
    row.errorType = input.errorType;
    if (input.timeout) {
      row.timeoutAt = input.timeoutAt ?? row.completedAt;
      row.aborted = input.aborted ?? true;
      row.abortReason = input.abortReason ?? input.reasonDetail;
      row.signalPropagated = input.signalPropagated ?? true;
    }
  }
  traceCandidateFailed({
    symbol: input.symbol,
    stage: "ai",
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
    candidateId: row?.candidateId,
  });
  return row;
}

export function terminalizeOpenAiCandidates(input: {
  roundId: string;
  runId?: string;
  reasonCode: string;
  cancelReason: string;
  signalPropagated?: boolean;
}) {
  const batch = getAiBatchProgress(input.roundId, input.runId);
  if (!batch) return [] as AiCandidateRecord[];
  const closed: AiCandidateRecord[] = [];
  const now = new Date().toISOString();
  for (const row of batch.candidates) {
    if (row.status !== "STARTED") continue;
    const isTimeout = input.reasonCode.includes("TIMEOUT") || input.reasonCode.includes("BUDGET");
    terminalizeRow(row, {
      status: isTimeout ? "AI_TIMEOUT" : "CANCELLED",
      reasonCode: input.reasonCode,
      errorType: "RoundSelectionAbortError",
      reasonDetail: input.cancelReason,
      timeout: isTimeout,
      timeoutAt: isTimeout ? now : undefined,
      cancelledAt: now,
      cancelReason: input.cancelReason,
      signalPropagated: input.signalPropagated ?? true,
      aborted: true,
      abortReason: input.cancelReason,
    });
    batch.processed += 1;
    if (isTimeout) batch.timeoutCount += 1;
    else batch.failedCount += 1;
    closed.push(row);
    traceCandidateFailed({
      symbol: row.symbol,
      stage: "ai",
      reasonCode: input.reasonCode,
      reasonDetail: input.cancelReason,
      candidateId: row.candidateId,
    });
  }
  if (closed.length > 0) {
    batch.lastProgressAt = now;
  }
  return closed;
}

export function recordConsensusAudit(input: Omit<ConsensusAuditRecord, "status"> & { status?: ConsensusAuditRecord["status"] }) {
  const row: ConsensusAuditRecord = {
    ...input,
    status: input.status ?? (input.consensusEnd ? "COMPLETED" : "CONSENSUS_FAILED"),
  };
  consensusAudits.push(row);
  if (consensusAudits.length > 500) consensusAudits.shift();
  return row;
}

export function getConsensusAudits(limit = 100) {
  return consensusAudits.slice(-limit);
}

export function resetAiRuntimeState(roundId?: string) {
  if (roundId) {
    for (const key of batchByRound.keys()) {
      if (key.startsWith(`${roundId}:`)) batchByRound.delete(key);
    }
    return;
  }
  batchByRound.clear();
  consensusAudits.length = 0;
}

export function writeAiProgressArtifact(input: { sessionId: string; roundId: string; runId?: string }) {
  const batch = getAiBatchProgress(input.roundId, input.runId);
  if (!batch) return null;
  const root = path.join(process.cwd(), "artifacts", "forensics", input.sessionId, "rounds", input.roundId);
  mkdirSync(root, { recursive: true });
  const filePath = path.join(root, "ai-progress.json");
  writeFileSync(filePath, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
  return filePath;
}

export function writeMinimumAiStallArtifacts(input: {
  sessionId: string;
  roundId: string;
  runId?: string;
  reason: string;
}) {
  const root = path.join(process.cwd(), "artifacts", "forensics", input.sessionId, "rounds", input.roundId);
  mkdirSync(root, { recursive: true });
  const written: string[] = [];
  const nowIso = new Date().toISOString();
  const batch = getAiBatchProgress(input.roundId, input.runId);
  const activeCandidates = Math.max(0, Number(batch?.total ?? 0) - Number(batch?.processed ?? 0));
  const runtimeSnapshot = {
    step: "TIMEOUT",
    message: input.reason,
    heartbeatAt: nowIso,
    lastProgressAt: batch?.lastProgressAt ?? nowIso,
    lastMeaningfulProgressAt: batch?.lastProgressAt ?? nowIso,
    aiProcessed: Number(batch?.processed ?? 0),
    aiTotal: Number(batch?.total ?? 0),
    candidatesRemaining: activeCandidates,
    retryCount: 0,
    selectionBudgetMs: 0,
    elapsedMs: 0,
    cancelled: true,
    cancelReason: input.reason,
  };
  const progressPath = writeAiProgressArtifact(input);
  if (progressPath) written.push("ai-progress.json");
  const tracePath = path.join(root, "ai-trace.json");
  writeFileSync(
    tracePath,
    `${JSON.stringify({ aiCalls: [], stallReason: input.reason, exportedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  written.push("ai-trace.json");
  const watchdogPath = path.join(root, "round-watchdog.json");
  writeFileSync(
    watchdogPath,
    `${JSON.stringify({ decision: "FAIL_ROUND", reason: input.reason, exportedAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  written.push("round-watchdog.json");
  for (const name of ["recovery-decisions.json", "recovery-telemetry.json", "round-summary.json"] as const) {
    const filePath = path.join(root, name);
    writeFileSync(
      filePath,
      `${JSON.stringify({ partial: true, reason: input.reason, exportedAt: nowIso }, null, 2)}\n`,
      "utf8",
    );
    written.push(name);
  }
  const selectionBudgetPath = path.join(root, "selectionTimeBudgetBreakdown.json");
  writeFileSync(
    selectionBudgetPath,
    `${JSON.stringify(
      {
        generatedAt: nowIso,
        partial: true,
        reason: input.reason,
        selectionBudgetMs: 0,
        totalElapsedMs: 0,
        measuredTotalMs: 0,
        PRIMARY_TIME_CONSUMER: "unknown",
        TOP_5_TIME_CONSUMERS: [],
        rows: [],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  written.push("selectionTimeBudgetBreakdown.json");
  writeRoundLivenessArtifact({
    sessionId: input.sessionId,
    roundId: input.roundId,
    nowIso,
    currentStage: "TIMEOUT",
    runtime: runtimeSnapshot,
    watchdog: {
      progressState: "STALLED",
      reasonCode: "NO_PROGRESS_TIMEOUT",
      reasonDetail: input.reason,
      selectionBudgetRemainingMs: 0,
    },
  });
  written.push("round-liveness.json");
  const hangSnapshot = ensureRoundHangSnapshotForAbnormalTerminal({
    sessionId: input.sessionId,
    roundId: input.roundId,
    runId: input.runId,
    jobId: input.sessionId,
    nowIso,
    startedAt: nowIso,
    endedAt: nowIso,
    terminalReason: input.reason,
    terminalReasonCode: STALL_ERROR_CODES.AI_TIMEOUT,
    currentStage: "TIMEOUT",
    currentCandidate: batch?.currentCandidate,
    runtime: runtimeSnapshot,
    watchdog: {
      progressState: "STALLED",
      reasonCode: "NO_PROGRESS_TIMEOUT",
      reasonDetail: input.reason,
      selectionBudgetRemainingMs: 0,
    },
    activeAI: Number(batch?.processed ?? 0),
    activeRetries: 0,
    activeScannerWork: 0,
    activePumpWork: 0,
    activeDBWork: 0,
  });
  if (hangSnapshot.attempted && hangSnapshot.written) {
    written.push("round-hang-snapshot.json");
  }
  return { root, written };
}

export function toStallErrorFromAi(record: AiCandidateRecord): StallErrorRecord {
  return {
    stage: "ai",
    reasonCode:
      record.status === "AI_TIMEOUT"
        ? STALL_ERROR_CODES.AI_TIMEOUT
        : record.status === "CONSENSUS_TIMEOUT"
          ? STALL_ERROR_CODES.CONSENSUS_TIMEOUT
          : record.status === "CONSENSUS_FAILED"
            ? STALL_ERROR_CODES.CONSENSUS_FAILED
            : STALL_ERROR_CODES.AI_FAILED,
    reasonDetail: record.reasonDetail ?? record.errorType ?? record.status,
    timestamp: record.completedAt ?? record.startedAt,
    symbol: record.symbol,
    candidateId: record.candidateId,
  };
}
