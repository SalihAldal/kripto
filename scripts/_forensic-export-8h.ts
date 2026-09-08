import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const jobId = "cmtqhz77p000fun84lgcyuckv";
const campaignStart = new Date("2026-09-07T00:23:00.000Z");
const campaignEnd = new Date("2026-09-07T08:24:00.000Z");

async function main() {
  const job = await p.autoRoundJob.findUnique({ where: { id: jobId } });
  const rounds = await p.autoRoundRun.findMany({ where: { jobId }, orderBy: { roundNo: "asc" } });
  const userId = job!.userId;
  const positions = await p.position.count({ where: { userId, openedAt: { gte: campaignStart, lte: campaignEnd } } });
  const orders = await p.tradeOrder.count({ where: { userId, createdAt: { gte: campaignStart, lte: campaignEnd } } });
  const paperTrades = await p.paperTrade.count({ where: { userId, openedAt: { gte: campaignStart, lte: campaignEnd } } });
  const settlementFills = await p.positionSettlementFill.count({
    where: { createdAt: { gte: campaignStart, lte: campaignEnd }, position: { userId } },
  });

  const out = {
    job: {
      id: job?.id,
      status: job?.status,
      campaignId: job?.campaignId,
      startedAt: job?.startedAt,
      finishedAt: job?.finishedAt,
      completedRounds: job?.completedRounds,
      failedRounds: job?.failedRounds,
      currentRound: job?.currentRound,
      lastError: job?.lastError,
      budgetPerTrade: job?.budgetPerTrade,
      maxWaitSec: job?.maxWaitSec,
      aiMode: job?.aiMode,
      coinSelectionMode: job?.coinSelectionMode,
      targetProfitPct: job?.targetProfitPct,
      stopLossPct: job?.stopLossPct,
      stopRequested: job?.stopRequested,
      activeState: job?.activeState,
      metadata: job?.metadata,
    },
    roundCount: rounds.length,
    rounds: rounds.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const rt = (meta.runtime ?? {}) as Record<string, unknown>;
      const term = (meta.terminal ?? meta.terminalEvidence ?? {}) as Record<string, unknown>;
      const durationSec =
        r.endedAt && r.startedAt ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000) : null;
      return {
        id: r.id,
        roundNo: r.roundNo,
        state: r.state,
        symbol: r.symbol,
        result: r.result,
        failReason: r.failReason,
        selectedReason: r.selectedReason,
        executionId: r.executionId,
        buyPrice: r.buyPrice,
        buyQty: r.buyQty,
        netPnl: r.netPnl,
        feeTotal: r.feeTotal,
        startedAt: r.startedAt?.toISOString(),
        endedAt: r.endedAt?.toISOString(),
        durationSec,
        runtimeStep: rt.step,
        runtimeMessage: typeof rt.message === "string" ? rt.message.slice(0, 300) : rt.message,
        gateBlock: meta.gateBlock ?? meta.rejectReason ?? meta.lastGate,
        aiDecision: meta.aiDecision ?? meta.consensus ?? meta.ai,
        candidateCount: meta.candidateCount ?? meta.scanned ?? meta.candidates,
        terminalDecision: term.decision,
        terminalReasonCode: term.reasonCode ?? term.firstBlocker,
        terminalSecondary: term.secondaryBlockers,
        metaKeys: Object.keys(meta),
        metaFull: meta,
      };
    }),
    dbCounts: { positions, orders, paperTrades, settlementFills },
  };
  console.log(JSON.stringify(out, null, 2));
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
