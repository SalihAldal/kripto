import { prisma } from "@/src/server/db/prisma";
import { triggerCircuitBreaker } from "@/src/server/live-trading/live-trading.repository";
import { activateKillSwitchFromCircuitBreaker } from "@/src/server/live-trading/kill-switch.service";
import { dispatchLiveAlert } from "@/src/server/live-trading/alert-dispatcher.service";
import type { CircuitBreakerReason } from "@prisma/client";

let executionFailureCount = 0;

export async function isCircuitBreakerActive(userId?: string) {
  const active = await prisma.circuitBreakerEvent.findFirst({
    where: { active: true, OR: [{ userId: null }, { userId }] },
    orderBy: { triggeredAt: "desc" },
  });
  return Boolean(active);
}

export async function tripCircuitBreaker(input: {
  userId?: string;
  reason: CircuitBreakerReason;
  message: string;
  evidence?: Record<string, unknown>;
  activateKillSwitch?: boolean;
}) {
  const event = await triggerCircuitBreaker(input);
  if (input.activateKillSwitch !== false) {
    await activateKillSwitchFromCircuitBreaker(input.userId, input.message);
  }
  await dispatchLiveAlert({
    userId: input.userId,
    eventType: "CIRCUIT_BREAKER",
    severity: "CRITICAL",
    title: `Circuit Breaker: ${input.reason}`,
    message: input.message,
  });
  return event;
}

export async function resolveCircuitBreaker(eventId: string) {
  return prisma.circuitBreakerEvent.update({
    where: { id: eventId },
    data: { active: false, resolvedAt: new Date() },
  });
}

export async function recordExecutionFailure(userId?: string) {
  executionFailureCount++;
  const { env } = await import("@/lib/config");
  if (executionFailureCount >= env.LIVE_TRADING_EXECUTION_FAILURE_THRESHOLD) {
    await tripCircuitBreaker({
      userId,
      reason: "EXECUTION_FAILURE_THRESHOLD",
      message: `${executionFailureCount} execution failures exceeded threshold`,
      evidence: { count: executionFailureCount },
    });
    executionFailureCount = 0;
  }
}

export async function runCircuitBreakerChecks(userId?: string) {
  const blockers: string[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    await tripCircuitBreaker({ userId, reason: "DATABASE_UNAVAILABLE", message: "Database health check failed" });
    blockers.push("DATABASE_UNAVAILABLE");
  }

  try {
    const { getTicker } = await import("@/services/binance.service");
    const start = Date.now();
    await getTicker("BTCUSDT");
    const latency = Date.now() - start;
    if (latency > 5000) {
      await tripCircuitBreaker({ userId, reason: "EXCHANGE_UNAVAILABLE", message: `Exchange latency ${latency}ms` });
      blockers.push("EXCHANGE_UNAVAILABLE");
    }
  } catch {
    await tripCircuitBreaker({ userId, reason: "EXCHANGE_UNAVAILABLE", message: "Exchange unreachable" });
    blockers.push("EXCHANGE_UNAVAILABLE");
  }

  const recentFailures = await prisma.executionFailure.count({
    where: { failedAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  const { env } = await import("@/lib/config");
  if (recentFailures >= env.LIVE_TRADING_EXECUTION_FAILURE_THRESHOLD) {
    await tripCircuitBreaker({
      userId,
      reason: "EXECUTION_FAILURE_THRESHOLD",
      message: `${recentFailures} execution failures in last hour`,
    });
    blockers.push("EXECUTION_FAILURE_THRESHOLD");
  }

  const mismatches = await prisma.executionReconciliation.count({
    where: { status: "MISMATCH", reconciledAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (mismatches > 0) {
    await tripCircuitBreaker({
      userId,
      reason: "BALANCE_MISMATCH",
      message: `${mismatches} reconciliation mismatches detected`,
    });
    blockers.push("BALANCE_MISMATCH");
  }

  return { checked: true, blockers, active: await isCircuitBreakerActive(userId) };
}

export function resetExecutionFailureCount() {
  executionFailureCount = 0;
}
