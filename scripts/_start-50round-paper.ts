/**
 * One-shot 50-round paper campaign launcher (validation-only, no policy changes).
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

const ATTEMPT_ID = `50round-${new Date().toISOString().replace(/[:.]/g, "-")}`;

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { startAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${ATTEMPT_ID}-preflight`,
  });

  if (!preflight.canStart) {
    const blocked = { phase: "PREFLIGHT_BLOCKED", attemptId: ATTEMPT_ID, preflight };
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    process.exit(2);
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 50,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: 600,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });

  const payload = {
    phase: started.started ? "STARTED" : "START_FAILED",
    attemptId: ATTEMPT_ID,
    startedAt: new Date().toISOString(),
    config: {
      targetRounds: 50,
      mode: "PAPER",
      aiMode: "learning",
      exchange: process.env.BINANCE_PLATFORM ?? "tr",
      maxWaitSec: 600,
    },
    preflight: {
      canStart: preflight.canStart,
      overallVerdict: preflight.overallVerdict,
      checks: preflight.checks,
    },
    started,
  };

  if (started.started && started.jobId) {
    const sessionRoot = path.join(process.cwd(), "artifacts", "forensics", started.jobId);
    fs.mkdirSync(sessionRoot, { recursive: true });
    fs.writeFileSync(path.join(sessionRoot, "preflight.json"), `${JSON.stringify(preflight, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(sessionRoot, "campaign-start.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify(payload, null, 2));
  await prisma.$disconnect();
  process.exit(started.started ? 0 : 3);
}

main().catch(async (e) => {
  console.error(JSON.stringify({ ok: false, error: (e as Error).message, stack: (e as Error).stack }, null, 2));
  process.exit(1);
});
