import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";
import { resolveRoundWatchdogStaleMs } from "@/src/server/execution/cooperative-async.service";
import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";

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

export function resolveRoundTerminalBudgetMs() {
  const selectionBudgetSec = Math.max(300, env.AUTO_ROUND_SELECTION_BUDGET_SEC ?? 1200);
  const aiPhaseSec = Math.max(120, env.AUTO_ROUND_AI_PHASE_MAX_SEC ?? 900);
  return (selectionBudgetSec + aiPhaseSec + 300) * 1000;
}
