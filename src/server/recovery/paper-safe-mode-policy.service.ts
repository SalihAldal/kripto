import { env } from "@/lib/config";
import { getApiFailureStateByDomain } from "@/src/server/repositories/risk.repository";
import { getSafeModeState, setSafeModeState } from "@/src/server/recovery/failsafe-recovery.service";

export type SafeModeGateAssessment = {
  blocked: boolean;
  failureDomain: "SAFE_MODE" | "EXECUTION" | null;
  failureCode: string;
  reasonDetail: string;
  requireManualAck: boolean;
  safeModeEnabled: boolean;
  breakerOpen: boolean;
  breakerBlockedUntil: string | null;
  safeModeUpdatedAt: string | null;
  breakerLastFailureCode: string | null;
};

export function formatSafeModeTerminalReason(assessment: Pick<SafeModeGateAssessment, "failureDomain" | "failureCode">) {
  const domain = assessment.failureDomain ?? "SAFE_MODE";
  return `${domain}:${assessment.failureCode}`;
}

function isBreakerOpen(state: { state?: string; openUntil?: string | null; blockedUntil?: string | null }) {
  const until = state.openUntil ?? state.blockedUntil;
  if (state.state !== "OPEN") return false;
  if (!until) return true;
  return Date.parse(until) > Date.now();
}

export async function assessSafeModeExecutionGate(userId: string): Promise<SafeModeGateAssessment> {
  const safeMode = await getSafeModeState(userId);
  const executionBreaker = await getApiFailureStateByDomain(userId, "EXECUTION");
  const breakerOpen = isBreakerOpen(executionBreaker);

  if (safeMode.enabled) {
    return {
      blocked: true,
      failureDomain: "SAFE_MODE",
      failureCode: "SAFE_MODE_ACTIVE",
      reasonDetail: safeMode.reason ?? "Safe mode active",
      requireManualAck: Boolean(safeMode.requireManualAck),
      safeModeEnabled: true,
      breakerOpen,
      breakerBlockedUntil: executionBreaker.openUntil ?? executionBreaker.blockedUntil ?? null,
      safeModeUpdatedAt: safeMode.updatedAt ?? null,
      breakerLastFailureCode: executionBreaker.lastFailureCode ?? null,
    };
  }

  if (breakerOpen) {
    return {
      blocked: true,
      failureDomain: "EXECUTION",
      failureCode: "API_FAILURE_BREAKER_OPEN",
      reasonDetail: executionBreaker.lastFailureMessage ?? "Execution API failure breaker is open",
      requireManualAck: false,
      safeModeEnabled: false,
      breakerOpen: true,
      breakerBlockedUntil: executionBreaker.openUntil ?? executionBreaker.blockedUntil ?? null,
      safeModeUpdatedAt: null,
      breakerLastFailureCode: executionBreaker.lastFailureCode ?? null,
    };
  }

  return {
    blocked: false,
    failureDomain: null,
    failureCode: "",
    reasonDetail: "",
    requireManualAck: false,
    safeModeEnabled: false,
    breakerOpen: false,
    breakerBlockedUntil: null,
    safeModeUpdatedAt: null,
    breakerLastFailureCode: null,
  };
}

/** Authorized manual ack — only when underlying breaker is no longer open. */
export async function acknowledgeSafeModeThroughPolicy(input: {
  userId: string;
  reason: string;
  operator?: string;
}) {
  const assessment = await assessSafeModeExecutionGate(input.userId);
  if (!assessment.safeModeEnabled) {
    return { acknowledged: false, reason: "SAFE_MODE_NOT_ACTIVE", assessment };
  }
  if (assessment.breakerOpen) {
    return {
      acknowledged: false,
      reason: "API_FAILURE_BREAKER_STILL_OPEN",
      assessment,
      message: "Safe mode manual ack blocked: execution API failure breaker is still open.",
    };
  }
  const saved = await setSafeModeState({
    userId: input.userId,
    enabled: false,
    reason: input.reason,
    requireManualAck: false,
  });
  return {
    acknowledged: true,
    reason: "MANUAL_ACK_ACCEPTED",
    assessment,
    saved,
    operator: input.operator ?? "policy",
  };
}

export function describeSafeModeAckRequirement(assessment: SafeModeGateAssessment) {
  if (!assessment.blocked) return null;
  if (assessment.failureDomain === "EXECUTION" && assessment.failureCode === "API_FAILURE_BREAKER_OPEN") {
    return {
      screen: "System Command → API failure breaker",
      action: "Wait for breaker cooldown/recovery or use authorized risk reset after verifying root cause is resolved.",
      detail: assessment.reasonDetail,
    };
  }
  if (assessment.requireManualAck) {
    return {
      screen: "System Command → Safe Mode",
      action: `POST /api/failsafe/safe-mode with {"enabled":false,"reason":"Manual ack after verification"} (API token required).`,
      detail: `${assessment.reasonDetail} (flagged ${assessment.safeModeUpdatedAt ?? "unknown"})`,
    };
  }
  return {
    screen: "System Command → Safe Mode",
    action: "Disable safe mode through authorized failsafe API after verifying execution health.",
    detail: assessment.reasonDetail,
  };
}

export function isPaperExecutionContext() {
  return env.EXECUTION_MODE === "paper";
}
