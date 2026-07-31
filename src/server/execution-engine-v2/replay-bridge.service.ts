import { prisma } from "@/src/server/db/prisma";
import { upsertDecisionLogRecord } from "@/src/server/repositories/decision-log.repository";
import { replayEntry } from "@/src/server/entry-timing/entry-replay.service";
import { replayExit } from "@/src/server/exit-timing/exit-replay.service";

export async function enqueueExecutionReplayForLog(logKey: string, executionId: string, symbol: string) {
  const log = await prisma.executionLog.findUnique({ where: { logKey } });
  if (!log) return null;

  const decisionId = `exv2_${logKey}`;
  await upsertDecisionLogRecord({
    decisionId,
    symbol,
    decision: log.side,
    executionAllowed: false,
    strategyUsed: "EXECUTION_ENGINE_V2",
    humanSummary: `Execution V2 ${log.side} ${log.status} slippage=${log.slippagePct ?? 0}%`,
    metadata: {
      source: "execution-engine-v2",
      logKey,
      executionId,
      orderType: log.orderType,
      filledQuantity: log.filledQuantity,
      averageFillPrice: log.averageFillPrice,
      fee: log.fee,
      latencyMs: log.latencyMs,
    },
  });

  if (log.side === "BUY" && log.entryAnalysisId && log.averageFillPrice && log.averageFillPrice > 0) {
    void replayEntry({
      symbol,
      entryPrice: log.averageFillPrice,
      entryAt: log.verifiedAt ?? log.submittedAt,
      analysisId: log.entryAnalysisId,
    }).catch(() => null);
  }

  if (log.side === "SELL" && log.exitAnalysisId && log.averageFillPrice && log.averageFillPrice > 0) {
    const analysis = await prisma.exitAnalysis.findUnique({ where: { id: log.exitAnalysisId } });
    void replayExit({
      symbol,
      exitPrice: log.averageFillPrice,
      exitAt: log.verifiedAt ?? log.submittedAt,
      entryPrice: analysis?.entryPrice ?? log.averageFillPrice,
      analysisId: log.exitAnalysisId,
    }).catch(() => null);
  }

  void import("@/src/server/execution-management/execution-management-queue").then(({ enqueueExecutionMgmtJob }) =>
    enqueueExecutionMgmtJob({ type: "EXECUTION_REPLAY", limit: 1 }).catch(() => null),
  );

  void import("@/src/server/learning-engine/learning-engine-queue").then(({ enqueueLearningEngineJob }) =>
    enqueueLearningEngineJob({ type: "TRADE_LEARN", limit: 1 }).catch(() => null),
  );

  return decisionId;
}
