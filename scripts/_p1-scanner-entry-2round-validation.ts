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

const RUN_ID = `p1-scanner-entry-${new Date().toISOString().replace(/[:.]/g, "-")}`;
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
  const { startAutoRoundJob, getAutoRoundStatus } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");

  const { user } = await getRuntimeExecutionContext();
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
    const blocked = { runId: RUN_ID, blocked: true, started };
    fs.writeFileSync(path.join(process.cwd(), "reports", "p1-scanner-entry-2round-validation.json"), JSON.stringify(blocked, null, 2));
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

  const rounds = (job?.rounds ?? []).map((round) => {
    const root = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", String(round.roundNo));
    const scannerSummary = readJson<{
      latestCoverage?: {
        scannerUniverse?: number;
        rotationCandidates?: number;
        priorityCandidates?: number;
        duplicatesRemoved?: number;
        totalEvaluated?: number;
        notDiscoveredCount?: number;
        priorityRescuedCount?: number;
        discoverySources?: Array<{ symbol: string; discoverySource?: string }>;
      };
    }>(path.join(root, "scanner-summary.json"));
    const scannerQ = readJson<{ rejections?: Array<{ reasonCode?: string; exclusionCategory?: string }> }>(
      path.join(root, "scanner-qualification.json"),
    );
    const entryTiming = readJson<{
      records?: Array<{ classification?: string; entryDelayMs?: number }>;
      aggregates?: { entryDelayMs?: { p50?: number; p90?: number; p95?: number } };
    }>(path.join(root, "entry-timing.json"));
    const decisions = readJson<{ decisions?: Array<{ stage?: string; verdict?: string; reasonDetail?: string }> }>(
      path.join(root, "decision-trace.json"),
    );

    const aiBypassCount = (decisions?.decisions ?? []).filter(
      (row) =>
        row.stage === "execution" &&
        row.verdict === "APPROVE" &&
        [...BLOCKING].some((d) => String(row.reasonDetail ?? "").toUpperCase().includes(`"${d}"`)),
    ).length;
    const chasingCount = (entryTiming?.records ?? []).filter((row) => row.classification === "CHASING").length;
    const edgeDecayCount = (entryTiming?.records ?? []).filter((row) => row.classification === "EDGE_DECAY").length;

    return {
      roundNo: round.roundNo,
      state: round.state,
      result: round.result,
      failReason: round.failReason,
      coverage: scannerSummary?.latestCoverage ?? null,
      scannerRejections: (scannerQ?.rejections ?? []).length,
      scannerRotationMiss: (scannerQ?.rejections ?? []).filter((row) => row.reasonCode === "NOT_IN_CYCLE_SLICE").length,
      exclusionCategories: (scannerQ?.rejections ?? []).reduce<Record<string, number>>((acc, row) => {
        const key = String(row.exclusionCategory ?? "OTHER");
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      entryTiming: {
        records: (entryTiming?.records ?? []).length,
        chasingCount,
        edgeDecayCount,
        delayP50: Number(entryTiming?.aggregates?.entryDelayMs?.p50 ?? 0),
        delayP90: Number(entryTiming?.aggregates?.entryDelayMs?.p90 ?? 0),
        delayP95: Number(entryTiming?.aggregates?.entryDelayMs?.p95 ?? 0),
      },
      aiVetoBypassCount: aiBypassCount,
    };
  });

  const output = {
    runId: RUN_ID,
    sessionId,
    job: job
      ? {
          status: job.status,
          activeState: job.activeState,
          completedRounds: job.completedRounds,
          failedRounds: job.failedRounds,
          finishedAt: job.finishedAt,
        }
      : null,
    rounds,
    summary: {
      totalRounds: rounds.length,
      priorityRescuedCount: rounds.reduce((sum, round) => sum + Number(round.coverage?.priorityRescuedCount ?? 0), 0),
      notDiscoveredCount: rounds.reduce((sum, round) => sum + Number(round.coverage?.notDiscoveredCount ?? 0), 0),
      aiVetoBypassCount: rounds.reduce((sum, round) => sum + Number(round.aiVetoBypassCount ?? 0), 0),
      chasingCount: rounds.reduce((sum, round) => sum + Number(round.entryTiming?.chasingCount ?? 0), 0),
      edgeDecayCount: rounds.reduce((sum, round) => sum + Number(round.entryTiming?.edgeDecayCount ?? 0), 0),
    },
    lastStatus,
  };

  const outPath = path.join(process.cwd(), "reports", "p1-scanner-entry-2round-validation.json");
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
