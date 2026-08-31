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

const RUN_ID = `p1-exit-fee-5round-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const BLOCKING_AI = new Set(["NO_TRADE", "NO-TRADE", "HOLD", "WAIT", "REJECT"]);
const TOTAL_ROUNDS = 5;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readJson<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");

  const { user } = await getRuntimeExecutionContext();
  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: TOTAL_ROUNDS,
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
    const blocked = { runId: RUN_ID, status: "START_BLOCKED", started };
    fs.writeFileSync(path.join(process.cwd(), "reports", "p1-exit-fee-5round-validation.json"), JSON.stringify(blocked, null, 2));
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

  const rounds = (job?.rounds ?? []).map((round) => {
    const root = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", String(round.roundNo));
    const pnl = readJson<{
      entries?: Array<{
        exitReason?: string;
        exitModel?: string;
        grossPnL?: number;
        netPnL?: number;
        totalFee?: number;
        feeReconciliationStatus?: string;
      }>;
      summary?: { grossPnL?: number; totalFees?: number; netPnL?: number };
    }>(path.join(root, "pnl-ledger.json"));
    const exitForensics = readJson<{ rows?: Array<{ exitReason?: string; exitModel?: string }> }>(
      path.join(root, "exit-forensics.json"),
    );
    const replayDiagnostics = readJson<{ rows?: Array<{ diagnostic?: string }> }>(
      path.join(root, "replay-exit-diagnostics.json"),
    );
    const feePolicy = readJson<{ evaluations?: Array<{ feeEdgeClass?: string; expectedGrossToFeeRatio?: number }> }>(
      path.join(root, "fee-aware-entry-policy.json"),
    );
    const decisions = readJson<{ decisions?: Array<{ stage?: string; verdict?: string; reasonDetail?: string }> }>(
      path.join(root, "decision-trace.json"),
    );
    const artifacts = {
      pnlLedger: fs.existsSync(path.join(root, "pnl-ledger.json")),
      feePolicy: fs.existsSync(path.join(root, "fee-aware-entry-policy.json")),
      exitForensics: fs.existsSync(path.join(root, "exit-forensics.json")),
      replayExitDiagnostics: fs.existsSync(path.join(root, "replay-exit-diagnostics.json")),
    };
    const entries = pnl?.entries ?? [];
    const allEndOfReplay = entries.length > 0 && entries.every((row) => row.exitReason === "END_OF_REPLAY");
    const aiVetoBypassCount = (decisions?.decisions ?? []).filter(
      (row) =>
        row.stage === "execution" &&
        row.verdict === "APPROVE" &&
        [...BLOCKING_AI].some((decision) => String(row.reasonDetail ?? "").toUpperCase().includes(`"${decision}"`)),
    ).length;
    return {
      roundNo: round.roundNo,
      state: round.state,
      result: round.result,
      failReason: round.failReason,
      artifacts,
      tradeCount: entries.length,
      exitReasonCounts: entries.reduce<Record<string, number>>((acc, row) => {
        const key = String(row.exitReason ?? "UNKNOWN");
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      exitModelCounts: entries.reduce<Record<string, number>>((acc, row) => {
        const key = String(row.exitModel ?? "UNKNOWN");
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      allEndOfReplay,
      feeReconciliation: {
        pass: entries.filter((row) => row.feeReconciliationStatus === "PASS").length,
        fail: entries.filter((row) => row.feeReconciliationStatus === "FAIL").length,
        unknown: entries.filter((row) => row.feeReconciliationStatus === "UNKNOWN").length,
      },
      grossPositiveNetNegativeCount: entries.filter((row) => Number(row.grossPnL ?? 0) > 0 && Number(row.netPnL ?? 0) < 0).length,
      feePolicySamples: (feePolicy?.evaluations ?? []).length,
      feeEdgeClasses: (feePolicy?.evaluations ?? []).reduce<Record<string, number>>((acc, row) => {
        const key = String(row.feeEdgeClass ?? "UNKNOWN");
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      replayDiagnosticsRows: (replayDiagnostics?.rows ?? []).length,
      replayDiagnosticsSample: (replayDiagnostics?.rows ?? []).slice(0, 3),
      aiVetoBypassCount,
      pnlSummary: pnl?.summary ?? {},
    };
  });

  const output = {
    runId: RUN_ID,
    sessionId,
    job: job
      ? {
          status: job.status,
          completedRounds: job.completedRounds,
          failedRounds: job.failedRounds,
          finishedAt: job.finishedAt,
        }
      : null,
    rounds,
    summary: {
      rounds: rounds.length,
      totalTrades: rounds.reduce((sum, row) => sum + row.tradeCount, 0),
      nonEndOfReplayExitCount: rounds.reduce(
        (sum, row) => sum + Object.entries(row.exitReasonCounts).filter(([key]) => key !== "END_OF_REPLAY").reduce((acc, [, count]) => acc + count, 0),
        0,
      ),
      feeReconciliationFailCount: rounds.reduce((sum, row) => sum + row.feeReconciliation.fail, 0),
      grossPositiveNetNegativeCount: rounds.reduce((sum, row) => sum + row.grossPositiveNetNegativeCount, 0),
      aiVetoBypassCount: rounds.reduce((sum, row) => sum + row.aiVetoBypassCount, 0),
    },
    validationStatus:
      rounds.some((row) => row.aiVetoBypassCount > 0)
        ? "FAIL_AI_VETO_REGRESSION"
        : rounds.every((row) => row.tradeCount === 0 || row.allEndOfReplay)
          ? "EXIT_VALIDATION_BLOCKED"
          : "PASS_OR_PROVISIONAL",
    validationReason:
      rounds.every((row) => row.tradeCount === 0 || row.allEndOfReplay)
        ? "All observed exits remained END_OF_REPLAY or no trades closed; real position-monitor exit evidence not yet present."
        : "At least one non-END_OF_REPLAY exit observed or no AI veto regression.",
    lastStatus,
  };

  const outPath = path.join(process.cwd(), "reports", "p1-exit-fee-5round-validation.json");
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
