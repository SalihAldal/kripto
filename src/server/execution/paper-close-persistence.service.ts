import { CanonicalExecutionError, resolveExecutionFailure } from "@/src/server/execution/execution-failure-contract";
import { markPaperPersistenceReconciliation } from "@/src/server/execution/paper-persistence-reconciliation.service";
import { recordPaperFillEvent } from "@/src/server/paper-validation/paper-trade-recorder.service";

export async function persistPaperCloseFillForSettlement(input: {
  executionId: string;
  userId: string;
  symbol: string;
  quantity: number;
  avgFillPrice: number;
  fee: number;
  simulationId: string | null;
  campaignId?: string | null;
  candidateId?: string | null;
  orderId: string;
  positionId: string;
  runId?: string | null;
  roundId?: string | null;
}) {
  if (!input.simulationId) {
    return { persisted: false, skipped: true as const, reason: "simulation_id_missing" };
  }
  try {
    await recordPaperFillEvent({
      campaignId: input.campaignId ?? undefined,
      userId: input.userId,
      simulationId: input.simulationId,
      executionId: input.executionId,
      positionId: input.positionId,
      symbol: input.symbol,
      side: "SELL",
      executedQty: input.quantity,
      avgFillPrice: input.avgFillPrice,
      fee: input.fee,
    });
    return { persisted: true, skipped: false as const };
  } catch (error) {
    const failure = resolveExecutionFailure(error, {
      operation: "persist_paper_fill",
      dependency: "paper_trade_repository",
      executionMode: "paper",
      domainHint: "DATABASE",
    });
    await markPaperPersistenceReconciliation({
      executionId: input.executionId,
      symbol: input.symbol,
      side: "SELL",
      quantity: input.quantity,
      positionId: input.positionId,
      orderId: input.orderId,
      simulationId: input.simulationId,
      candidateId: input.candidateId ?? "LEGACY_UNRESOLVED",
      campaignId: input.campaignId ?? null,
      runId: input.runId ?? null,
      roundId: input.roundId ?? null,
      venue: "BINANCE_TR",
      failure,
    }).catch(() => null);
    throw new CanonicalExecutionError(failure, { cause: error });
  }
}
