import { persistExecutionAudit } from "@/src/server/execution-safety/execution-safety.repository";
import type { PreTradeSafetyResult, SafetyScores } from "@/src/server/execution-safety/execution-safety.types";

export async function generateValidationReport(input: {
  executionId: string;
  userId: string;
  symbol: string;
  result: PreTradeSafetyResult;
}) {
  return persistExecutionAudit({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    reportType: "VALIDATION",
    passed: input.result.passed,
    payload: { stages: input.result.stages, scores: input.result, blockedBy: input.result.blockedBy },
  });
}

export async function generateSafetyReport(input: {
  executionId: string;
  userId: string;
  symbol: string;
  safetyId: string;
  scores: SafetyScores;
  passed: boolean;
}) {
  return persistExecutionAudit({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    reportType: "SAFETY",
    passed: input.passed,
    payload: { safetyId: input.safetyId, scores: input.scores },
  });
}

export async function generateExecutionReport(input: {
  executionId: string;
  userId?: string;
  symbol: string;
  orderId?: string;
  metadata?: Record<string, unknown>;
}) {
  return persistExecutionAudit({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    reportType: "EXECUTION",
    passed: true,
    payload: { orderId: input.orderId, ...input.metadata },
  });
}

export async function generateRecoveryReport(input: {
  executionId: string;
  userId?: string;
  symbol?: string;
  action: string;
  status: string;
  metadata?: Record<string, unknown>;
}) {
  return persistExecutionAudit({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol ?? "UNKNOWN",
    reportType: "RECOVERY",
    passed: status === "COMPLETED",
    payload: { action: input.action, status: input.status, ...input.metadata },
  });
}

export async function generateFailureReport(input: {
  executionId: string;
  userId?: string;
  symbol: string;
  reason: string;
  stage?: string;
  metadata?: Record<string, unknown>;
}) {
  return persistExecutionAudit({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    reportType: "FAILURE",
    passed: false,
    payload: { reason: input.reason, stage: input.stage, ...input.metadata },
  });
}
