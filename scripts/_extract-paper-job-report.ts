import { PrismaClient } from "@prisma/client";

const jobId = process.argv[2] ?? "cmt95oqos000bunn4s16m7a37";

async function main() {
  const p = new PrismaClient();
  const job = await p.autoRoundJob.findUnique({ where: { id: jobId } });
  if (!job) {
    console.log(JSON.stringify({ ok: false, reason: "job not found" }));
    await p.$disconnect();
    process.exit(1);
  }
  const rounds = await p.autoRoundRun.findMany({
    where: { jobId },
    orderBy: { roundNo: "asc" },
    select: {
      roundNo: true,
      state: true,
      symbol: true,
      failReason: true,
      result: true,
      selectedReason: true,
      buyPrice: true,
      buyQty: true,
      sellPrice: true,
      sellQty: true,
      netPnl: true,
      feeTotal: true,
      startedAt: true,
      endedAt: true,
      metadata: true,
      executionId: true,
    },
  });

  const byReason: Record<string, number> = {};
  const byState: Record<string, number> = {};
  let coinSelected = 0;
  let reachedBuy = 0;
  let reachedSell = 0;

  const roundDetails = rounds.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const reason = r.failReason ?? "";
    const prefix = reason.split(":")[0].split(" ")[0] || "NO_FAIL";
    byReason[prefix] = (byReason[prefix] ?? 0) + 1;
    byState[r.state] = (byState[r.state] ?? 0) + 1;
    if (r.symbol) coinSelected++;
    if (r.buyPrice) reachedBuy++;
    if (r.sellPrice ?? r.netPnl) reachedSell++;

    const durationSec =
      r.endedAt && r.startedAt
        ? Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 1000)
        : null;

    return {
      roundNo: r.roundNo,
      state: r.state,
      symbol: r.symbol,
      failReason: r.failReason,
      result: r.result,
      selectedReason: r.selectedReason?.slice(0, 200),
      buyPrice: r.buyPrice,
      sellPrice: r.sellPrice,
      netPnl: r.netPnl,
      feeTotal: r.feeTotal,
      durationSec,
      executionId: r.executionId,
      gateBlock: meta.gateBlock ?? meta.lastGate ?? meta.aiGate ?? meta.rejectReason ?? null,
      aiVeto: meta.aiVeto ?? meta.aiDecision ?? meta.consensus ?? null,
      scanner: meta.scanner ?? meta.selection ?? meta.candidate ?? null,
      phase: meta.phase ?? meta.stage ?? null,
      metaSnippet: JSON.stringify(meta).slice(0, 500),
    };
  });

  console.log(
    JSON.stringify(
      {
        job: {
          id: job.id,
          status: job.status,
          totalRounds: job.totalRounds,
          currentRound: job.currentRound,
          completedRounds: job.completedRounds,
          failedRounds: job.failedRounds,
          lastError: job.lastError,
          budgetPerTrade: job.budgetPerTrade,
          targetProfitPct: job.targetProfitPct,
          stopLossPct: job.stopLossPct,
          maxWaitSec: job.maxWaitSec,
          coinSelectionMode: job.coinSelectionMode,
          aiMode: job.aiMode,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
        },
        roundCount: rounds.length,
        byFailReasonPrefix: byReason,
        byFinalState: byState,
        funnel: {
          coinSelected,
          reachedBuy,
          reachedSell,
          completed: rounds.filter((r) => r.result === "completed").length,
        },
        rounds: roundDetails,
      },
      null,
      2,
    ),
  );
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
