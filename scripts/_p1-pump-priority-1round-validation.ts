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

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const prisma = (await import("@/src/server/db/prisma")).prisma;

  const { user } = await getRuntimeExecutionContext();
  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `p1-pump-priority-1r-${Date.now()}`,
  });

  if (!preflight.canStart) {
    const blocked = { status: "BLOCKED", preflight };
    fs.writeFileSync("kripto-p1-pump-priority-1round-validation.json", `${JSON.stringify(blocked, null, 2)}\n`);
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    return;
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
    const failed = { status: "START_FAILED", started };
    fs.writeFileSync("kripto-p1-pump-priority-1round-validation.json", `${JSON.stringify(failed, null, 2)}\n`);
    console.log(JSON.stringify(failed, null, 2));
    await prisma.$disconnect();
    return;
  }

  const jobId = started.jobId;
  const deadline = Date.now() + 75 * 60_000;
  while (Date.now() < deadline) {
    const job = await prisma.autoRoundJob.findUnique({ where: { id: jobId } });
    if (job && job.status !== "RUNNING") break;
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }

  const job = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  const roundRoot = path.join(process.cwd(), "artifacts", "forensics", jobId, "rounds", "1");
  const readJson = (name: string) => {
    const p = path.join(roundRoot, name);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };

  const pump = readJson("pump-scan-lifecycle.json") ?? [];
  const slot = readJson("slot-opportunity-report.json") ?? {};
  const summary = readJson("round-summary.json") ?? {};
  const decisions = readJson("decision-trace.json") ?? { decisions: [] };
  const pnl = readJson("pnl-ledger.json") ?? { entries: [] };
  const recovery = readJson("recovery-telemetry.json") ?? { records: [] };

  const pumpScanTimeoutCount = (pump as Array<Record<string, unknown>>).filter(
    (row) => row.reasonCode === "PUMP_SCAN_TIMEOUT" || row.kind === "timeout",
  ).length;
  const fallbackCount = (pump as Array<Record<string, unknown>>).filter(
    (row) => row.kind === "fallback" || row.reasonCode === "PUMP_SCAN_CACHE_FALLBACK",
  ).length;
  const priorityCandidates = Number((slot as Record<string, unknown>).priorityCandidates ?? 0);
  const priorityRescuedCount = Number((slot as Record<string, unknown>).priorityRescuedCount ?? 0);
  const noAiBypass = !(decisions.decisions as Array<Record<string, unknown>>).some(
    (row) =>
      String(row.stage) === "execution" &&
      ["NO_TRADE", "WAIT", "HOLD", "REJECT"].includes(String(row.aiVerdict ?? row.reasonCode ?? "").toUpperCase()) &&
      String(row.executionVerdict ?? row.verdict ?? "").toUpperCase().includes("PASS"),
  );
  const noFeeMismatch = !(pnl.entries as Array<Record<string, unknown>>).some((row) => {
    const gross = Number(row.grossPnL);
    const fee = Number(row.totalFee);
    const net = Number(row.netPnL);
    return Number.isFinite(gross) && Number.isFinite(fee) && Number.isFinite(net) && Math.abs((gross - fee) - net) > 0.0001;
  });
  const zombieCount = await prisma.autoRoundRun.count({
    where: {
      jobId,
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });

  const out = {
    status: "DONE",
    jobId,
    preflight: {
      canStart: preflight.canStart,
      overallVerdict: preflight.overallVerdict,
    },
    job: {
      status: job?.status ?? null,
      completedRounds: job?.completedRounds ?? 0,
      failedRounds: job?.failedRounds ?? 0,
      lastError: job?.lastError ?? null,
    },
    evidence: {
      pumpScanTimeoutCount,
      fallbackCount,
      priorityCandidates,
      priorityRescuedCount,
      noZombie: zombieCount === 0,
      zombieCount,
      noAiBypass,
      noFeeMismatch,
      recoveryRecords: (recovery.records as unknown[]).length,
      roundState: job?.rounds?.[0]?.state ?? null,
      roundFailReason: job?.rounds?.[0]?.failReason ?? null,
      candidateCount: Number((summary as Record<string, unknown>).candidateCount ?? 0),
    },
  };

  fs.writeFileSync("kripto-p1-pump-priority-1round-validation.json", `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  const failure = { status: "ERROR", error: (error as Error).message };
  fs.writeFileSync("kripto-p1-pump-priority-1round-validation.json", `${JSON.stringify(failure, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
