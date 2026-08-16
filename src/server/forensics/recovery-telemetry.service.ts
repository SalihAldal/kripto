import { STALL_ERROR_CODES } from "@/src/server/forensics/stall-error-taxonomy";

export type RecoveryTerminalState = "COMPLETED" | "FAILED" | "STOPPED" | "RECOVERED";

export type RecoveryTelemetryRecord = {
  jobId: string;
  runId?: string;
  roundId?: string;
  stage?: string;
  failure?: string;
  action?: string;
  recoveryCount?: number;
  recoveryFailure?: number;
  escalationCount?: number;
  lastRecoveryReason?: string;
  recoveryStage?: string;
  terminalReason?: string;
  terminalState?: RecoveryTerminalState;
  progressState?: string;
  recoveryDecision?: string;
  reasonCode?: string;
  reasonDetail?: string;
  lastProgressAt?: string | null;
  heartbeatAt?: string | null;
  elapsedMs?: number;
  selectionBudgetMs?: number;
  stallElapsedMs?: number;
  selectionBudgetRemainingMs?: number;
  timestamp: string;
};

const recoveryLog: RecoveryTelemetryRecord[] = [];

export function recordRecoveryTelemetry(input: Omit<RecoveryTelemetryRecord, "timestamp">) {
  const row: RecoveryTelemetryRecord = { ...input, timestamp: new Date().toISOString() };
  recoveryLog.push(row);
  if (recoveryLog.length > 300) recoveryLog.shift();
  return row;
}

export function getRecoveryTelemetryLog(limit = 100) {
  return recoveryLog.slice(-limit);
}

export function resetRecoveryTelemetry() {
  recoveryLog.length = 0;
}

export function mapRecoveryToTerminalReason(input: {
  action: string;
  escalationLevel: number;
  failure?: string;
}) {
  if (input.action === "STOP_JOB" || input.escalationLevel >= 5) {
    return {
      terminalState: "STOPPED" as const,
      terminalReason: STALL_ERROR_CODES.RECOVERY_EXHAUSTED,
      reasonDetail: "Recovery escalation limit reached",
    };
  }
  if (input.action === "FAIL_CURRENT_ROUND") {
    return {
      terminalState: "FAILED" as const,
      terminalReason: STALL_ERROR_CODES.ROUND_STALLED,
      reasonDetail: input.failure ?? "Repeated runtime failures",
    };
  }
  if (input.action === "RESTART_CURRENT_STAGE") {
    return {
      terminalState: "RECOVERED" as const,
      terminalReason: "RESTART_CURRENT_STAGE",
      reasonDetail: "Stage restarted by recovery policy",
    };
  }
  return null;
}
