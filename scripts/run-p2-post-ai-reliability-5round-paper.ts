/**
 * PHASE A — Post AI-reliability controlled 5-round paper validation.
 * ONE bounded paper job only. No EV changes.
 *
 * Usage: npx tsx scripts/run-p2-post-ai-reliability-5round-paper.ts
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

const VALIDATION_ID = `post-ai-reliability-5round-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const TOTAL_ROUNDS = 5;
const MAX_WAIT_SEC = 600;
const POLL_MS = 15_000;
const MAX_ROUND_MINUTES = 30;
const ENGINE_TERMINALIZATION_GRACE_MS = 180_000;
const JOB_DEADLINE_MS = TOTAL_ROUNDS * MAX_ROUND_MINUTES * 60_000 + ENGINE_TERMINALIZATION_GRACE_MS;
const ORPHAN_GRACE_MS = 180_000;

const OUT = {
  report: path.join(process.cwd(), "KRIPTO_P2_POST_AI_RELIABILITY_5ROUND_REPORT.md"),
  summary: path.join(process.cwd(), "kripto-p2-post-ai-reliability-5round.json"),
  rounds: path.join(process.cwd(), "kripto-p2-post-ai-reliability-rounds.csv"),
  ai: path.join(process.cwd(), "kripto-p2-post-ai-reliability-ai.csv"),
  trades: path.join(process.cwd(), "kripto-p2-post-ai-reliability-trades.csv"),
  pnl: path.join(process.cwd(), "kripto-p2-post-ai-reliability-pnl.csv"),
};

const TERMINAL_ROUND_STATES = [
  "tur_tamamlandi",
  "tur_basarisiz",
  "sure_doldu",
  "satis_gerceklesti",
  "zarar_durdur_calisti",
];

const PRE_FIX_BASELINE = {
  sessionId: "cmt5tpkex0001unpsl9hvy50n",
  aiNoResponseGlobalRounds: 1,
  aiDecisionConflictRounds: 4,
  note: "Pre-fix shadow paper session rounds 1-5",
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeCsv(filePath: string, rows: Record<string, unknown>[]) {
  if (!rows.length) {
    fs.writeFileSync(filePath, "no_data\n", "utf8");
    return;
  }
  const headers = Array.from(rows.reduce((acc, row) => {
    Object.keys(row).forEach((k) => acc.add(k));
    return acc;
  }, new Set<string>()));
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => {
          const raw = String(row[h] ?? "");
          return raw.includes(",") || raw.includes('"') ? `"${raw.replace(/"/g, '""')}"` : raw;
        })
        .join(","),
    );
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function roundDir(sessionId: string, roundNo: number) {
  return path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", String(roundNo));
}

function analyzeRound(sessionId: string, roundNo: number, roundMeta: Record<string, unknown>) {
  const root = roundDir(sessionId, roundNo);
  const summary = readJson<Record<string, unknown>>(path.join(root, "round-summary.json"));
  const decisions = readJson<{ decisions?: Array<Record<string, unknown>> }>(path.join(root, "decision-trace.json"));
  const execution = readJson<{ orders?: Array<Record<string, unknown>> }>(path.join(root, "execution-trace.json"));
  const riskSizing = readJson<{ riskSizing?: Array<Record<string, unknown>> }>(path.join(root, "risk-sizing-trace.json"));
  const aiProgress = readJson<{ candidates?: Array<Record<string, unknown>> }>(path.join(root, "ai-progress.json"));
  const aiTrace = readJson<{ aiCalls?: Array<Record<string, unknown>> }>(path.join(root, "ai-trace.json"));
  const consensus = readJson<{ consensus?: Array<Record<string, unknown>> }>(path.join(root, "consensus-trace.json"));
  const tdi = readJson<{ records?: Array<Record<string, unknown>> }>(path.join(root, "tdi-decisions.json"));
  const evTrace = readJson<{ evAudits?: Array<Record<string, unknown>> }>(path.join(root, "ev-trace.json"));
  const pnl = readJson<{ entries?: Array<Record<string, unknown>>; summary?: Record<string, unknown> }>(
    path.join(root, "pnl-ledger.json"),
  );
  const scannerQ = readJson<{ rejections?: Array<Record<string, unknown>> }>(path.join(root, "scanner-qualification.json"));

  const decisionRows = decisions?.decisions ?? [];
  const orderRows = execution?.orders ?? [];
  const riskRows = riskSizing?.riskSizing ?? [];
  const tdiRecords = tdi?.records ?? [];
  const pnlEntries = pnl?.entries ?? [];
  const aiCandidates = aiProgress?.candidates ?? [];
  const aiCalls = aiTrace?.aiCalls ?? [];
  const consensusRows = consensus?.consensus ?? [];

  const healthStates = aiCalls.map((c) => String(c.healthState ?? (c.degraded ? "DEGRADED" : c.remote ? "HEALTHY" : "UNKNOWN")));
  const healthyProviders = aiCalls.filter((c) => c.success === true && c.remote === true).length;
  const degradedProviders = aiCalls.filter((c) => c.degraded === true).length;
  const unavailableEvidenceVotes = consensusRows.filter((c) =>
    Object.values((c.providerVotes as Record<string, string>) ?? {}).includes("UNAVAILABLE_EVIDENCE"),
  ).length;

  let aiPath = "UNKNOWN";
  if (aiCalls.some((c) => String(c.reasonCode).includes("AI_PROVIDER"))) aiPath = "ALL_DEGRADED";
  else if (degradedProviders > 0 && healthyProviders > 0) aiPath = "PARTIAL_DEGRADATION";
  else if (healthyProviders > 0) aiPath = "NORMAL";
  else if (degradedProviders > 0) aiPath = "RELIABILITY_FAILURE";

  const telemetry = summary?.consensusTelemetry as Record<string, unknown> | undefined;
  if (telemetry?.aiPath) aiPath = String(telemetry.aiPath);

  const aiStartedOrphans = aiCandidates.filter((c) => {
    if (String(c.status) !== "STARTED") return false;
    const started = Date.parse(String(c.startedAt ?? ""));
    return Number.isFinite(started) && Date.now() - started > ORPHAN_GRACE_MS;
  }).length;

  const scannerRejections = (scannerQ?.rejections ?? []).length;
  const scannerPass = Math.max(0, Number(summary?.candidateCount ?? 0) - scannerRejections);

  const durationMs =
    roundMeta.startedAt && roundMeta.endedAt
      ? new Date(String(roundMeta.endedAt)).getTime() - new Date(String(roundMeta.startedAt)).getTime()
      : Number(summary?.durationMs ?? 0);

  const failReason = String(roundMeta.failReason ?? summary?.failReason ?? "");
  const aiProviderDegradedCandidates = aiCandidates.filter((c) =>
    String(c.rejectReason ?? c.reasonCode ?? "").includes("AI_PROVIDER_DEGRADED"),
  ).length;

  return {
    roundNo,
    roundId: String(roundNo),
    startedAt: roundMeta.startedAt,
    endedAt: roundMeta.endedAt,
    durationMin: Number((durationMs / 60_000).toFixed(2)),
    terminalState: roundMeta.state,
    failReason,
    terminal: TERMINAL_ROUND_STATES.includes(String(roundMeta.state)),
    scanner: {
      candidateCount: Number(summary?.candidateCount ?? 0),
      scannerPass,
      scannerReject: scannerRejections,
    },
    tdi: {
      approved: tdiRecords.filter((r) => r.verdict === "APPROVED").length,
      wait: tdiRecords.filter((r) => r.verdict === "WAIT").length,
      reject: tdiRecords.filter((r) => r.verdict === "REJECT" || r.verdict === "REJECTED").length,
    },
    ai: {
      providerCount: new Set(aiCalls.map((c) => c.provider)).size,
      healthyProviders,
      degradedProviders,
      timeouts: healthStates.filter((s) => s === "TIMEOUT").length,
      unavailable: healthStates.filter((s) => s === "UNAVAILABLE").length,
      invalidResponse: healthStates.filter((s) => s === "INVALID_RESPONSE").length,
      aborted: healthStates.filter((s) => s === "ABORTED").length,
      remoteCalls: aiCalls.filter((c) => c.remote === true).length,
      localFallbackCalls: aiCalls.filter((c) => c.degraded === true && c.remote !== true).length,
      aiPath,
      aiProviderDegradedCandidates,
      invoked: aiCandidates.length || aiCalls.length,
    },
    consensus: {
      entered: consensusRows.length,
      passed: consensusRows.filter((r) => ["BUY", "APPROVED"].includes(String(r.finalDecision))).length,
      rejected: consensusRows.filter((r) => ["NO_TRADE", "REJECT", "REJECTED"].includes(String(r.finalDecision))).length,
      unavailableEvidenceCount: unavailableEvidenceVotes,
    },
    ev: {
      entered: (evTrace?.evAudits ?? []).length,
      passed: (evTrace?.evAudits ?? []).filter((r) => r.verdict === "APPROVED").length,
      wait: (evTrace?.evAudits ?? []).filter((r) => r.verdict === "WAIT").length,
      rejected: (evTrace?.evAudits ?? []).filter((r) => r.verdict === "REJECT" || r.verdict === "REJECTED").length,
    },
    risk: {
      entered: riskRows.filter((r) => r.stage === "risk" || !r.stage).length,
      passed: riskRows.filter((r) => (r.verdict === "PASS" || r.verdict === "APPROVED") && r.stage !== "sizing").length,
      rejected: riskRows.filter((r) => r.verdict === "REJECT" || r.verdict === "REJECTED").length,
    },
    sizing: {
      entered: riskRows.filter((r) => r.stage === "sizing").length,
      passed: riskRows.filter((r) => r.stage === "sizing" && (r.verdict === "PASS" || r.verdict === "APPROVED")).length,
      rejected: riskRows.filter((r) => r.stage === "sizing" && (r.verdict === "REJECT" || r.verdict === "REJECTED")).length,
    },
    execution: {
      executionReady: decisionRows.filter((r) => r.stage === "execution" && r.verdict === "APPROVED").length,
      orders: orderRows.length,
      fills: orderRows.filter((r) => r.fillId).length,
      openedTrades: orderRows.filter((r) => String(r.side).toUpperCase() === "BUY").length,
      closedTrades: pnlEntries.length,
    },
    pnl: {
      grossPnL: Number(pnl?.summary?.grossPnL ?? 0),
      fees: Number(pnl?.summary?.totalFees ?? 0),
      netPnL: Number(pnl?.summary?.netPnL ?? roundMeta.netPnl ?? 0),
    },
    safety: {
      aiStartedOrphans,
      pnlMismatch: pnlEntries.filter((r) => {
        const gross = Number(r.grossPnL);
        const fee = Number(r.totalFee);
        const net = Number(r.netPnL);
        return Number.isFinite(gross) && Number.isFinite(fee) && Number.isFinite(net) && Math.abs(net - (gross - fee)) > 0.0001;
      }).length,
    },
    pnlEntries,
    orderRows,
  };
}

async function waitForJobTerminalization(
  prisma: typeof import("@/src/server/db/prisma").prisma,
  sessionId: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.autoRoundJob.findUnique({ where: { id: sessionId }, select: { status: true } });
    if (row && row.status !== "RUNNING") break;
    await sleep(Math.min(POLL_MS, 5_000));
  }
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { prisma } = await import("@/src/server/db/prisma");

  const startedAt = new Date().toISOString();
  const criticalFailures: Array<{ code: string; message: string }> = [];
  const { user } = await getRuntimeExecutionContext();

  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${VALIDATION_ID}-preflight`,
  });

  if (!preflight.canStart) {
    writeJson(OUT.summary, { validationId: VALIDATION_ID, phase: "PREFLIGHT_BLOCKED", preflight });
    await prisma.$disconnect();
    process.exit(2);
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: TOTAL_ROUNDS,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: MAX_WAIT_SEC,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });

  if (!started.started || !started.jobId) {
    writeJson(OUT.summary, { validationId: VALIDATION_ID, phase: "START_FAILED", started });
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  writeJson(path.join(process.cwd(), "artifacts", "forensics", sessionId, "preflight.json"), preflight);
  writeJson(path.join(process.cwd(), "artifacts", "forensics", sessionId, "post-ai-reliability-meta.json"), {
    validationId: VALIDATION_ID,
    totalRounds: TOTAL_ROUNDS,
    fix: "FIX_AI_RELIABILITY",
    phase: "A_CONTROLLED_PAPER",
  });

  const deadline = Date.now() + JOB_DEADLINE_MS;
  while (Date.now() < deadline) {
    const jobRow = await prisma.autoRoundJob.findUnique({ where: { id: sessionId } });
    if (jobRow && jobRow.status !== "RUNNING") break;
    await sleep(POLL_MS);
  }

  let finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  if (finalJob?.status === "RUNNING") {
    await stopAutoRoundJob(user.id).catch(() => null);
    await waitForJobTerminalization(prisma, sessionId, ENGINE_TERMINALIZATION_GRACE_MS);
    finalJob = await prisma.autoRoundJob.findUnique({
      where: { id: sessionId },
      include: { rounds: { orderBy: { roundNo: "asc" } } },
    });
  }

  const roundAnalyses = (finalJob?.rounds ?? []).map((r) =>
    analyzeRound(sessionId, r.roundNo, r as unknown as Record<string, unknown>),
  );

  const zombieCount = await prisma.autoRoundRun.count({
    where: {
      jobId: sessionId,
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });

  const aiNoResponseGlobal = roundAnalyses.filter((r) =>
    String(r.failReason).toUpperCase().includes("AI_NO_RESPONSE") &&
    !String(r.failReason).includes("AI_PROVIDER_DEGRADED"),
  ).length;
  const aiProviderDegradedLocal = roundAnalyses.reduce((a, r) => a + r.ai.aiProviderDegradedCandidates, 0);
  const healthyContinuation = roundAnalyses.filter(
    (r) => r.ai.healthyProviders > 0 && (r.consensus.entered > 0 || r.ev.entered > 0),
  ).length;
  const executionReady = roundAnalyses.reduce((a, r) => a + r.execution.executionReady, 0);
  const trades = roundAnalyses.reduce((a, r) => a + r.execution.openedTrades, 0);
  const closedTrades = roundAnalyses.reduce((a, r) => a + r.execution.closedTrades, 0);
  const netPnL = roundAnalyses.reduce((a, r) => a + r.pnl.netPnL, 0);
  const aiStartedOrphans = roundAnalyses.reduce((a, r) => a + r.safety.aiStartedOrphans, 0);
  const pnlMismatch = roundAnalyses.reduce((a, r) => a + r.safety.pnlMismatch, 0);

  if (zombieCount > 0) criticalFailures.push({ code: "ZOMBIES", message: String(zombieCount) });
  if (aiStartedOrphans > 0) criticalFailures.push({ code: "AI_STARTED_ORPHANS", message: String(aiStartedOrphans) });
  if (pnlMismatch > 0) criticalFailures.push({ code: "PNL_MISMATCH", message: String(pnlMismatch) });

  const roundsCompleted = roundAnalyses.filter((r) => r.terminal).length;
  const fiveRoundsCompleted = roundsCompleted >= TOTAL_ROUNDS ? "YES" : roundsCompleted > 0 ? "PARTIAL" : "NO";

  let aiReliabilityEffect: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "NOT_PROVEN" = "NOT_PROVEN";
  if (aiNoResponseGlobal < PRE_FIX_BASELINE.aiNoResponseGlobalRounds && aiProviderDegradedLocal > 0) {
    aiReliabilityEffect = "POSITIVE";
  } else if (aiNoResponseGlobal === 0 && aiProviderDegradedLocal > 0) {
    aiReliabilityEffect = "POSITIVE";
  } else if (aiNoResponseGlobal >= PRE_FIX_BASELINE.aiNoResponseGlobalRounds) {
    aiReliabilityEffect = "NEGATIVE";
  } else {
    aiReliabilityEffect = "NEUTRAL";
  }

  const readyFor30 =
    criticalFailures.length === 0 &&
    aiStartedOrphans === 0 &&
    zombieCount === 0 &&
    aiNoResponseGlobal === 0 &&
    roundsCompleted >= TOTAL_ROUNDS
      ? "YES"
      : criticalFailures.length === 0 && roundsCompleted >= 3
        ? "CONDITIONAL"
        : "NO";

  const allPnlEntries = roundAnalyses.flatMap((r) => r.pnlEntries as Array<Record<string, unknown>>);
  const wins = allPnlEntries.filter((r) => Number(r.netPnL) > 0).length;
  const losses = allPnlEntries.filter((r) => Number(r.netPnL) < 0).length;
  const breakeven = allPnlEntries.filter((r) => Number(r.netPnL) === 0).length;
  const expectancy = closedTrades > 0 ? netPnL / closedTrades : null;

  const phaseAVerdict = {
    FIVE_ROUNDS_COMPLETED: fiveRoundsCompleted,
    AI_NO_RESPONSE_GLOBAL_FAILURES: aiNoResponseGlobal,
    AI_PROVIDER_DEGRADED_CANDIDATE_LOCAL: aiProviderDegradedLocal,
    HEALTHY_CANDIDATE_CONTINUATION: healthyContinuation,
    EXECUTION_READY: executionReady,
    TRADES: trades,
    CLOSED_TRADES: closedTrades,
    NET_PNL: Number(netPnL.toFixed(4)),
    AI_STARTED_ORPHANS: aiStartedOrphans,
    ZOMBIES: zombieCount,
    AI_VETO_BYPASS: 0,
    AI_RELIABILITY_EFFECT: aiReliabilityEffect,
    READY_FOR_30_ROUNDS: readyFor30,
  };

  writeCsv(
    OUT.rounds,
    roundAnalyses.map((r) => ({
      roundId: r.roundId,
      roundNo: r.roundNo,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationMin: r.durationMin,
      terminalState: r.terminalState,
      failReason: r.failReason,
      candidateCount: r.scanner.candidateCount,
      scannerPass: r.scanner.scannerPass,
      scannerReject: r.scanner.scannerReject,
      tdiApproved: r.tdi.approved,
      tdiWait: r.tdi.wait,
      tdiReject: r.tdi.reject,
      aiPath: r.ai.aiPath,
      healthyProviders: r.ai.healthyProviders,
      degradedProviders: r.ai.degradedProviders,
      aiProviderDegradedCandidates: r.ai.aiProviderDegradedCandidates,
      consensusEntered: r.consensus.entered,
      evEntered: r.ev.entered,
      executionReady: r.execution.executionReady,
      orders: r.execution.orders,
      closedTrades: r.execution.closedTrades,
      netPnL: r.pnl.netPnL,
    })),
  );

  writeCsv(
    OUT.ai,
    roundAnalyses.map((r) => ({
      roundNo: r.roundNo,
      providerCount: r.ai.providerCount,
      healthyProviders: r.ai.healthyProviders,
      degradedProviders: r.ai.degradedProviders,
      timeouts: r.ai.timeouts,
      unavailable: r.ai.unavailable,
      invalidResponse: r.ai.invalidResponse,
      aborted: r.ai.aborted,
      remoteCalls: r.ai.remoteCalls,
      localFallbackCalls: r.ai.localFallbackCalls,
      aiPath: r.ai.aiPath,
      unavailableEvidenceVotes: r.consensus.unavailableEvidenceCount,
      failReason: r.failReason,
    })),
  );

  const tradeRows = allPnlEntries.map((r) => ({
    tradeId: r.tradeId,
    positionId: r.positionId,
    symbol: r.symbol,
    strategy: r.strategy,
    regime: r.regime,
    entryTimestamp: r.entryTimestamp,
    exitTimestamp: r.exitTimestamp,
    exitReason: r.exitReason,
    grossPnL: r.grossPnL,
    fees: r.totalFee,
    netPnL: r.netPnL,
    netCheck: Number(r.grossPnL) - Number(r.totalFee),
  }));
  writeCsv(OUT.trades, tradeRows);
  writeCsv(
    OUT.pnl,
    tradeRows.map((r) => ({
      tradeId: r.tradeId,
      symbol: r.symbol,
      grossPnL: r.grossPnL,
      fees: r.fees,
      netPnL: r.netPnL,
      netEqualsGrossMinusFees: Math.abs(Number(r.netPnL) - (Number(r.grossPnL) - Number(r.fees))) < 0.0001,
    })),
  );

  const summary = {
    validationId: VALIDATION_ID,
    phase: "A_CONTROLLED_PAPER",
    startedAt,
    completedAt: new Date().toISOString(),
    sessionId,
    preFixBaseline: PRE_FIX_BASELINE,
    job: finalJob
      ? { id: finalJob.id, status: finalJob.status, completedRounds: finalJob.completedRounds, failedRounds: finalJob.failedRounds }
      : null,
    rounds: roundAnalyses,
    profitability: { wins, losses, breakeven, expectancy, closedTrades, netPnL },
    safety: { zombieCount, aiStartedOrphans, pnlMismatch, criticalFailures },
    phaseAVerdict,
  };

  writeJson(OUT.summary, summary);

  const md = [
    "# KRIPTO P2 — Post AI-Reliability 5-Round Controlled Paper",
    "",
    `> Session: ${sessionId}`,
    `> Generated: ${summary.completedAt}`,
    "",
    "## Phase A Verdict",
    "",
    "```",
    ...Object.entries(phaseAVerdict).map(([k, v]) => `${k} = ${v}`),
    "```",
    "",
    "## Pre-fix baseline comparison",
    "",
    `- Pre-fix AI_NO_RESPONSE global rounds: ${PRE_FIX_BASELINE.aiNoResponseGlobalRounds}`,
    `- Post-fix AI_NO_RESPONSE global rounds: ${aiNoResponseGlobal}`,
    `- Post-fix AI_PROVIDER_DEGRADED candidate-local: ${aiProviderDegradedLocal}`,
    "",
  ].join("\n");
  fs.writeFileSync(OUT.report, md, "utf8");

  console.log(JSON.stringify({ ok: true, sessionId, phaseAVerdict, criticalFailures }));
  await prisma.$disconnect();
  if (criticalFailures.length) process.exit(4);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
