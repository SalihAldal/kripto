import { randomUUID } from "node:crypto";
import type { RecoveryAction } from "@/src/server/execution-safety/execution-safety.types";
import { persistRecoveryEvent, persistExecutionFailure } from "@/src/server/execution-safety/execution-safety.repository";
import { generateFailureReport, generateRecoveryReport } from "@/src/server/execution-safety/execution-audit.service";
import { clearDuplicateCache } from "@/src/server/execution-safety/duplicate-protection.service";
import { clearPriceCache } from "@/src/server/execution-safety/price-validation.service";
import { emitExecutionSafetyEvent, SAFETY_EVENT } from "@/src/server/execution-safety/execution-safety.events";

export async function startRecovery(input: {
  executionId: string;
  userId?: string;
  symbol?: string;
  action: RecoveryAction;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  emitExecutionSafetyEvent(SAFETY_EVENT.RECOVERY_STARTED, input);
  const event = await persistRecoveryEvent({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    action: input.action,
    status: "STARTED",
    reason: input.reason,
    metadata: input.metadata,
  });
  await generateRecoveryReport({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    action: input.action,
    status: "STARTED",
    metadata: input.metadata,
  }).catch(() => null);
  return event;
}

export async function completeRecovery(recoveryId: string, metadata?: Record<string, unknown>) {
  const { prisma } = await import("@/src/server/db/prisma");
  const updated = await prisma.recoveryEvent.update({
    where: { id: recoveryId },
    data: { status: "COMPLETED", completedAt: new Date(), metadata: metadata as never },
  });
  emitExecutionSafetyEvent(SAFETY_EVENT.RECOVERY_COMPLETED, { recoveryId, metadata });
  return updated;
}

export async function recordExecutionFailure(input: {
  executionId: string;
  userId?: string;
  symbol: string;
  side: string;
  reason: string;
  stage?: string;
  metadata?: Record<string, unknown>;
}) {
  await persistExecutionFailure(input);
  return generateFailureReport({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    reason: input.reason,
    stage: input.stage,
    metadata: input.metadata,
  });
}

export async function runRecoveryPipeline(input: {
  executionId: string;
  userId?: string;
  symbol?: string;
  failureReason: string;
}) {
  const recoveryId = randomUUID();
  await startRecovery({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    action: "STATE_RECOVERY",
    reason: input.failureReason,
    metadata: { recoveryId },
  });

  clearDuplicateCache(input.userId);
  clearPriceCache(input.symbol);

  await recordExecutionFailure({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol ?? "UNKNOWN",
    side: "UNKNOWN",
    reason: input.failureReason,
    stage: "RECOVERY",
  });

  const { prisma } = await import("@/src/server/db/prisma");
  const event = await prisma.recoveryEvent.findFirst({
    where: { executionId: input.executionId },
    orderBy: { startedAt: "desc" },
  });
  if (event) {
    await completeRecovery(event.id, { recovered: true });
    await generateRecoveryReport({
      executionId: input.executionId,
      userId: input.userId,
      symbol: input.symbol,
      action: "STATE_RECOVERY",
      status: "COMPLETED",
      metadata: { recoveryId },
    }).catch(() => null);
  }
  return { recovered: true, recoveryId };
}

export async function retryAfterFailure(input: {
  executionId: string;
  userId?: string;
  symbol?: string;
  reason: string;
  maxRetries?: number;
}) {
  await startRecovery({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    action: "RETRY",
    reason: input.reason,
  });
  return { retryAllowed: true, executionId: input.executionId };
}
