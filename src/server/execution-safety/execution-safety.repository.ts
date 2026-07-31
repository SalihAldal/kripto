import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { SafetyScores, SafetyValidationStageResult } from "@/src/server/execution-safety/execution-safety.types";

export async function persistExecutionSafety(input: {
  id: string;
  executionId: string;
  userId: string;
  symbol: string;
  side: string;
  mode: string;
  passed: boolean;
  blockedBy?: string;
  rejectReason?: string;
  scores: SafetyScores;
  stages: SafetyValidationStageResult[];
  durationMs: number;
}) {
  return prisma.executionSafety.create({
    data: {
      id: input.id,
      executionId: input.executionId,
      userId: input.userId,
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      mode: input.mode,
      passed: input.passed,
      blockedBy: input.blockedBy,
      rejectReason: input.rejectReason,
      safetyScore: input.scores.safetyScore,
      exchangeHealthScore: input.scores.exchangeHealthScore,
      orderConfidence: input.scores.orderConfidence,
      validationQuality: input.scores.validationQuality,
      executionReadiness: input.scores.executionReadiness,
      stageCount: input.stages.length,
      failedStageCount: input.stages.filter((stage) => !stage.passed).length,
      durationMs: input.durationMs,
      stages: input.stages as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function persistSafetyValidations(input: {
  safetyId: string;
  executionId: string;
  stages: SafetyValidationStageResult[];
}) {
  return prisma.executionSafetyValidation.createMany({
    data: input.stages.map((stage) => ({
      safetyId: input.safetyId,
      executionId: input.executionId,
      stage: stage.stage,
      passed: stage.passed,
      reasons: stage.reasons,
      metadata: stage.metadata as Prisma.InputJsonValue,
    })),
  });
}

export async function persistSafetyDecision(input: {
  safetyId: string;
  executionId: string;
  userId: string;
  symbol: string;
  outcome: "ALLOW" | "BLOCK";
  scores: SafetyScores;
  rejectReason?: string;
}) {
  return prisma.safetyDecision.create({
    data: {
      safetyId: input.safetyId,
      executionId: input.executionId,
      userId: input.userId,
      symbol: input.symbol.toUpperCase(),
      outcome: input.outcome,
      safetyScore: input.scores.safetyScore,
      orderConfidence: input.scores.orderConfidence,
      executionReadiness: input.scores.executionReadiness,
      rejectReason: input.rejectReason,
    },
  });
}

export async function persistExecutionAudit(input: {
  executionId: string;
  userId?: string;
  symbol: string;
  reportType: string;
  passed: boolean;
  payload?: Record<string, unknown>;
}) {
  return prisma.executionAudit.create({
    data: {
      executionId: input.executionId,
      userId: input.userId,
      symbol: input.symbol.toUpperCase(),
      reportType: input.reportType,
      passed: input.passed,
      payload: input.payload as Prisma.InputJsonValue,
    },
  });
}

export async function persistExecutionFailure(input: {
  executionId: string;
  userId?: string;
  symbol: string;
  side: string;
  reason: string;
  stage?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.executionFailure.create({
    data: {
      executionId: input.executionId,
      userId: input.userId,
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      reason: input.reason,
      stage: input.stage,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistRecoveryEvent(input: {
  executionId: string;
  userId?: string;
  symbol?: string;
  action: string;
  status: string;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.recoveryEvent.create({
    data: {
      executionId: input.executionId,
      userId: input.userId,
      symbol: input.symbol?.toUpperCase(),
      action: input.action,
      status: input.status,
      reason: input.reason,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function persistEmergencyAction(input: {
  scope: string;
  userId?: string;
  symbol?: string;
  actionType: string;
  reason: string;
  enabled: boolean;
}) {
  return prisma.emergencyAction.create({
    data: {
      scope: input.scope,
      userId: input.userId,
      symbol: input.symbol?.toUpperCase(),
      actionType: input.actionType as never,
      reason: input.reason,
      enabled: input.enabled,
    },
  });
}

export async function upsertExchangeHealth(input: {
  exchange?: string;
  healthy: boolean;
  latencyMs?: number;
  errorRate?: number;
  openCircuits?: number;
  metadata?: Record<string, unknown>;
}) {
  const exchange = input.exchange ?? "BINANCE_TR";
  const existing = await prisma.exchangeHealth.findFirst({ where: { exchange }, orderBy: { checkedAt: "desc" } });
  if (existing) {
    return prisma.exchangeHealth.update({
      where: { id: existing.id },
      data: {
        healthy: input.healthy,
        latencyMs: input.latencyMs,
        errorRate: input.errorRate,
        openCircuits: input.openCircuits,
        metadata: input.metadata as Prisma.InputJsonValue,
        checkedAt: new Date(),
      },
    });
  }
  return prisma.exchangeHealth.create({
    data: {
      exchange,
      healthy: input.healthy,
      latencyMs: input.latencyMs,
      errorRate: input.errorRate,
      openCircuits: input.openCircuits,
      metadata: input.metadata as Prisma.InputJsonValue,
    },
  });
}

export async function getSafetyDashboard(limit = 50) {
  const [recent, failures, recoveries, exchangeHealth, emergencies] = await Promise.all([
    prisma.executionSafety.findMany({ orderBy: { validatedAt: "desc" }, take: limit }),
    prisma.executionFailure.findMany({ orderBy: { failedAt: "desc" }, take: limit }),
    prisma.recoveryEvent.findMany({ orderBy: { startedAt: "desc" }, take: limit }),
    prisma.exchangeHealth.findMany({ orderBy: { checkedAt: "desc" }, take: 10 }),
    prisma.emergencyAction.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const passed = recent.filter((row) => row.passed).length;
  return {
    totalChecks: recent.length,
    passRate: recent.length > 0 ? (passed / recent.length) * 100 : 100,
    avgSafetyScore: recent.length > 0 ? recent.reduce((sum, row) => sum + (row.safetyScore ?? 0), 0) / recent.length : 0,
    recent,
    failures,
    recoveries,
    exchangeHealth,
    emergencies,
  };
}

export async function getValidationTimeline(limit = 100) {
  return prisma.executionSafetyValidation.findMany({
    orderBy: { validatedAt: "desc" },
    take: limit,
    include: { safety: true },
  });
}

export async function getRecoveryTimeline(limit = 100) {
  return prisma.recoveryEvent.findMany({ orderBy: { startedAt: "desc" }, take: limit });
}

export async function getApiHealthDashboard() {
  const { getApiLatencyStats } = await import("@/src/server/execution-safety/api-health-validation.service");
  const { getCircuitSnapshot } = await import("@/src/server/resilience/circuit-breaker");
  const stats = getApiLatencyStats();
  const circuits = getCircuitSnapshot();
  return { latency: stats, circuits, openCircuitCount: circuits.filter((row) => row.state === "OPEN").length };
}
