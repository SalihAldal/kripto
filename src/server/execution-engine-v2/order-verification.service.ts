import { env } from "@/lib/config";
import { prisma } from "@/src/server/db/prisma";
import { updateExecutionLogVerified } from "@/src/server/execution-engine-v2/execution-engine-v2.repository";
import { emitExecutionEngineV2Event, EXECUTION_ENGINE_V2_EVENT } from "@/src/server/execution-engine-v2/execution-engine-v2.events";

export async function verifyExecutionOrder(logKey: string) {
  const startedAt = Date.now();
  const log = await prisma.executionLog.findUnique({ where: { logKey } });
  if (!log) throw new Error(`Execution log not found: ${logKey}`);

  const filled = Number(log.filledQuantity ?? 0);
  const expected = Number(log.quantity ?? 0);
  const verified = filled > 0 && (expected <= 0 || filled >= expected * 0.99);

  const updated = await updateExecutionLogVerified(logKey, {
    status: verified ? "VERIFIED" : "PARTIALLY_FILLED",
    metadata: {
      verificationMs: Date.now() - startedAt,
      filledRatio: expected > 0 ? filled / expected : 1,
    },
  });

  emitExecutionEngineV2Event(EXECUTION_ENGINE_V2_EVENT.ORDER_VERIFIED, {
    logKey,
    verified,
    verificationMs: Date.now() - startedAt,
  });

  if (Date.now() - startedAt > env.EXECUTION_ENGINE_V2_VERIFICATION_TIMEOUT_MS) {
    return { ...updated, warning: "Verification exceeded target latency" };
  }

  return updated;
}

export async function verifyRecentUnverifiedLogs(limit = 20) {
  const pending = await prisma.executionLog.findMany({
    where: { status: { in: ["SUBMITTED", "FILLED"] }, verifiedAt: null },
    orderBy: { submittedAt: "desc" },
    take: limit,
  });
  const results = [];
  for (const row of pending) {
    try {
      results.push(await verifyExecutionOrder(row.logKey));
    } catch {
      /* skip */
    }
  }
  return { verified: results.length, results };
}
