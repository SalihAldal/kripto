/**
 * 100-round paper watchdog — tight monitoring until round 10, then 30m intervals.
 * Usage: npx tsx scripts/_watch-100round-paper.ts [jobId]
 */
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

const JOB_ID_ARG = process.argv[2];
const TIGHT_UNTIL_ROUND = Number(process.env.TIGHT_UNTIL_ROUND ?? 10);
const TIGHT_INTERVAL_MS = Number(process.env.TIGHT_INTERVAL_SEC ?? 120) * 1000;
const LONG_INTERVAL_MS = Number(process.env.LONG_INTERVAL_SEC ?? 1800) * 1000;
const STALE_HEARTBEAT_MS = Number(process.env.STALE_HEARTBEAT_SEC ?? 240) * 1000;
const LOG_PATH = path.join(process.cwd(), "artifacts", "monitor", "100round-paper-watch.jsonl");

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function appendLog(entry: unknown) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

type Blocker = { code: string; severity: "critical" | "warn"; message: string };

async function resolveJobId(prisma: Awaited<ReturnType<typeof import("@/src/server/db/prisma").prisma>>) {
  if (JOB_ID_ARG) return JOB_ID_ARG;
  const row = await prisma.autoRoundJob.findFirst({
    where: { status: { in: ["RUNNING", "FAILED"] } },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  return row?.id ?? null;
}

async function snapshot(jobId: string) {
  const { prisma } = await import("@/src/server/db/prisma");
  const job = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    include: { rounds: { where: { endedAt: null }, orderBy: { roundNo: "desc" }, take: 3 } },
  });
  if (!job) return { job: null, prisma, activeRound: null, heartbeatAgeMs: null };

  const meta = (job.metadata ?? {}) as Record<string, unknown>;
  const activeRound = meta.activeRound as Record<string, unknown> | undefined;
  const heartbeatAt = activeRound?.heartbeatAt ? new Date(String(activeRound.heartbeatAt)).getTime() : null;
  const heartbeatAgeMs = heartbeatAt ? Date.now() - heartbeatAt : null;

  return { job, prisma, activeRound, heartbeatAgeMs };
}

function detectBlockers(input: Awaited<ReturnType<typeof snapshot>>): Blocker[] {
  const blockers: Blocker[] = [];
  const { job, heartbeatAgeMs, activeRound } = input;
  if (!job) {
    blockers.push({ code: "JOB_NOT_FOUND", severity: "critical", message: "Job missing" });
    return blockers;
  }
  if (job.status === "FAILED") {
    blockers.push({ code: "JOB_FAILED", severity: "critical", message: String(job.lastError ?? "FAILED") });
  }
  if (job.stopRequested) {
    blockers.push({ code: "STOP_REQUESTED", severity: "warn", message: "Operator stop requested" });
  }
  const heartbeatFresh = heartbeatAgeMs !== null && heartbeatAgeMs <= STALE_HEARTBEAT_MS;
  if (job.lastError && !heartbeatFresh) {
    blockers.push({ code: "JOB_LAST_ERROR", severity: "critical", message: String(job.lastError) });
  }
  if (heartbeatAgeMs !== null && heartbeatAgeMs > STALE_HEARTBEAT_MS) {
    blockers.push({
      code: "STALE_HEARTBEAT",
      severity: "critical",
      message: `No heartbeat ${Math.round(heartbeatAgeMs / 1000)}s (step=${activeRound?.step ?? "?"})`,
    });
  }
  if (job.activeState === "bekliyor" && job.currentRound === 0 && !activeRound?.step) {
    const startedMs = job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : 0;
    if (startedMs > 120_000) {
      blockers.push({
        code: "SCHEDULER_NEVER_STARTED",
        severity: "critical",
        message: `bekliyor ${Math.round(startedMs / 1000)}s without round`,
      });
    }
  }
  return blockers;
}

async function attemptRecovery(jobId: string, blockers: Blocker[], prisma: Awaited<ReturnType<typeof import("@/src/server/db/prisma").prisma>>) {
  const actions: string[] = [];
  const criticalCodes = new Set(blockers.map((b) => b.code));

  if (criticalCodes.has("JOB_FAILED")) {
    const row = await prisma.autoRoundJob.findUnique({ where: { id: jobId } });
    if (row?.status === "FAILED") {
      const nextRound = Math.max(row.currentRound, row.failedRounds + 1);
      await prisma.autoRoundJob
        .update({
          where: { id: jobId },
          data: {
            status: "RUNNING",
            activeState: "tariyor",
            lastError: null,
            finishedAt: null,
            currentRound: nextRound,
            activeRunId: null,
            metadata: {
              ...((row.metadata as Record<string, unknown>) ?? {}),
              activeRound: null,
              consecutiveFilterRejections: 0,
            } as never,
          },
        })
        .then(() => actions.push(`resumed FAILED at round ${nextRound}`))
        .catch((e) => actions.push(`resume failed: ${(e as Error).message}`));
    }
  }

  if (
    criticalCodes.has("STALE_HEARTBEAT") ||
    criticalCodes.has("JOB_LAST_ERROR") ||
    criticalCodes.has("SCHEDULER_NEVER_STARTED") ||
    criticalCodes.has("JOB_FAILED")
  ) {
    const { triggerSchedulerRecovery, ensureAutoRoundRecovery } = await import(
      "@/src/server/execution/auto-round-engine.service"
    );
    try {
      const result = await triggerSchedulerRecovery({ jobId, force: true });
      actions.push(`triggerSchedulerRecovery: ${result.result ?? "unknown"}`);
    } catch (e) {
      actions.push(`triggerSchedulerRecovery failed: ${(e as Error).message}`);
    }
    try {
      const boot = await ensureAutoRoundRecovery();
      actions.push(`ensureAutoRoundRecovery: loops=${boot.recoveredLoops}`);
    } catch (e) {
      actions.push(`ensureAutoRoundRecovery failed: ${(e as Error).message}`);
    }
  }

  return actions;
}

function isDone(job: NonNullable<Awaited<ReturnType<typeof snapshot>>["job"]>) {
  if (job.stopRequested) return true;
  if (job.status === "COMPLETED") return true;
  if (job.completedRounds >= job.totalRounds) return true;
  return false;
}

async function main() {
  const { prisma } = await import("@/src/server/db/prisma");
  const jobId = await resolveJobId(prisma);
  if (!jobId) {
    console.log(JSON.stringify({ ok: false, reason: "no job" }));
    await prisma.$disconnect();
    process.exit(1);
  }

  appendLog({
    event: "watch_100_start",
    at: new Date().toISOString(),
    jobId,
    tightUntilRound: TIGHT_UNTIL_ROUND,
    tightIntervalSec: TIGHT_INTERVAL_MS / 1000,
    longIntervalSec: LONG_INTERVAL_MS / 1000,
  });
  console.log(JSON.stringify({ event: "watch_100_start", jobId }));

  let cycle = 0;
  while (true) {
    cycle += 1;
    const snap = await snapshot(jobId);
    const job = snap.job;
    if (!job) {
      appendLog({ event: "watch_100_tick", cycle, error: "job_not_found", at: new Date().toISOString() });
      await sleep(TIGHT_INTERVAL_MS);
      continue;
    }

    const blockers = detectBlockers(snap);
    const critical = blockers.filter((b) => b.severity === "critical");
    let recoveryActions: string[] = [];
    if (critical.length > 0) {
      recoveryActions = await attemptRecovery(jobId, blockers, snap.prisma);
    }

    const tightPhase = (job.currentRound ?? 0) <= TIGHT_UNTIL_ROUND;
    const entry = {
      event: "watch_100_tick",
      cycle,
      at: new Date().toISOString(),
      jobId,
      status: job.status,
      currentRound: job.currentRound,
      completedRounds: job.completedRounds,
      failedRounds: job.failedRounds,
      totalRounds: job.totalRounds,
      activeState: job.activeState,
      step: snap.activeRound?.step ?? null,
      heartbeatAgeSec: snap.heartbeatAgeMs !== null ? Math.round(snap.heartbeatAgeMs / 1000) : null,
      blockers,
      recoveryActions,
      phase: tightPhase ? "tight" : "long",
    };
    appendLog(entry);
    console.log(JSON.stringify(entry));

    if (isDone(job)) {
      appendLog({
        event: "watch_100_complete",
        at: new Date().toISOString(),
        jobId,
        status: job.status,
        completedRounds: job.completedRounds,
        stopRequested: job.stopRequested,
      });
      console.log(JSON.stringify({ event: "watch_100_complete", completedRounds: job.completedRounds }));
      break;
    }

    const intervalMs = tightPhase ? TIGHT_INTERVAL_MS : LONG_INTERVAL_MS;
    await sleep(intervalMs);
  }

  await prisma.$disconnect().catch(() => null);
}

main().catch((e) => {
  appendLog({ event: "watch_100_error", error: (e as Error).message, stack: (e as Error).stack });
  console.error((e as Error).message);
  process.exit(1);
});
