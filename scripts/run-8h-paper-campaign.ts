/**
 * 8-hour wall-clock PAPER campaign runner.
 * Uses a single campaign ID, heartbeat checkpoints, and graceful stop.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

process.env.EXECUTION_MODE = "paper";
process.env.LIVE_TRADING_ENABLED = "false";
process.env.LIVE_TRADING_ACK = "false";
process.env.LIVE_AUTHORIZATION = "DISABLED";
process.env.CANONICAL_RUNTIME_ENFORCE_NO_LEGACY_PERSIST = "true";

const cli = Object.fromEntries(
  process.argv
    .slice(2)
    .map((arg) => arg.trim())
    .filter((arg) => arg.startsWith("--"))
    .map((arg) => {
      const [k, ...rest] = arg.slice(2).split("=");
      return [k, rest.length ? rest.join("=") : "true"];
    }),
);

const DURATION_HOURS = Number(cli.durationHours ?? cli.hours ?? 8);
const DURATION_MS = DURATION_HOURS * 60 * 60 * 1000;
const CAMPAIGN_ID = String(cli.campaignId ?? `paper-8h-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const HEARTBEAT_MS = Number(cli.heartbeatMs ?? 5 * 60_000);
const POLL_MS = Number(cli.pollMs ?? 15_000);
const MAX_WAIT_SEC = Number(cli.maxWaitSec ?? 600);
const BUDGET_PER_TRADE = Number(cli.budgetPerTrade ?? 1000);
const ARTIFACT_ROOT = path.join(process.cwd(), "artifacts", "paper-campaigns", CAMPAIGN_ID);
const RESULT_FILE = String(cli.out ?? "kripto-8h-paper-result.json");

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function appendCheckpoint(event: Record<string, unknown>) {
  const checkpointPath = path.join(ARTIFACT_ROOT, "checkpoints.jsonl");
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
  fs.appendFileSync(checkpointPath, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, "utf8");
}

async function main() {
  const startedAtMs = Date.now();
  const deadlineMs = startedAtMs + DURATION_MS;
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus, stopAutoRoundJob } = await import(
    "@/src/server/execution/auto-round-engine.service"
  );
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const configSnapshot = {
    EXECUTION_MODE: process.env.EXECUTION_MODE,
    LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED,
    LIVE_AUTHORIZATION: process.env.LIVE_AUTHORIZATION,
    PAPER_INITIAL_BALANCE_TRY: process.env.PAPER_INITIAL_BALANCE_TRY ?? null,
    DURATION_HOURS,
    CAMPAIGN_ID,
    BUDGET_PER_TRADE,
    MAX_WAIT_SEC,
  };
  const configHash = createHash("sha256").update(JSON.stringify(configSnapshot)).digest("hex");
  writeJson(path.join(ARTIFACT_ROOT, "frozen-config.json"), { ...configSnapshot, configHash });

  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${CAMPAIGN_ID}-preflight`,
  });
  writeJson(path.join(ARTIFACT_ROOT, "preflight.json"), preflight);
  if (!preflight.canStart) {
    const blocked = { campaignId: CAMPAIGN_ID, phase: "PREFLIGHT_BLOCKED", preflight, endedAt: new Date().toISOString() };
    writeJson(path.join(process.cwd(), RESULT_FILE), blocked);
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    process.exit(2);
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 10_000,
    budgetPerTrade: BUDGET_PER_TRADE,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: MAX_WAIT_SEC,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });
  if (!started.started || !started.jobId) {
    const fail = { campaignId: CAMPAIGN_ID, phase: "START_FAILED", started };
    writeJson(path.join(process.cwd(), RESULT_FILE), fail);
    await prisma.$disconnect();
    process.exit(3);
  }

  const jobId = started.jobId;
  let lastHeartbeat = 0;
  let gracefulStopRequested = false;
  const onSignal = () => {
    gracefulStopRequested = true;
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  appendCheckpoint({ type: "START", jobId, durationHours: DURATION_HOURS, userId: user.id });

  while (Date.now() < deadlineMs && !gracefulStopRequested) {
    const now = Date.now();
    if (now - lastHeartbeat >= HEARTBEAT_MS) {
      const status = await getAutoRoundStatus(user.id).catch(() => null);
      const openPositions = await prisma.position.count({ where: { userId: user.id, status: "OPEN" } });
      appendCheckpoint({
        type: "HEARTBEAT",
        elapsedMs: now - startedAtMs,
        remainingMs: deadlineMs - now,
        jobStatus: status?.status ?? null,
        openPositions,
      });
      lastHeartbeat = now;
    }
    const job = await prisma.autoRoundJob.findUnique({ where: { id: jobId } });
    if (job && job.status !== "RUNNING") break;
    await sleep(POLL_MS);
  }

  await stopAutoRoundJob(user.id).catch(() => null);
  const endedAtMs = Date.now();
  const finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: jobId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  const openPositions = await prisma.position.findMany({
    where: { userId: user.id, status: "OPEN" },
    select: { id: true, quantity: true, entryPrice: true, unrealizedPnl: true, metadata: true },
  });
  const closedPaper = await prisma.paperTrade.findMany({ where: { userId: user.id, status: "CLOSED" } });
  const realizedPnl = closedPaper.reduce((s, r) => s + Number(r.realizedPnl ?? 0), 0);
  const unrealizedPnl = openPositions.reduce((s, r) => s + Number(r.unrealizedPnl ?? 0), 0);
  const result = {
    campaignId: CAMPAIGN_ID,
    jobId,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    plannedDurationHours: DURATION_HOURS,
    actualDurationMs: endedAtMs - startedAtMs,
    completedFullDuration: endedAtMs - startedAtMs >= DURATION_MS - POLL_MS,
    gracefulStopRequested,
    configHash,
    frozenConfig: configSnapshot,
    roundsCompleted: finalJob?.rounds?.filter((r) => r.endedAt != null).length ?? 0,
    tradeCount: closedPaper.length,
    openPositionCount: openPositions.length,
    realizedPnl,
    unrealizedPnl,
    netEquityDelta: realizedPnl + unrealizedPnl,
    openPositions,
    finalJobStatus: finalJob?.status ?? null,
    artifactRoot: ARTIFACT_ROOT,
  };
  writeJson(path.join(ARTIFACT_ROOT, "final-snapshot.json"), result);
  writeJson(path.join(process.cwd(), RESULT_FILE), result);
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
