import { prisma } from "@/src/server/db/prisma";
import { verifyExecutionOrder } from "@/src/server/execution-engine-v2/order-verification.service";
import { emitExecutionEngineV2Event, EXECUTION_ENGINE_V2_EVENT } from "@/src/server/execution-engine-v2/execution-engine-v2.events";

export async function recoverFailedExecution(executionId: string) {
  const failed = await prisma.executionLog.findMany({
    where: { executionId, status: { in: ["FAILED", "REJECTED", "PARTIALLY_FILLED"] } },
    orderBy: { submittedAt: "desc" },
    take: 5,
  });

  const actions = [];
  for (const log of failed) {
    if (log.status === "PARTIALLY_FILLED" && log.filledQuantity && log.filledQuantity > 0) {
      try {
        await verifyExecutionOrder(log.logKey);
        actions.push({ logKey: log.logKey, action: "verified_partial" });
      } catch (error) {
        actions.push({ logKey: log.logKey, action: "verify_failed", error: (error as Error).message });
      }
    } else {
      actions.push({ logKey: log.logKey, action: "logged_for_review", reason: log.status });
    }
  }

  await prisma.recoveryEvent.create({
    data: {
      executionId,
      action: "EXECUTION_ENGINE_V2_RECOVERY",
      status: "COMPLETED",
      reason: `Processed ${actions.length} failed logs`,
      metadata: { actions },
      completedAt: new Date(),
    },
  });

  emitExecutionEngineV2Event(EXECUTION_ENGINE_V2_EVENT.RECOVERY, { executionId, actions: actions.length });
  return { executionId, actions };
}
