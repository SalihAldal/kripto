import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const RUN_ID = `p0-runtime-tdi-fix-${new Date().toISOString().replace(/[:.]/g, "-")}`;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readJson<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx] ?? 0);
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");

  const { user } = await getRuntimeExecutionContext();
  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 2,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: 1800,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });

  if (!started.started || !started.jobId) {
    const blocked = { runId: RUN_ID, blocked: true, started };
    fs.mkdirSync(path.join(process.cwd(), "reports"), { recursive: true });
    fs.writeFileSync(
      path.join(process.cwd(), "reports", "p0-runtime-tdi-blocker-2round-validation.json"),
      `${JSON.stringify(blocked, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    process.exit(2);
  }

  const sessionId = started.jobId;
  const deadline = Date.now() + 70 * 60_000;
  let lastStatus: Awaited<ReturnType<typeof getAutoRoundStatus>> | null = null;
  while (Date.now() < deadline) {
    lastStatus = await getAutoRoundStatus(user.id);
    const row = await prisma.autoRoundJob.findUnique({ where: { id: sessionId } });
    if (row && row.status !== "RUNNING") break;
    await sleep(15_000);
  }

  const job = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  const patchDurations: number[] = [];
  let patchTimeoutCount = 0;
  let scannerCandidates = 0;
  let tdiApproved = 0;
  let tdiWait = 0;
  let executionReady = 0;
  let aiCalls = 0;
  let orders = 0;
  let trades = 0;
  const waitReasonDistribution: Record<string, number> = {};
  const firstBlockingDistribution: Record<string, number> = {};

  const rounds = (job?.rounds ?? []).map((round) => {
    const root = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", String(round.roundNo));
    const roundSummary = readJson<{ candidateCount?: number }>(path.join(root, "round-summary.json")) ?? {};
    const tdi = readJson<{ records?: Array<{ verdict?: string; waitReasonCode?: string; firstBlockingCondition?: string }> }>(
      path.join(root, "tdi-decisions.json"),
    );
    const tx = readJson<{ records?: Array<{ operation?: string; durationMs?: number; classification?: string; reasonDetail?: string }> }>(
      path.join(root, "transaction-duration.json"),
    );
    const decision = readJson<{ decisions?: Array<{ stage?: string; verdict?: string }> }>(path.join(root, "decision-trace.json"));
    const ai = readJson<{ aiCalls?: Array<unknown> }>(path.join(root, "ai-trace.json"));
    const execution = readJson<{ orders?: Array<unknown> }>(path.join(root, "execution-trace.json"));
    const pnl = readJson<{ entries?: Array<unknown> }>(path.join(root, "pnl-ledger.json"));

    const tdiRecords = Array.isArray(tdi?.records) ? tdi.records : [];
    const txRecords = Array.isArray(tx?.records) ? tx.records : [];
    const decisionRows = Array.isArray(decision?.decisions) ? decision.decisions : [];
    const aiRows = Array.isArray(ai?.aiCalls) ? ai.aiCalls : [];
    const orderRows = Array.isArray(execution?.orders) ? execution.orders : [];
    const tradeRows = Array.isArray(pnl?.entries) ? pnl.entries : [];

    for (const row of txRecords) {
      if (String(row.operation ?? "").includes("patchJobActiveRound")) {
        const ms = Number(row.durationMs ?? 0);
        if (Number.isFinite(ms) && ms >= 0) patchDurations.push(ms);
        const timeoutLike =
          String(row.classification ?? "").toUpperCase() === "TIMEOUT" ||
          String(row.reasonDetail ?? "").toLowerCase().includes("timeout");
        if (timeoutLike) patchTimeoutCount += 1;
      }
    }

    for (const row of tdiRecords) {
      if (row.verdict === "WAIT") {
        const key = String(row.waitReasonCode ?? "OTHER");
        waitReasonDistribution[key] = (waitReasonDistribution[key] ?? 0) + 1;
        const blocker = String(row.firstBlockingCondition ?? "OTHER");
        firstBlockingDistribution[blocker] = (firstBlockingDistribution[blocker] ?? 0) + 1;
      }
    }

    const perRound = {
      roundNo: round.roundNo,
      state: round.state,
      result: round.result,
      failReason: round.failReason,
      scannerCandidates: Number(roundSummary.candidateCount ?? 0),
      tdiApproved: tdiRecords.filter((row) => row.verdict === "APPROVED").length,
      tdiWait: tdiRecords.filter((row) => row.verdict === "WAIT").length,
      tdiRejected: tdiRecords.filter((row) => row.verdict === "REJECTED").length,
      executionReady: decisionRows.filter((row) => row.stage === "execution" && row.verdict === "APPROVE").length,
      aiCalls: aiRows.length,
      orders: orderRows.length,
      trades: tradeRows.length,
      patchJobActiveRoundSamples: txRecords
        .filter((row) => String(row.operation ?? "").includes("patchJobActiveRound"))
        .map((row) => Number(row.durationMs ?? 0))
        .filter((ms) => Number.isFinite(ms) && ms >= 0),
    };

    scannerCandidates += perRound.scannerCandidates;
    tdiApproved += perRound.tdiApproved;
    tdiWait += perRound.tdiWait;
    executionReady += perRound.executionReady;
    aiCalls += perRound.aiCalls;
    orders += perRound.orders;
    trades += perRound.trades;
    return perRound;
  });

  const output = {
    runId: RUN_ID,
    sessionId,
    generatedAt: new Date().toISOString(),
    job: job
      ? {
          status: job.status,
          completedRounds: job.completedRounds,
          failedRounds: job.failedRounds,
          currentRound: job.currentRound,
          activeState: job.activeState,
          lastError: job.lastError,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
        }
      : null,
    runtime: {
      patchJobActiveRound: {
        sampleCount: patchDurations.length,
        p50: percentile(patchDurations, 50),
        p95: percentile(patchDurations, 95),
        p99: percentile(patchDurations, 99),
        timeoutCount: patchTimeoutCount,
      },
    },
    tdi: {
      waitReasonDistribution,
      firstBlockingDistribution,
    },
    funnel: {
      scannerCandidates,
      tdiApproved,
      tdiWait,
      executionReady,
      aiCalls,
      orders,
      trades,
    },
    rounds,
    lastStatus,
  };

  const outPath = path.join(process.cwd(), "reports", "p0-runtime-tdi-blocker-2round-validation.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(output, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        runId: RUN_ID,
        error: (error as Error).message,
        stack: (error as Error).stack,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
