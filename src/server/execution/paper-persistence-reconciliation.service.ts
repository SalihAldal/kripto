import type { CanonicalExecutionFailure } from "@/src/server/execution/execution-failure-contract";
import { formatCanonicalExecutionReason } from "@/src/server/execution/execution-failure-contract";
import { publishExecutionEvent } from "@/src/server/execution/execution-event-bus";
import { persistExecutionReconciliation } from "@/src/server/execution-engine-v2/execution-engine-v2.repository";
import { updatePositionMetadata } from "@/src/server/repositories/execution.repository";

export async function markPaperPersistenceReconciliation(input: {
  executionId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  positionId: string;
  orderId: string;
  simulationId: string | null;
  candidateId: string;
  campaignId?: string | null;
  jobId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  roundId?: string | null;
  venue?: string | null;
  failure: CanonicalExecutionFailure;
}) {
  const terminalReason = formatCanonicalExecutionReason(input.failure);
  const reconciliationRequiredAt = new Date().toISOString();
  const [positionMark, reconciliationRecord] = await Promise.allSettled([
    updatePositionMetadata(input.positionId, {
      paperPersistenceState: "RECONCILIATION_REQUIRED",
      paperPersistenceFailure: terminalReason,
      paperSimulationId: input.simulationId,
      paperReconciliationRequiredAt: reconciliationRequiredAt,
    }),
    persistExecutionReconciliation({
      executionId: input.executionId,
      symbol: input.symbol,
      side: input.side,
      internalQty: input.quantity,
      exchangeQty: input.quantity,
      status: "MISMATCH",
      mismatchReason: terminalReason,
      repairAction: "REPLAY_PAPER_FILL_PERSISTENCE",
      metadata: {
        mode: "paper",
        campaignId: input.campaignId,
        positionId: input.positionId,
        orderId: input.orderId,
        simulationId: input.simulationId,
        candidateId: input.candidateId,
        reconciliationRequiredAt,
      },
    }),
  ]);

  const result = {
    positionMarked: positionMark.status === "fulfilled",
    reconciliationPersisted: reconciliationRecord.status === "fulfilled",
  };
  publishExecutionEvent({
    executionId: input.executionId,
    symbol: input.symbol,
    stage: "PAPER_FILL_RECONCILIATION_REQUIRED",
    status: "FAILED",
    message: terminalReason,
    level: "ERROR",
    context: {
      campaignId: input.campaignId,
      jobId: input.jobId,
      sessionId: input.sessionId,
      runId: input.runId,
      roundId: input.roundId,
      candidateId: input.candidateId,
      venue: input.venue,
      executionMode: "paper",
      ...input.failure,
      positionId: input.positionId,
      orderId: input.orderId,
      simulationId: input.simulationId,
      ...result,
    },
  });
  return result;
}
