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

const RUN_ID = `p0-exec-parity-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const BLOCKING = new Set(["NO_TRADE", "NO-TRADE", "HOLD", "WAIT", "REJECT"]);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readJson<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus, stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");

  const { user } = await getRuntimeExecutionContext();
  const active = await prisma.autoRoundJob.findFirst({
    where: { status: "RUNNING" },
    orderBy: { startedAt: "desc" },
  });
  let stoppedStaleJobId: string | null = null;
  if (active && Date.now() - active.startedAt.getTime() > 2 * 60 * 60_000) {
    await stopAutoRoundJob(user.id).catch(() => null);
    stoppedStaleJobId = active.id;
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 2,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: 600,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });

  if (!started.started || !started.jobId) {
    const blocked = {
      runId: RUN_ID,
      blocked: true,
      started,
      stoppedStaleJobId,
    };
    fs.writeFileSync(path.join(process.cwd(), "reports", "p0-execution-parity-2round-validation.json"), JSON.stringify(blocked, null, 2));
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    process.exit(2);
  }

  const sessionId = started.jobId;
  const deadline = Date.now() + 50 * 60_000;
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

  const roundSummaries = (job?.rounds ?? []).map((round) => {
    const root = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", String(round.roundNo));
    const tdi = (readJson<{ records?: Array<{ verdict?: string; hybridDecision?: string; reasonDetail?: string }> }>(path.join(root, "tdi-decisions.json"))?.records ?? []);
    const decisionTrace = readJson<{ decisions?: Array<{ stage?: string; verdict?: string; reasonCode?: string; symbol?: string; reasonDetail?: string }> }>(
      path.join(root, "decision-trace.json"),
    )?.decisions ?? [];
    const riskTrace = readJson<{ riskSizing?: Array<{ stage?: string; verdict?: string }> }>(path.join(root, "risk-sizing-trace.json"))?.riskSizing ?? [];
    const aiProgress = readJson<{ candidates?: Array<{ status?: string }> }>(path.join(root, "ai-progress.json"))?.candidates ?? [];
    const scannerSummary = readJson<{ totalScanned?: number; scannedCount?: number }>(path.join(root, "scanner-summary.json"));

    const aiGateBlocks = decisionTrace.filter((row) => row.stage === "execution" && row.reasonCode?.includes("AI_GATE")).length;
    const aiVetoBypass = decisionTrace.filter(
      (row) =>
        row.stage === "execution" &&
        row.verdict === "APPROVE" &&
        [...BLOCKING].some((d) => (row.reasonDetail ?? "").toUpperCase().includes(`AI FINALDECISION=${d}`)),
    ).length;

    return {
      roundNo: round.roundNo,
      symbol: round.symbol,
      state: round.state,
      result: round.result,
      failReason: round.failReason,
      scannerCount: Number(scannerSummary?.totalScanned ?? scannerSummary?.scannedCount ?? 0),
      candidateCount: Number(round.candidateCount ?? aiProgress.length ?? 0),
      tdiApproved: tdi.filter((r) => r.verdict === "APPROVED").length,
      tdiWait: tdi.filter((r) => r.verdict === "WAIT").length,
      tdiRejected: tdi.filter((r) => r.verdict === "REJECTED").length,
      executionReady: decisionTrace.filter((r) => r.stage === "execution" && r.verdict === "APPROVE").length,
      aiInvoked: aiProgress.length,
      aiDecisions: {
        hold: tdi.filter((r) => r.hybridDecision === "HOLD").length,
        noTrade: tdi.filter((r) => r.hybridDecision === "NO_TRADE").length,
        buy: tdi.filter((r) => r.hybridDecision === "BUY").length,
      },
      riskRows: riskTrace.length,
      orders: Number(round.tradeCount ?? 0),
      aiGateBlocks,
      aiVetoBypass,
    };
  });

  const historicalNoTradeExecutedAfter = roundSummaries.reduce((sum, row) => sum + row.aiVetoBypass, 0);
  const output = {
    runId: RUN_ID,
    sessionId,
    stoppedStaleJobId,
    job: job
      ? {
          status: job.status,
          activeState: job.activeState,
          completedRounds: job.completedRounds,
          failedRounds: job.failedRounds,
          finishedAt: job.finishedAt,
        }
      : null,
    rounds: roundSummaries,
    historicalNoTradeExecutedAfter,
    aiVetoParity: historicalNoTradeExecutedAfter === 0 ? "PASS" : "FAIL",
    lastStatus,
  };

  const outPath = path.join(process.cwd(), "reports", "p0-execution-parity-2round-validation.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(JSON.stringify({ runId: RUN_ID, error: (err as Error).message, stack: (err as Error).stack }, null, 2));
  process.exit(1);
});
