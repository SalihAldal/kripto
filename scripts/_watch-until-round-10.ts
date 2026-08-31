/**
 * Active monitor until round TARGET_ROUND — auto-recover on stall/failure.
 * Usage: npx tsx scripts/_watch-until-round-10.ts [jobId] [targetRound]
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const JOB_ID = process.argv[2] ?? "cmtc4c2ds0009un70ir6hlcqm";
const TARGET_ROUND = Number(process.argv[3] ?? 10);
const POLL_MS = Number(process.env.WATCH_POLL_SEC ?? 90) * 1000;
const STALE_HEARTBEAT_SEC = Number(process.env.STALE_HEARTBEAT_SEC ?? 180);
const LOG_PATH = path.join(process.cwd(), "artifacts", "monitor", "watch-until-round-10.jsonl");
const HOLDER_FLAG = path.join(process.cwd(), "artifacts", "monitor", "paper-scheduler-holder.pid");

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function appendLog(entry: unknown) {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

function holderPidAlive(): boolean {
  try {
    if (!fs.existsSync(HOLDER_FLAG)) return false;
    const pid = Number(fs.readFileSync(HOLDER_FLAG, "utf8").trim());
    if (!Number.isFinite(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function spawnHolder() {
  if (holderPidAlive()) return "holder_already_running";
  const child = spawn(
    process.execPath,
    ["-r", "./scripts/load-dotenv.cjs", "node_modules/tsx/dist/cli.mjs", "scripts/hold-paper-scheduler.ts", JOB_ID],
    { cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  return `holder_spawned_pid_${child.pid}`;
}

async function snapshot() {
  const { prisma } = await import("@/src/server/db/prisma");
  const job = await prisma.autoRoundJob.findUnique({
    where: { id: JOB_ID },
    include: { rounds: { where: { endedAt: null }, orderBy: { roundNo: "desc" }, take: 1 } },
  });
  const zombies = await prisma.autoRoundRun.count({
    where: {
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });

  const meta = (job?.metadata ?? {}) as Record<string, unknown>;
  const activeRound = meta.activeRound as Record<string, unknown> | undefined;
  const heartbeatAt = activeRound?.heartbeatAt ? new Date(String(activeRound.heartbeatAt)).getTime() : null;
  const heartbeatAgeSec = heartbeatAt ? Math.round((Date.now() - heartbeatAt) / 1000) : null;

  return { prisma, job, zombies, heartbeatAgeSec, activeStep: activeRound?.step ?? null };
}

async function recover(reason: string) {
  const actions: string[] = [];
  actions.push(spawnHolder());

  try {
    const { triggerSchedulerRecovery, ensureAutoRoundRecovery } = await import(
      "@/src/server/execution/auto-round-engine.service"
    );
    const recovery = await triggerSchedulerRecovery({ jobId: JOB_ID, force: true });
    actions.push(`triggerSchedulerRecovery: ${recovery.result ?? recovery.action}`);
    const boot = await ensureAutoRoundRecovery();
    actions.push(`ensureAutoRoundRecovery: loops=${boot.recoveredLoops}`);
  } catch (e) {
    actions.push(`recovery_error: ${(e as Error).message}`);
  }

  appendLog({ event: "recovery", at: new Date().toISOString(), jobId: JOB_ID, reason, actions });
  return actions;
}

async function main() {
  appendLog({ event: "watch_start", at: new Date().toISOString(), jobId: JOB_ID, targetRound: TARGET_ROUND, pollSec: POLL_MS / 1000 });
  console.log(JSON.stringify({ event: "watch_start", jobId: JOB_ID, targetRound: TARGET_ROUND }));

  let cycle = 0;
  let lastRound = 0;

  while (true) {
    cycle += 1;
    let snap: Awaited<ReturnType<typeof snapshot>> | null = null;

    try {
      snap = await snapshot();
    } catch (e) {
      const entry = { event: "watch_tick", cycle, at: new Date().toISOString(), error: (e as Error).message };
      appendLog(entry);
      console.log(JSON.stringify(entry));
      await sleep(POLL_MS);
      continue;
    }

    const job = snap.job;
    if (!job) {
      appendLog({ event: "watch_done", at: new Date().toISOString(), reason: "job_not_found" });
      break;
    }

    const needsRecovery =
      job.status !== "RUNNING" ||
      job.stopRequested ||
      job.activeState === "tur_basarisiz" ||
      job.activeState === "tur basarisiz" ||
      (snap.heartbeatAgeSec !== null && snap.heartbeatAgeSec > STALE_HEARTBEAT_SEC) ||
      !holderPidAlive();

    let recoveryActions: string[] = [];
    if (needsRecovery && job.status === "RUNNING" && !job.stopRequested) {
      recoveryActions = await recover(
        [
          job.activeState?.includes("basarisiz") ? "tur_basarisiz" : null,
          snap.heartbeatAgeSec !== null && snap.heartbeatAgeSec > STALE_HEARTBEAT_SEC ? "stale_heartbeat" : null,
          !holderPidAlive() ? "holder_dead" : null,
        ]
          .filter(Boolean)
          .join(","),
      );
    } else if (job.status !== "RUNNING") {
      appendLog({ event: "watch_stop", at: new Date().toISOString(), status: job.status, lastError: job.lastError });
      break;
    }

    if (job.currentRound > lastRound) {
      lastRound = job.currentRound;
      console.log(JSON.stringify({ event: "round_advanced", round: job.currentRound, failed: job.failedRounds }));
    }

    const entry = {
      event: "watch_tick",
      cycle,
      at: new Date().toISOString(),
      jobId: JOB_ID,
      status: job.status,
      currentRound: job.currentRound,
      completedRounds: job.completedRounds,
      failedRounds: job.failedRounds,
      totalRounds: job.totalRounds,
      activeState: job.activeState,
      symbol: snap.job?.rounds[0]?.symbol ?? null,
      step: snap.activeStep,
      heartbeatAgeSec: snap.heartbeatAgeSec,
      zombies: snap.zombies,
      holderAlive: holderPidAlive(),
      recoveryActions,
      targetRound: TARGET_ROUND,
    };
    appendLog(entry);
    console.log(JSON.stringify(entry));

    const roundsProcessed = job.completedRounds + job.failedRounds;
    if (job.currentRound > TARGET_ROUND || roundsProcessed >= TARGET_ROUND) {
      appendLog({
        event: "watch_target_reached",
        at: new Date().toISOString(),
        currentRound: job.currentRound,
        completed: job.completedRounds,
        failed: job.failedRounds,
        roundsProcessed,
      });
      console.log(JSON.stringify({ event: "watch_target_reached", currentRound: job.currentRound, roundsProcessed }));
      break;
    }

    await snap.prisma.$disconnect().catch(() => null);
    await sleep(POLL_MS);
  }

  console.log(JSON.stringify({ event: "watch_exit", jobId: JOB_ID }));
}

main().catch((e) => {
  appendLog({ event: "watch_error", error: (e as Error).message, stack: (e as Error).stack });
  console.error((e as Error).message);
  process.exit(1);
});
