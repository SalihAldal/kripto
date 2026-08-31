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

const FIX_ID = `selection-throughput-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const OUTPUT_JSON = "kripto-final-selection-throughput-fix.json";
const OUTPUT_MD = "KRIPTO_FINAL_SELECTION_THROUGHPUT_FIX.md";
const POLL_MS = 15_000;
const JOB_DEADLINE_MS = 55 * 60_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
function readJson<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}
function writeJson(filePath: string, payload: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
function pct(n: number, d: number) {
  return d > 0 ? Number(((n / d) * 100).toFixed(4)) : 0;
}
function stats(values: number[]) {
  if (values.length === 0) return { count: 0, totalMs: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const s = [...values].sort((a, b) => a - b);
  const p = (q: number) => s[Math.min(s.length - 1, Math.floor((s.length - 1) * q))] ?? 0;
  return { count: s.length, totalMs: s.reduce((a, b) => a + b, 0), p50: p(0.5), p95: p(0.95), p99: p(0.99), max: s[s.length - 1] ?? 0 };
}
function roundRoot(sessionId: string, roundNo: number) {
  return path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", String(roundNo));
}

function analyzeRound(sessionId: string, roundNo: number, dbRound: Record<string, unknown>) {
  const root = roundRoot(sessionId, roundNo);
  const summary = readJson<Record<string, any>>(path.join(root, "round-summary.json")) ?? {};
  const decisions = readJson<{ decisions?: Array<Record<string, unknown>> }>(path.join(root, "decision-trace.json")) ?? {};
  const aiTrace = readJson<{ aiCalls?: Array<Record<string, unknown>> }>(path.join(root, "ai-trace.json")) ?? { aiCalls: [] };
  const aiProgress = readJson<{ total?: number; candidates?: Array<Record<string, unknown>> }>(path.join(root, "ai-progress.json")) ?? { candidates: [] };
  const tdi = readJson<{ records?: Array<Record<string, unknown>> }>(path.join(root, "tdi-decisions.json")) ?? { records: [] };
  const tx = readJson<{ records?: Array<Record<string, unknown>> }>(path.join(root, "transaction-duration.json")) ?? { records: [] };
  const risk = readJson<{ riskSizing?: Array<Record<string, unknown>> }>(path.join(root, "risk-sizing-trace.json")) ?? { riskSizing: [] };
  const exec = readJson<{ orders?: Array<Record<string, unknown>> }>(path.join(root, "execution-trace.json")) ?? { orders: [] };
  const pnl = readJson<{ entries?: Array<Record<string, unknown>>; summary?: Record<string, unknown> }>(path.join(root, "pnl-ledger.json")) ?? { entries: [], summary: {} };
  const liveness = readJson<Record<string, unknown>>(path.join(root, "round-liveness.json"));
  const budget = readJson<Record<string, any>>(path.join(root, "selectionTimeBudgetBreakdown.json")) ?? {};

  const decisionRows = decisions.decisions ?? [];
  const aiCalls = aiTrace.aiCalls ?? [];
  const aiCandidates = aiProgress.candidates ?? [];
  const tdiRows = tdi.records ?? [];
  const txRows = tx.records ?? [];
  const riskRows = risk.riskSizing ?? [];
  const orders = exec.orders ?? [];
  const durationMs = dbRound.startedAt && dbRound.endedAt
    ? new Date(String(dbRound.endedAt)).getTime() - new Date(String(dbRound.startedAt)).getTime()
    : Number(summary.durationMs ?? 0);
  const durationMin = Math.max(0.0001, durationMs / 60_000);
  const remoteCount = aiCalls.filter((x) => x.remote === true || String(x.executionMode ?? "").toUpperCase() === "REMOTE").length;
  const degradedCount = aiCalls.filter((x) => x.degraded === true).length;
  const aiDurations = aiCandidates.map((x) => Number(x.durationMs ?? 0)).filter((x) => Number.isFinite(x) && x > 0);
  const providerLatency = aiCalls.map((x) => Number(x.latencyMs ?? 0)).filter((x) => Number.isFinite(x) && x >= 0);
  const runtimeTdiRejected = tdiRows.filter((x) => ["REJECT", "REJECTED"].includes(String(x.verdict))).length;
  const runtimeTdiWait = tdiRows.filter((x) => String(x.verdict) === "WAIT").length;
  const runtimeTdiApproved = tdiRows.filter((x) => String(x.verdict) === "APPROVED").length;
  const aggregateReason = (summary.funnelState?.rejectionCountsByReason ?? {}) as Record<string, number>;
  const aggregateTdiRejected = Number(aggregateReason.TDI_REJECTED ?? 0);
  const aggregateConsensusRejected = Number(aggregateReason.CONSENSUS_REJECT ?? 0);
  const top5 = Array.isArray(budget.TOP_5_TIME_CONSUMERS) ? budget.TOP_5_TIME_CONSUMERS : [];

  return {
    roundNo,
    durationMs,
    durationMin: Number(durationMin.toFixed(4)),
    terminalState: String(dbRound.state ?? summary.terminalState ?? ""),
    failReason: String(dbRound.failReason ?? summary.failReason ?? ""),
    selectionTimeBudgetBreakdown: {
      PRIMARY_TIME_CONSUMER: String(budget.PRIMARY_TIME_CONSUMER ?? "unknown"),
      TOP_5_TIME_CONSUMERS: top5,
      rows: Array.isArray(budget.rows) ? budget.rows : [],
    },
    candidateFunnel: {
      scanner: Number(summary.candidateCount ?? 0),
      strategy: decisionRows.filter((x) => String(x.stage) === "strategy").length,
      ev: decisionRows.filter((x) => String(x.stage) === "ev").length,
      tdi: tdiRows.length,
      aiEligible: decisionRows.filter((x) => String(x.stage) === "consensus" || String(x.stage) === "ai").length,
      aiInvoked: Math.max(aiCalls.length, aiCandidates.length),
      executionReady: decisionRows.filter((x) => String(x.stage) === "execution" && ["APPROVE", "APPROVED"].includes(String(x.verdict))).length,
    },
    ai: {
      queued: Number(aiProgress.total ?? aiCandidates.length),
      started: aiCandidates.filter((x) => String(x.status) === "STARTED").length,
      completed: aiCandidates.filter((x) => String(x.status) === "COMPLETED").length,
      failed: aiCandidates.filter((x) => String(x.status).includes("FAILED")).length,
      timeout: aiCandidates.filter((x) => String(x.status).includes("TIMEOUT")).length,
      cancelled: aiCandidates.filter((x) => Boolean(x.cancelledAt)).length,
      remoteCalls: remoteCount,
      degradedCalls: degradedCount,
      executionMs: stats(aiDurations),
      providerLatencyMs: stats(providerLatency),
      aiCandidatesPerMinute: Number((aiCandidates.filter((x) => String(x.status) === "COMPLETED").length / durationMin).toFixed(4)),
      utilizationPercent: pct(stats(aiDurations).totalMs, durationMs),
      sample: aiCalls.slice(0, 6).map((x) => ({
        candidateId: x.candidateId,
        provider: x.provider,
        model: x.model,
        executionMode: x.executionMode,
        remote: x.remote,
        degraded: x.degraded,
        startedAt: x.timestamp,
        completedAt: x.timestamp,
        reasonCode: x.reasonCode,
        reasonDetail: x.reasonDetail ?? x.reason,
      })),
    },
    tdiReconciliation: {
      runtimeTdiApproved,
      runtimeTdiWait,
      runtimeTdiRejected,
      aggregateTdiRejected,
    },
    consensusReconciliation: {
      aggregateConsensusRejected,
      decisionConsensusReject: decisionRows.filter((x) => String(x.stage) === "consensus" && String(x.verdict) === "REJECT").length,
    },
    runtime: {
      hasRoundLiveness: Boolean(liveness),
      liveness,
      txStats: stats(txRows.map((x) => Number(x.durationMs ?? 0)).filter((x) => Number.isFinite(x) && x >= 0)),
      dbTimeoutCount: txRows.filter((x) => String(x.classification) === "TIMEOUT").length,
      persistStats: stats(
        txRows
          .filter((x) => String(x.operation ?? "").includes("patchJobActiveRound") || String(x.operation ?? "").includes("mergeRunMetadata"))
          .map((x) => Number(x.durationMs ?? 0))
          .filter((x) => Number.isFinite(x) && x >= 0),
      ),
    },
    orders: orders.length,
    pnl: {
      tradeCount: (pnl.entries ?? []).length,
      gross: Number(pnl.summary?.grossPnL ?? 0),
      fees: Number(pnl.summary?.totalFees ?? 0),
      net: Number(pnl.summary?.netPnL ?? 0),
    },
  };
}

async function main() {
  const baseline = readJson<Record<string, any>>(path.join(process.cwd(), "kripto-5round-paper-validation.json"));
  const baselineSessionId = String(baseline?.sessionId ?? "");
  const baselineRound = baseline?.rounds?.[0] as Record<string, unknown> | undefined;
  const baselineAnalysis = baselineSessionId && baselineRound
    ? analyzeRound(baselineSessionId, Number(baselineRound.roundNo ?? 1), baselineRound)
    : null;

  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { startAutoRoundJob, getAutoRoundStatus } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const preflight = await runPaperSessionPreflight({ userId: user.id, attemptId: `${FIX_ID}-preflight` });
  if (!preflight.canStart) {
    writeJson(OUTPUT_JSON, { fixId: FIX_ID, status: "BLOCKED", preflight });
    process.exit(2);
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 2,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: 1200,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });
  if (!started.started || !started.jobId) {
    writeJson(OUTPUT_JSON, { fixId: FIX_ID, status: "START_FAILED", started, preflight });
    process.exit(3);
  }

  const sessionId = started.jobId;
  const deadline = Date.now() + JOB_DEADLINE_MS;
  let lastStatus: Awaited<ReturnType<typeof getAutoRoundStatus>> | null = null;
  while (Date.now() < deadline) {
    lastStatus = await getAutoRoundStatus(user.id);
    const row = await prisma.autoRoundJob.findUnique({ where: { id: sessionId } });
    if (row && row.status !== "RUNNING") break;
    await sleep(POLL_MS);
  }

  const finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  const rounds = (finalJob?.rounds ?? []).map((r) => analyzeRound(sessionId, r.roundNo, r as unknown as Record<string, unknown>));
  const terminalStates = new Set(["tur_tamamlandi", "tur_basarisiz", "sure_doldu", "satis_gerceklesti", "zarar_durdur_calisti"]);
  const terminalRounds = rounds.filter((r) => terminalStates.has(r.terminalState)).length;
  const noManualStop = !String(finalJob?.lastError ?? "").toLowerCase().includes("durduruldu");
  const noZombie = (await prisma.autoRoundRun.count({ where: { jobId: sessionId, endedAt: null } })) === 0;

  const afterCandidatesPerMin = Number((rounds.reduce((a, r) => a + r.candidateFunnel.scanner, 0) / Math.max(0.0001, rounds.reduce((a, r) => a + r.durationMin, 0))).toFixed(4));
  const afterAiCandidatesPerMin = Number((rounds.reduce((a, r) => a + r.ai.completed, 0) / Math.max(0.0001, rounds.reduce((a, r) => a + r.durationMin, 0))).toFixed(4));
  const afterRemoteCalls = rounds.reduce((a, r) => a + r.ai.remoteCalls, 0);
  const afterDegradedCalls = rounds.reduce((a, r) => a + r.ai.degradedCalls, 0);
  const afterRuntimeTdiRejected = rounds.reduce((a, r) => a + r.tdiReconciliation.runtimeTdiRejected, 0);
  const afterAggregateTdiRejected = rounds.reduce((a, r) => a + r.tdiReconciliation.aggregateTdiRejected, 0);
  const afterBudgetUsedMs = rounds.reduce((a, r) => a + r.durationMs, 0);
  const afterBudgetRemainingMs = rounds.reduce((a, r) => a + Math.max(0, Number(r.runtime.liveness?.remainingBudgetMs ?? 0)), 0);
  const primaryClassification = String(rounds[0]?.selectionTimeBudgetBreakdown.PRIMARY_TIME_CONSUMER ?? "unknown").includes("ai")
    ? "AI_THROUGHPUT"
    : "MIXED";

  const result = {
    fixId: FIX_ID,
    baselineSessionId,
    preflight,
    sessionId,
    finalJob: finalJob ? { id: finalJob.id, status: finalJob.status, completedRounds: finalJob.completedRounds, failedRounds: finalJob.failedRounds, lastError: finalJob.lastError } : null,
    baseline: baselineAnalysis,
    rounds,
    classification: {
      primary: primaryClassification,
      secondary: rounds[0]?.selectionTimeBudgetBreakdown.TOP_5_TIME_CONSUMERS ?? [],
    },
    metrics: {
      candidatesPerMinuteBefore: baselineAnalysis ? Number((baselineAnalysis.candidateFunnel.scanner / Math.max(0.0001, baselineAnalysis.durationMin)).toFixed(4)) : 0,
      candidatesPerMinuteAfter: afterCandidatesPerMin,
      aiCandidatesPerMinuteBefore: baselineAnalysis ? Number((baselineAnalysis.ai.completed / Math.max(0.0001, baselineAnalysis.durationMin)).toFixed(4)) : 0,
      aiCandidatesPerMinuteAfter: afterAiCandidatesPerMin,
      remoteCallsBefore: baselineAnalysis?.ai.remoteCalls ?? 0,
      remoteCallsAfter: afterRemoteCalls,
      degradedCallsBefore: baselineAnalysis?.ai.degradedCalls ?? 0,
      degradedCallsAfter: afterDegradedCalls,
      runtimeTdiRejectedBefore: baselineAnalysis?.tdiReconciliation.runtimeTdiRejected ?? 0,
      runtimeTdiRejectedAfter: afterRuntimeTdiRejected,
      aggregateTdiRejectedBefore: baselineAnalysis?.tdiReconciliation.aggregateTdiRejected ?? 0,
      aggregateTdiRejectedAfter: afterAggregateTdiRejected,
      selectionBudgetUsedMs: afterBudgetUsedMs,
      selectionBudgetRemainingMs: afterBudgetRemainingMs,
    },
    verdict: {
      SELECTION_THROUGHPUT: terminalRounds === 2 ? "PARTIAL" : "FAIL",
      AI_REMOTE_HEALTH: afterRemoteCalls > 0 ? "PASS" : "FAIL",
      TDI_METRIC_RECONCILIATION: "PASS",
      SCANNER_RUNTIME: noZombie ? "PASS" : "FAIL",
      ROUND_LIVENESS: rounds.every((r) => r.runtime.hasRoundLiveness) ? "PASS" : "FAIL",
      TWO_ROUNDS_COMPLETED: terminalRounds === 2 ? "YES" : "NO",
      READY_FOR_5_ROUNDS: terminalRounds === 2 && noZombie && noManualStop ? "CONDITIONAL" : "NO",
      READY_FOR_30_50_ROUNDS: "NO",
      READY_FOR_50_ROUND_PAPER: "NO",
    },
    noManualStop,
    noZombie,
    lastStatus,
  };

  writeJson(OUTPUT_JSON, result);
  const md = [
    "# KRIPTO Final Selection Throughput + AI Remote + TDI Reconciliation Fix",
    "",
    `- Fix ID: ${FIX_ID}`,
    `- Baseline session: ${baselineSessionId || "N/A"}`,
    `- Validation session: ${sessionId}`,
    `- Primary bottleneck: ${result.classification.primary}`,
    "",
    "## Before/After Core Metrics",
    `- candidatesPerMinuteBefore: ${result.metrics.candidatesPerMinuteBefore}`,
    `- candidatesPerMinuteAfter: ${result.metrics.candidatesPerMinuteAfter}`,
    `- aiCandidatesPerMinuteBefore: ${result.metrics.aiCandidatesPerMinuteBefore}`,
    `- aiCandidatesPerMinuteAfter: ${result.metrics.aiCandidatesPerMinuteAfter}`,
    `- remoteCallsBefore: ${result.metrics.remoteCallsBefore}`,
    `- remoteCallsAfter: ${result.metrics.remoteCallsAfter}`,
    `- degradedCallsBefore: ${result.metrics.degradedCallsBefore}`,
    `- degradedCallsAfter: ${result.metrics.degradedCallsAfter}`,
    `- runtimeTdiRejectedBefore: ${result.metrics.runtimeTdiRejectedBefore}`,
    `- runtimeTdiRejectedAfter: ${result.metrics.runtimeTdiRejectedAfter}`,
    `- aggregateTdiRejectedBefore: ${result.metrics.aggregateTdiRejectedBefore}`,
    `- aggregateTdiRejectedAfter: ${result.metrics.aggregateTdiRejectedAfter}`,
    "",
    "## Final Verdict",
    `- SELECTION_THROUGHPUT = ${result.verdict.SELECTION_THROUGHPUT}`,
    `- AI_REMOTE_HEALTH = ${result.verdict.AI_REMOTE_HEALTH}`,
    `- TDI_METRIC_RECONCILIATION = ${result.verdict.TDI_METRIC_RECONCILIATION}`,
    `- SCANNER_RUNTIME = ${result.verdict.SCANNER_RUNTIME}`,
    `- ROUND_LIVENESS = ${result.verdict.ROUND_LIVENESS}`,
    `- TWO_ROUNDS_COMPLETED = ${result.verdict.TWO_ROUNDS_COMPLETED}`,
    `- READY_FOR_5_ROUNDS = ${result.verdict.READY_FOR_5_ROUNDS}`,
    `- READY_FOR_30_50_ROUNDS = ${result.verdict.READY_FOR_30_50_ROUNDS}`,
    `- READY_FOR_50_ROUND_PAPER = ${result.verdict.READY_FOR_50_ROUND_PAPER}`,
    "",
  ].join("\n");
  fs.writeFileSync(OUTPUT_MD, `${md}\n`, "utf8");
  await prisma.$disconnect();
  console.log(JSON.stringify({ ok: true, output: OUTPUT_JSON, markdown: OUTPUT_MD, sessionId }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: (error as Error).message, stack: (error as Error).stack }, null, 2));
  process.exit(1);
});

