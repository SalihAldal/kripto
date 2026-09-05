import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing required env var: ${name}`);
  return value.trim();
}

async function main() {
  const campaignId = process.argv[2] ?? `cmp:p5:${Date.now()}`;
  const safeAttemptId = `p5-${campaignId}`.replace(/[^a-zA-Z0-9-_]/g, "_");
  const durationHours = Number(process.argv[3] ?? 6);
  if (!Number.isFinite(durationHours) || durationHours <= 0) throw new Error("durationHours must be positive");
  const maxWaitSec = Math.max(60, Math.floor(durationHours * 3600));

  // Required runtime variables (names only; values never logged)
  requireEnv("DATABASE_URL");
  requireEnv("EXECUTION_MODE");
  requireEnv("EXCHANGE_MODE");
  requireEnv("LIVE_TRADING_ENABLED");

  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { startAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { beginForensicPaperSession } = await import("@/src/server/forensics/forensic-bridge.service");

  const { user } = await getRuntimeExecutionContext();
  const preflight = await runPaperSessionPreflight({ userId: user.id, attemptId: safeAttemptId });
  if (!preflight.canStart) {
    console.log(JSON.stringify({ ok: false, stage: "preflight", preflight }, null, 2));
    process.exit(2);
  }

  beginForensicPaperSession({
    sessionId: `p5-session-${Date.now()}`,
    jobId: `p5-job-${Date.now()}`,
    runId: `p5-run-${Date.now()}`,
    roundId: "1",
    campaignId,
  });

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 1,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        campaignId,
        durationHours,
        preflightVerdict: preflight.overallVerdict,
        started,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
  process.exit(1);
});
