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

const RUN_ID = `p1-exit-fee-1round-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const BLOCKING_AI = new Set(["NO_TRADE", "NO-TRADE", "HOLD", "WAIT", "REJECT"]);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readJson<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus, stopAutoRoundJob } = await import(
    "@/src/server/execution/auto-round-engine.service"
  );
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${RUN_ID}-preflight`,
  });
  if (!preflight.canStart) {
    const blocked = { runId: RUN_ID, status: "PREFLIGHT_BLOCKED", preflight };
    fs.writeFileSync(path.join(process.cwd(), "reports", "p1-exit-fee-1round-validation.json"), JSON.stringify(blocked, null, 2));
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    process.exit(2);
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 1,
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
    const blocked = { runId: RUN_ID, status: "START_BLOCKED", started, preflight };
    fs.writeFileSync(path.join(process.cwd(), "reports", "p1-exit-fee-1round-validation.json"), JSON.stringify(blocked, null, 2));
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  const deadline = Date.now() + 45 * 60_000;
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
  if (job?.status === "RUNNING") {
    await stopAutoRoundJob(user.id).catch(() => null);
  }

  const round = job?.rounds?.[0];
  const root = round ? path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", String(round.roundNo)) : null;

  const decisionTrace = root
    ? readJson<{ decisions?: Array<{ stage?: string; verdict?: string; reasonDetail?: string; reasonCode?: string }> }>(
        path.join(root, "decision-trace.json"),
      )
    : null;
  const executionTrace = root
    ? readJson<{ orders?: Array<{ symbol?: string; side?: string; aiVerdict?: string; executionVerdict?: string }> }>(
        path.join(root, "execution-trace.json"),
      )
    : null;
  const pnl = root
    ? readJson<{
        entries?: Array<{
          tradeId?: string;
          symbol?: string;
          grossPnL?: number;
          totalFee?: number;
          netPnL?: number;
          feeReconciliationStatus?: string;
          exitReason?: string;
          exitModel?: string;
        }>;
      }>(path.join(root, "pnl-ledger.json"))
    : null;
  const exitForensics = root ? readJson<{ rows?: Array<Record<string, unknown>> }>(path.join(root, "exit-forensics.json")) : null;
  const feePolicy = root
    ? readJson<{
        evaluations?: Array<{
          symbol?: string;
          feeEdgeClass?: string;
          expectedGrossToFeeRatio?: number;
          expectedNetAfterFeesAtTp?: number;
        }>;
      }>(path.join(root, "fee-aware-entry-policy.json"))
    : null;

  const orders = executionTrace?.orders ?? [];
  const decisions = decisionTrace?.decisions ?? [];
  const entries = pnl?.entries ?? [];
  const aiBypass = orders.filter((row) => BLOCKING_AI.has(String(row.aiVerdict ?? "").toUpperCase())).length;
  const feeMismatch = entries.filter((row) => row.feeReconciliationStatus === "FAIL").length;

  const criticalFailures: string[] = [];
  if (aiBypass > 0) criticalFailures.push("CRITICAL_AI_EXECUTION_BYPASS");
  if (feeMismatch > 0) criticalFailures.push("CRITICAL_PNL_FEE_MISMATCH");
  if (job?.status === "RUNNING") criticalFailures.push("CRITICAL_JOB_RUNNING_TIMEOUT");
  if (!round) criticalFailures.push("CRITICAL_ROUND_NOT_CREATED");

  const monitorEvidence = decisions.some(
    (row) => String(row.stage ?? "").toUpperCase().includes("POSITION") || String(row.reasonCode ?? "").includes("TIMEOUT"),
  );
  const exitModels = entries.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.exitModel ?? "UNKNOWN");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const exitReasons = entries.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.exitReason ?? "UNKNOWN");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const status =
    entries.length === 0
      ? "EXIT_RUNTIME_NOT_EXERCISED"
      : criticalFailures.length > 0
        ? "FAIL"
        : "PASS_OR_PROVISIONAL";

  const output = {
    runId: RUN_ID,
    sessionId,
    status,
    preflight: {
      canStart: preflight.canStart,
      overallVerdict: preflight.overallVerdict,
      attemptId: preflight.attemptId,
    },
    job: job
      ? {
          id: job.id,
          status: job.status,
          completedRounds: job.completedRounds,
          failedRounds: job.failedRounds,
          lastError: job.lastError,
          finishedAt: job.finishedAt,
        }
      : null,
    round: round
      ? {
          roundNo: round.roundNo,
          state: round.state,
          result: round.result,
          failReason: round.failReason,
          artifactRoot: root,
          artifacts: {
            exitForensics: Boolean(root && fs.existsSync(path.join(root, "exit-forensics.json"))),
            replayExitDiagnostics: Boolean(root && fs.existsSync(path.join(root, "replay-exit-diagnostics.json"))),
            feeAwareEntryPolicy: Boolean(root && fs.existsSync(path.join(root, "fee-aware-entry-policy.json"))),
            pnlLedger: Boolean(root && fs.existsSync(path.join(root, "pnl-ledger.json"))),
          },
        }
      : null,
    checks: {
      monitorEvidence,
      executionReadyCount: decisions.filter((row) => row.stage === "execution" && row.verdict === "APPROVE").length,
      ordersCreatedCount: orders.length,
      closedTradeCount: entries.length,
      exitReasons,
      exitModels,
      feePolicySamples: feePolicy?.evaluations?.length ?? 0,
      aiBypassCount: aiBypass,
      feeMismatchCount: feeMismatch,
      exitForensicsRows: exitForensics?.rows?.length ?? 0,
    },
    criticalFailures,
    lastStatus,
  };

  const outPath = path.join(process.cwd(), "reports", "p1-exit-fee-1round-validation.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
  await prisma.$disconnect();
  process.exit(criticalFailures.length > 0 ? 10 : 0);
}

main().catch(async (error) => {
  console.error(
    JSON.stringify(
      {
        runId: RUN_ID,
        ok: false,
        error: (error as Error).message,
        stack: (error as Error).stack,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
