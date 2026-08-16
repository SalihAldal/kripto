/**
 * Live paper watch loop — detects blockers and attempts safe auto-recovery.
 * Usage:
 *   WATCH_DURATION_MIN=180 WATCH_INTERVAL_SEC=90 npx tsx scripts/watch-paper-live.ts
 */
import { spawn } from "node:child_process";
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

const INTERVAL_MS = Number(process.env.WATCH_INTERVAL_SEC ?? 90) * 1000;
const DURATION_MS = Number(process.env.WATCH_DURATION_MIN ?? 180) * 60_000;
const EXTEND_ON_ACTIVE = process.env.WATCH_EXTEND_ON_ACTIVE !== "false";
const STALE_HEARTBEAT_MS = Number(process.env.STALE_HEARTBEAT_SEC ?? 240) * 1000;
const LOG_PATH = path.join(process.cwd(), "artifacts", "monitor", "live-paper-watch.jsonl");
const HOLDER_FLAG = path.join(process.cwd(), "artifacts", "monitor", "paper-scheduler-holder.pid");

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function appendLog(entry: unknown) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

type Blocker = {
  code: string;
  severity: "critical" | "warn";
  message: string;
};

async function snapshot(retry = 3) {
  const { prisma } = await import("@/src/server/db/prisma");
  for (let attempt = 1; attempt <= retry; attempt += 1) {
    try {
      const job = await prisma.autoRoundJob.findFirst({
        where: { status: "RUNNING" },
        orderBy: { startedAt: "desc" },
        include: { rounds: { where: { endedAt: null }, orderBy: { roundNo: "desc" }, take: 3 } },
      });

      const zombieOther = await prisma.autoRoundRun.count({
        where: {
          endedAt: null,
          state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
          ...(job ? { NOT: { jobId: job.id } } : {}),
        },
      });

      const meta = (job?.metadata ?? {}) as Record<string, unknown>;
      const activeRound = meta.activeRound as Record<string, unknown> | undefined;
      const heartbeatAt = activeRound?.heartbeatAt ? new Date(String(activeRound.heartbeatAt)).getTime() : null;
      const heartbeatAgeMs = heartbeatAt ? Date.now() - heartbeatAt : null;

      return { job, zombieOther, activeRound, heartbeatAgeMs, prisma };
    } catch (e) {
      if (attempt >= retry) throw e;
      await sleep(5_000);
    }
  }
  throw new Error("snapshot failed");
}

async function detectBlockers(input: Awaited<ReturnType<typeof snapshot>>): Promise<Blocker[]> {
  const blockers: Blocker[] = [];
  const { job, zombieOther, heartbeatAgeMs, activeRound } = input;

  if (!job) {
    blockers.push({ code: "NO_RUNNING_JOB", severity: "warn", message: "No RUNNING paper job found" });
    return blockers;
  }

  if (job.stopRequested) {
    blockers.push({ code: "STOP_REQUESTED", severity: "warn", message: "Job stop requested by operator" });
  }

  const heartbeatFresh = heartbeatAgeMs !== null && heartbeatAgeMs <= STALE_HEARTBEAT_MS;
  if (job.lastError && !heartbeatFresh) {
    blockers.push({ code: "JOB_LAST_ERROR", severity: "critical", message: String(job.lastError) });
  } else if (job.lastError && heartbeatFresh) {
    blockers.push({
      code: "STALE_JOB_ERROR_FIELD",
      severity: "warn",
      message: `Stale lastError while heartbeat fresh: ${job.lastError}`,
    });
  }

  if (zombieOther > 0) {
    blockers.push({
      code: "FOREIGN_ZOMBIE_RUNS",
      severity: "warn",
      message: `${zombieOther} open run(s) from other job(s)`,
    });
  }

  if (heartbeatAgeMs !== null && heartbeatAgeMs > STALE_HEARTBEAT_MS) {
    blockers.push({
      code: "STALE_HEARTBEAT",
      severity: "critical",
      message: `No heartbeat for ${Math.round(heartbeatAgeMs / 1000)}s (step=${activeRound?.step ?? "?"})`,
    });
  }

  if (job.activeState === "bekliyor" && job.currentRound === 0 && !activeRound?.step) {
    const startedMs = job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : 0;
    if (startedMs > 120_000) {
      blockers.push({
        code: "SCHEDULER_NEVER_STARTED",
        severity: "critical",
        message: `Job RUNNING but bekliyor for ${Math.round(startedMs / 1000)}s without round start`,
      });
    }
  }

  const recoveryAudit = ((job.metadata as Record<string, unknown>)?.recoveryAudit ?? []) as Array<Record<string, unknown>>;
  const recentRestart = recoveryAudit.filter((r) => r.action === "RESTART_CURRENT_STAGE").slice(-1)[0];
  if (recentRestart && Date.now() - new Date(String(recentRestart.timestamp)).getTime() < INTERVAL_MS * 2) {
    blockers.push({
      code: "RECOVERY_RESTART_STAGE",
      severity: "critical",
      message: `Recent RESTART_CURRENT_STAGE: ${recentRestart.message ?? ""}`,
    });
  }

  return blockers;
}

function spawnSchedulerHolder(jobId: string) {
  if (fs.existsSync(HOLDER_FLAG)) {
    const pid = Number(fs.readFileSync(HOLDER_FLAG, "utf8").trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return `holder already running pid=${pid}`;
      } catch {
        // stale pid file
      }
    }
  }

  const child = spawn("npx", ["tsx", "scripts/hold-paper-scheduler.ts", jobId], {
    detached: true,
    stdio: "ignore",
    cwd: process.cwd(),
    env: process.env,
    shell: true,
  });
  child.unref();
  if (child.pid) {
    fs.mkdirSync(path.dirname(HOLDER_FLAG), { recursive: true });
    fs.writeFileSync(HOLDER_FLAG, String(child.pid), "utf8");
    return `spawned holder pid=${child.pid}`;
  }
  return "holder spawn failed (no pid)";
}

async function attemptRecovery(
  jobId: string,
  blockers: Blocker[],
  prisma: Awaited<ReturnType<typeof snapshot>>["prisma"],
) {
  const actions: string[] = [];

  if (blockers.some((b) => b.code === "STALE_JOB_ERROR_FIELD")) {
    await prisma.autoRoundJob
      .update({ where: { id: jobId }, data: { lastError: null } })
      .then(() => actions.push("cleared stale lastError"))
      .catch((e) => actions.push(`clear lastError failed: ${(e as Error).message}`));
  }

  if (
    blockers.some(
      (b) =>
        b.code === "STALE_HEARTBEAT" ||
        b.code === "RECOVERY_RESTART_STAGE" ||
        b.code === "JOB_LAST_ERROR" ||
        b.code === "SCHEDULER_NEVER_STARTED",
    )
  ) {
    actions.push(spawnSchedulerHolder(jobId));

    const { triggerSchedulerRecovery, ensureAutoRoundRecovery } = await import(
      "@/src/server/execution/auto-round-engine.service"
    );
    try {
      const result = await triggerSchedulerRecovery({ jobId, force: true });
      actions.push(`triggerSchedulerRecovery: ${result.result ?? "unknown"} (${result.reason ?? result.auditEvent?.message ?? ""})`);
      if (result.result !== "success" && result.spawn?.action === "rejected") {
        actions.push(spawnSchedulerHolder(jobId));
      }
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

  if (blockers.some((b) => b.code === "FOREIGN_ZOMBIE_RUNS")) {
    const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
    const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
    try {
      const { user } = await getRuntimeExecutionContext();
      const pf = await runPaperSessionPreflight({ userId: user.id, attemptId: `watch-${Date.now()}` });
      actions.push(`preflight reconcile: zombies=${pf.checks?.zombieRounds?.metadata?.reconciledCount ?? 0}`);
    } catch (e) {
      actions.push(`preflight reconcile failed: ${(e as Error).message}`);
    }
  }

  return actions;
}

async function runWatchWindow(started: number, baseCycle: number) {
  let cycle = baseCycle;
  while (Date.now() - started < DURATION_MS) {
    cycle += 1;
    let snap: Awaited<ReturnType<typeof snapshot>> | null = null;
    try {
      snap = await snapshot();
    } catch (e) {
      appendLog({ event: "watch_tick_error", cycle, at: new Date().toISOString(), error: (e as Error).message });
      console.log(JSON.stringify({ event: "watch_tick_error", cycle, error: (e as Error).message }));
      await sleep(INTERVAL_MS);
      continue;
    }
    try {
      const blockers = await detectBlockers(snap);
      const critical = blockers.filter((b) => b.severity === "critical");

      let recoveryActions: string[] = [];
      if (critical.length > 0 && snap.job?.id) {
        recoveryActions = await attemptRecovery(snap.job.id, blockers, snap.prisma);
      } else if (blockers.some((b) => b.code === "STALE_JOB_ERROR_FIELD") && snap.job?.id) {
        recoveryActions = await attemptRecovery(snap.job.id, blockers, snap.prisma);
      }

      const entry = {
        event: "watch_tick",
        cycle,
        at: new Date().toISOString(),
        jobId: snap.job?.id ?? null,
        currentRound: snap.job?.currentRound ?? null,
        failedRounds: snap.job?.failedRounds ?? null,
        activeState: snap.job?.activeState ?? null,
        step: snap.activeRound?.step ?? null,
        symbol: snap.job?.rounds?.[0]?.symbol ?? null,
        heartbeatAgeSec: snap.heartbeatAgeMs !== null ? Math.round(snap.heartbeatAgeMs / 1000) : null,
        blockers,
        recoveryActions,
      };
      appendLog(entry);
      console.log(JSON.stringify(entry));
    } catch (e) {
      appendLog({ event: "watch_tick_error", cycle, at: new Date().toISOString(), error: (e as Error).message });
      console.log(JSON.stringify({ event: "watch_tick_error", cycle, error: (e as Error).message }));
    } finally {
      if (snap) await snap.prisma.$disconnect().catch(() => null);
    }

    if (Date.now() - started >= DURATION_MS) break;
    await sleep(INTERVAL_MS);
  }
  return cycle;
}

async function main() {
  const started = Date.now();
  appendLog({
    event: "watch_start",
    at: new Date().toISOString(),
    durationMin: DURATION_MS / 60_000,
    intervalSec: INTERVAL_MS / 1000,
    extendOnActive: EXTEND_ON_ACTIVE,
  });

  let totalCycles = await runWatchWindow(started, 0);

  if (EXTEND_ON_ACTIVE) {
    try {
      const { prisma } = await import("@/src/server/db/prisma");
      const stillRunning = await prisma.autoRoundJob.findFirst({ where: { status: "RUNNING" }, select: { id: true } });
      await prisma.$disconnect();
      if (stillRunning) {
        appendLog({ event: "watch_extend", at: new Date().toISOString(), reason: "job still RUNNING", extraMin: DURATION_MS / 60_000 });
        totalCycles = await runWatchWindow(Date.now(), totalCycles);
      }
    } catch (e) {
      appendLog({ event: "watch_extend_error", at: new Date().toISOString(), error: (e as Error).message });
    }
  }

  appendLog({ event: "watch_complete", at: new Date().toISOString(), cycles: totalCycles });
  console.log(JSON.stringify({ ok: true, cycles: totalCycles, logPath: LOG_PATH }));
}

main().catch((e) => {
  appendLog({ event: "watch_error", error: (e as Error).message, stack: (e as Error).stack });
  console.error((e as Error).message);
  process.exit(1);
});
