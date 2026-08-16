/**
 * Keeps a recovered paper scheduler alive in this process (dev server may be hung).
 * Usage: npx tsx scripts/hold-paper-scheduler.ts [jobId]
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

const jobIdArg = process.argv[2];
const HOLDER_FLAG = path.join(process.cwd(), "artifacts", "monitor", "paper-scheduler-holder.pid");

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function withDbRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: Error | null = null;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      if (i < attempts) {
        console.log(JSON.stringify({ at: new Date().toISOString(), retry: `${label} attempt ${i}/${attempts}`, error: lastError.message }));
        await sleep(5_000);
      }
    }
  }
  throw lastError ?? new Error(`${label} failed`);
}

async function main() {
  const { triggerSchedulerRecovery, ensureAutoRoundRecovery } = await import(
    "@/src/server/execution/auto-round-engine.service"
  );
  const { prisma } = await import("@/src/server/db/prisma");

  const job =
    jobIdArg ??
    (
      await withDbRetry("findRunningJob", () =>
        prisma.autoRoundJob.findFirst({
          where: { status: "RUNNING" },
          orderBy: { startedAt: "desc" },
          select: { id: true },
        }),
      )
    )?.id;

  if (!job) {
    console.log(JSON.stringify({ ok: false, reason: "No RUNNING job" }));
    await prisma.$disconnect();
    process.exit(1);
  }

  const recovery = await withDbRetry("triggerSchedulerRecovery", () =>
    triggerSchedulerRecovery({ jobId: job, force: true }),
  );
  const boot = await withDbRetry("ensureAutoRoundRecovery", () => ensureAutoRoundRecovery());
  console.log(JSON.stringify({ ok: true, jobId: job, recovery, recoveredLoops: boot.recoveredLoops }, null, 2));
  console.log(JSON.stringify({ ok: true, message: "Scheduler holder active — do not exit this process", jobId: job }));
  fs.mkdirSync(path.dirname(HOLDER_FLAG), { recursive: true });
  fs.writeFileSync(HOLDER_FLAG, String(process.pid), "utf8");

  process.on("exit", () => {
    try {
      if (fs.existsSync(HOLDER_FLAG) && fs.readFileSync(HOLDER_FLAG, "utf8").trim() === String(process.pid)) {
        fs.unlinkSync(HOLDER_FLAG);
      }
    } catch {
      // ignore
    }
  });

  setInterval(async () => {
    try {
      const row = await withDbRetry("holderHeartbeat", () =>
        prisma.autoRoundJob.findUnique({
          where: { id: job },
          select: { status: true, currentRound: true, activeState: true, stopRequested: true },
        }),
      );
      console.log(JSON.stringify({ at: new Date().toISOString(), job: row }));
      if (!row || row.status !== "RUNNING" || row.stopRequested) {
        console.log(JSON.stringify({ ok: true, message: "Job no longer RUNNING — holder exiting", status: row?.status }));
        await prisma.$disconnect();
        process.exit(0);
      }
    } catch (e) {
      console.log(JSON.stringify({ at: new Date().toISOString(), holderHeartbeatError: (e as Error).message }));
    }
  }, 60_000);
}

main().catch(async (e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message }));
  process.exit(1);
});
