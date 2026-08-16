/**
 * Controlled 5-round paper validation (P0/P1/P2 runtime proof).
 * Does NOT modify strategy, thresholds, or safety gates.
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

const VALIDATION_ID = `5round-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const TOTAL_ROUNDS = 5;
const MAX_WAIT_SEC = 600;
const POLL_MS = 15_000;
const JOB_DEADLINE_MS = 75 * 60_000;

const EXPECTED_ARTIFACTS = [
  "round-summary.json",
  "candidate-lifecycle.json",
  "ai-trace.json",
  "decision-trace.json",
  "risk-sizing-trace.json",
  "execution-trace.json",
  "position-trace.json",
  "exit-trace.json",
  "pnl-ledger.json",
  "fee-aware-entry-policy.json",
  "strategy-performance.json",
  "scanner-qualification.json",
  "tdi-decisions.json",
  "slot-opportunity-report.json",
  "mean-reversion-audit.json",
  "entry-timing.json",
  "ev-calibration.json",
];

const TERMINAL_ROUND_STATES = [
  "tur_tamamlandi",
  "tur_basarisiz",
  "sure_doldu",
  "satis_gerceklesti",
  "zarar_durdur_calisti",
];

const BLOCKING_AI = new Set(["NO_TRADE", "HOLD", "REJECT", "WAIT"]);

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function readJson<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function roundDir(sessionId: string, roundId: string) {
  return path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", roundId);
}

type CriticalFailure = {
  code: string;
  message: string;
  roundId?: string;
  details?: Record<string, unknown>;
};

function validateAiGate(input: {
  roundId: string;
  decisions: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  aiGatePolicy: string;
}): CriticalFailure[] {
  const failures: CriticalFailure[] = [];
  if (input.aiGatePolicy !== "VETO") return failures;

  const gateBlocks = input.decisions.filter(
    (row) =>
      row.stage === "execution" &&
      (row.verdict === "REJECT" || row.reasonCode === "NO_TRADE" || String(row.executionVerdict) === "AI_GATE_BLOCK"),
  );

  for (const order of input.orders) {
    const side = String(order.side ?? "").toUpperCase();
    if (side !== "BUY" && side !== "SELL") continue;
    const aiVerdict = String(order.aiVerdict ?? "").toUpperCase();
    const execVerdict = String(order.executionVerdict ?? "");
    if (BLOCKING_AI.has(aiVerdict) && execVerdict !== "AI_ADVISORY_ONLY") {
      failures.push({
        code: "AI_VETO_BYPASS",
        message: "Order created despite blocking AI verdict under VETO policy",
        roundId: input.roundId,
        details: {
          symbol: order.symbol,
          aiVerdict,
          executionVerdict: execVerdict,
          orderId: order.orderId,
          candidateId: order.candidateId,
        },
      });
    }
  }

  for (const row of input.decisions) {
    if (row.stage !== "execution") continue;
    const aiVerdict = String(row.aiVerdict ?? row.reasonCode ?? "").toUpperCase();
    const execVerdict = String(row.executionVerdict ?? row.verdict ?? "");
    if (
      BLOCKING_AI.has(aiVerdict) &&
      execVerdict === "AI_GATE_PASS" &&
      input.orders.some((o) => String(o.symbol).toUpperCase() === String(row.symbol).toUpperCase())
    ) {
      failures.push({
        code: "AI_GATE_CONTRADICTION",
        message: "AI blocking verdict paired with AI_GATE_PASS and order for same symbol",
        roundId: input.roundId,
        details: { symbol: row.symbol, aiVerdict, executionVerdict: execVerdict },
      });
    }
  }

  if (gateBlocks.length === 0 && input.orders.length === 0) {
    // zero-trade round — not a gate failure
  }

  return failures;
}

function validateFees(entries: Array<Record<string, unknown>>, roundId: string): CriticalFailure[] {
  const failures: CriticalFailure[] = [];
  for (const row of entries) {
    const gross = Number(row.grossPnL);
    const totalFee = Number(row.totalFee);
    const net = Number(row.netPnL);
    const expected = gross - totalFee;
    if (!Number.isFinite(gross) || !Number.isFinite(totalFee) || !Number.isFinite(net)) continue;
    if (Math.abs(net - expected) > 0.0001) {
      failures.push({
        code: "PNL_FEE_MISMATCH",
        message: "netPnL != grossPnL - totalFee",
        roundId,
        details: { tradeId: row.tradeId, symbol: row.symbol, grossPnL: gross, totalFee, netPnL: net, expected },
      });
    }
  }
  return failures;
}

function validateTdiWait(records: Array<Record<string, unknown>>, roundId: string) {
  const warnings: string[] = [];
  const distribution: Record<string, number> = {};
  for (const row of records) {
    if (String(row.verdict).toUpperCase() !== "WAIT") continue;
    const code = String(row.waitReasonCode ?? "MISSING");
    distribution[code] = (distribution[code] ?? 0) + 1;
    if (!row.waitReasonCode) {
      warnings.push(`TDI WAIT missing waitReasonCode for ${row.symbol}`);
    }
  }
  return { distribution, warnings };
}

function analyzeRound(sessionId: string, roundNo: number, roundMeta: Record<string, unknown>) {
  const rid = String(roundNo);
  const root = roundDir(sessionId, rid);
  const exists = fs.existsSync(root);
  const missingArtifacts = EXPECTED_ARTIFACTS.filter((f) => !fs.existsSync(path.join(root, f)));

  const summary = readJson<Record<string, unknown>>(path.join(root, "round-summary.json"));
  const decisions = readJson<{ decisions?: Array<Record<string, unknown>> }>(path.join(root, "decision-trace.json"));
  const execution = readJson<{ orders?: Array<Record<string, unknown>> }>(path.join(root, "execution-trace.json"));
  const riskSizing = readJson<{ riskSizing?: Array<Record<string, unknown>> }>(path.join(root, "risk-sizing-trace.json"));
  const aiTrace = readJson<{ aiCalls?: Array<Record<string, unknown>> }>(path.join(root, "ai-trace.json"));
  const consensus = readJson<{ consensus?: unknown[]; audits?: unknown[] }>(path.join(root, "consensus-trace.json"));
  const pnl = readJson<{ entries?: Array<Record<string, unknown>>; summary?: Record<string, unknown> }>(
    path.join(root, "pnl-ledger.json"),
  );
  const tdi = readJson<{ records?: Array<Record<string, unknown>> }>(path.join(root, "tdi-decisions.json"));
  const slot = readJson<Record<string, unknown>>(path.join(root, "slot-opportunity-report.json"));
  const mr = readJson<{ entries?: Array<Record<string, unknown>> }>(path.join(root, "mean-reversion-audit.json"));
  const entryTiming = readJson<{ records?: Array<Record<string, unknown>> }>(path.join(root, "entry-timing.json"));
  const scannerQ = readJson<{ rejections?: Array<Record<string, unknown>> }>(
    path.join(root, "scanner-qualification.json"),
  );
  const feePolicy = readJson<{ evaluations?: Array<Record<string, unknown>> }>(
    path.join(root, "fee-aware-entry-policy.json"),
  );
  const watchdog = readJson<Record<string, unknown>>(path.join(root, "round-watchdog.json"));
  const tx = readJson<{ records?: Array<Record<string, unknown>> }>(path.join(root, "transaction-duration.json"));
  const recovery = readJson<{ records?: unknown[] }>(path.join(root, "recovery-telemetry.json"));
  const resolvedConfig = readJson<Record<string, unknown>>(path.join(root, "resolved-config.json"));
  const aiProgress = readJson<{ candidates?: Array<Record<string, unknown>> }>(path.join(root, "ai-progress.json"));

  const decisionRows = decisions?.decisions ?? [];
  const orderRows = execution?.orders ?? [];
  const riskRows = riskSizing?.riskSizing ?? [];
  const pnlEntries = pnl?.entries ?? [];
  const tdiRecords = tdi?.records ?? [];
  const aiGatePolicy = String(process.env.EXECUTION_AI_GATE_POLICY ?? "VETO");

  const aiGateFailures = validateAiGate({
    roundId: rid,
    decisions: decisionRows,
    orders: orderRows,
    aiGatePolicy,
  });
  const feeFailures = validateFees(pnlEntries, rid);
  const tdiWait = validateTdiWait(tdiRecords, rid);

  const exitReasons: Record<string, number> = {};
  const exitModels: Record<string, number> = {};
  for (const row of pnlEntries) {
    const reason = String(row.exitReason ?? "UNKNOWN");
    exitReasons[reason] = (exitReasons[reason] ?? 0) + 1;
    const model = String((row.exitForensics as Record<string, unknown> | undefined)?.exitModel ?? row.exitModel ?? "UNKNOWN");
    exitModels[model] = (exitModels[model] ?? 0) + 1;
  }

  const aiCandidates = aiProgress?.candidates ?? [];
  const aiInvoked = aiCandidates.length || (aiTrace?.aiCalls?.length ?? 0);
  const aiSuccess = aiCandidates.filter((r) => r.status === "COMPLETED").length;
  const aiFailed = aiCandidates.filter((r) => r.status === "AI_FAILED").length;
  const remoteCount = (aiTrace?.aiCalls ?? []).filter((r) => r.remote === true).length;
  const degradedCount = (aiTrace?.aiCalls ?? []).filter((r) => r.degraded === true).length;

  const riskPassed = riskRows.filter((r) => r.verdict === "PASS" || r.verdict === "APPROVED").length;
  const riskRejected = riskRows.filter((r) => r.verdict === "REJECT" || r.verdict === "FAILED").length;
  const sizingPassed = riskRows.filter((r) => r.stage === "sizing" && (r.verdict === "PASS" || r.verdict === "APPROVED")).length;
  const sizingRejected = riskRows.filter((r) => r.stage === "sizing" && (r.verdict === "REJECT" || r.verdict === "FAILED")).length;

  const tdiApprovals = tdiRecords.filter((r) => r.verdict === "APPROVED").length;
  const tdiWaitCount = tdiRecords.filter((r) => r.verdict === "WAIT").length;
  const tdiRejects = tdiRecords.filter((r) => r.verdict === "REJECT").length;

  const terminal = TERMINAL_ROUND_STATES.includes(String(roundMeta.state));
  const durationMs =
    roundMeta.startedAt && roundMeta.endedAt
      ? new Date(String(roundMeta.endedAt)).getTime() - new Date(String(roundMeta.startedAt)).getTime()
      : Number(summary?.durationMs ?? 0);

  return {
    roundNo,
    roundId: rid,
    dbRunId: roundMeta.id,
    state: roundMeta.state,
    symbol: roundMeta.symbol,
    result: roundMeta.result,
    failReason: roundMeta.failReason,
    netPnl: roundMeta.netPnl,
    terminal,
    durationMs,
    durationMin: Number((durationMs / 60_000).toFixed(2)),
    artifactRoot: root,
    artifactsExist: exists,
    missingArtifacts,
    roundManifestExists: fs.existsSync(path.join(root, "round-manifest.json")),
    candidateCount: Number(summary?.candidateCount ?? 0),
    tdi: { tdiApprovals, tdiWait: tdiWaitCount, tdiRejects, waitReasonDistribution: tdiWait.distribution, tdiWarnings: tdiWait.warnings },
    sizing: { sizingPassedCount: sizingPassed, sizingRejectedCount: sizingRejected },
    risk: { riskPassedCount: riskPassed, riskRejectedCount: riskRejected },
    ai: {
      aiInvokedCount: aiInvoked,
      aiSuccessCount: aiSuccess,
      aiFailedCount: aiFailed,
      remoteCount,
      degradedCount,
      consensusCount: (consensus?.consensus ?? []).length,
    },
    execution: {
      executionReadyCount: decisionRows.filter((r) => r.stage === "execution" && r.verdict === "APPROVED").length,
      ordersCreatedCount: orderRows.length,
      fillsCount: orderRows.filter((r) => r.fillId).length,
    },
    positions: {
      positionsOpened: orderRows.filter((r) => String(r.side).toUpperCase() === "BUY").length,
      positionsClosed: pnlEntries.length,
      openPositionsAtEnd: Math.max(0, orderRows.filter((r) => String(r.side).toUpperCase() === "BUY").length - pnlEntries.length),
    },
    exit: { exitReasons, exitModels, exitEdgeNotProven: Object.keys(exitReasons).every((k) => k === "END_OF_REPLAY") && pnlEntries.length > 0 },
    pnl: {
      grossPnL: Number(pnl?.summary?.grossPnL ?? summary?.grossPnL ?? 0),
      totalFees: Number(pnl?.summary?.totalFees ?? summary?.fees ?? 0),
      netPnL: Number(pnl?.summary?.netPnL ?? summary?.netPnL ?? roundMeta.netPnl ?? 0),
      tradeCount: pnlEntries.length,
    },
    runtime: {
      watchdogDecision: watchdog?.decision,
      txCount: (tx?.records ?? []).length,
      txTimeouts: (tx?.records ?? []).filter((r) => r.classification === "TIMEOUT").length,
      recoveryCount: (recovery?.records ?? []).length,
    },
    p0: {
      aiGatePolicy,
      aiGateFailures: aiGateFailures,
      feeFailures,
      criticalFailures: [...aiGateFailures, ...feeFailures],
    },
    p1: {
      meanReversionEntries: (mr?.entries ?? []).length,
      mrComplete: (mr?.entries ?? []).every(
        (e) => e.regime && e.volatilityBucket && e.trendStrength !== undefined && e.side && e.entryTimingClass,
      ),
      scannerQualificationRejections: (scannerQ?.rejections ?? []).length,
      entryTimingRecords: (entryTiming?.records ?? []).length,
    },
    p2: {
      slotReportRows: Array.isArray((slot as { rows?: unknown[] })?.rows) ? (slot as { rows: unknown[] }).rows.length : 0,
      feePolicyEvaluations: (feePolicy?.evaluations ?? []).length,
    },
    resolvedConfig: resolvedConfig ? { maxPositions: resolvedConfig.maxPositions, exchange: resolvedConfig.exchange } : null,
  };
}

async function compareDbTrade(
  prisma: typeof import("@/src/server/db/prisma").prisma,
  sessionId: string,
  roundAnalysis: ReturnType<typeof analyzeRound>,
) {
  if (roundAnalysis.pnl.tradeCount === 0) return null;

  const run = await prisma.autoRoundRun.findFirst({
    where: { jobId: sessionId, roundNo: roundAnalysis.roundNo },
  });
  if (!run?.symbol) return { status: "NO_DB_ROUND_TRADE", roundNo: roundAnalysis.roundNo };

  const artifactEntry = readJson<{ entries?: Array<Record<string, unknown>> }>(
    path.join(roundAnalysis.artifactRoot, "pnl-ledger.json"),
  )?.entries?.[0];
  if (!artifactEntry) return { status: "NO_ARTIFACT_ENTRY", roundNo: roundAnalysis.roundNo };

  const dbNet = Number(run.netPnl ?? 0);
  const dbFees = Number(run.feeTotal ?? 0);
  const artNet = Number(artifactEntry.netPnL);
  const artFees = Number(artifactEntry.totalFee ?? 0);
  const symbolMatch = String(run.symbol).toUpperCase() === String(artifactEntry.symbol).toUpperCase();

  return {
    status:
      Math.abs(dbNet - artNet) <= 0.05 && Math.abs(dbFees - artFees) <= 0.05 && symbolMatch
        ? "AGREE"
        : "MISMATCH",
    roundNo: roundAnalysis.roundNo,
    symbol: run.symbol,
    db: { netPnl: dbNet, feeTotal: dbFees, buyPrice: run.buyPrice, sellPrice: run.sellPrice },
    artifact: {
      netPnL: artNet,
      totalFee: artFees,
      grossPnL: artifactEntry.grossPnL,
      exitReason: artifactEntry.exitReason,
    },
    runtimeSummary: readJson(path.join(roundAnalysis.artifactRoot, "round-summary.json")),
    delta: { netPnl: Math.abs(dbNet - artNet), fees: Math.abs(dbFees - artFees) },
    symbolMatch,
  };
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus, stopAutoRoundJob } = await import(
    "@/src/server/execution/auto-round-engine.service"
  );
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const criticalFailures: CriticalFailure[] = [];
  const startedAt = new Date().toISOString();

  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${VALIDATION_ID}-preflight`,
  });

  if (!preflight.canStart) {
    const blocked = {
      validationId: VALIDATION_ID,
      phase: "PREFLIGHT_BLOCKED",
      preflight,
      productionReadiness: "NOT_READY",
    };
    writeJson(path.join(process.cwd(), "kripto-5round-paper-validation.json"), blocked);
    console.log(JSON.stringify(blocked, null, 2));
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
    const fail = { validationId: VALIDATION_ID, phase: "START_FAILED", started, preflight };
    writeJson(path.join(process.cwd(), "kripto-5round-paper-validation.json"), fail);
    console.log(JSON.stringify(fail, null, 2));
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  const sessionRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId);
  writeJson(path.join(sessionRoot, "preflight.json"), preflight);

  const deadline = Date.now() + JOB_DEADLINE_MS;
  let lastStatus: Awaited<ReturnType<typeof getAutoRoundStatus>> | null = null;
  while (Date.now() < deadline) {
    lastStatus = await getAutoRoundStatus(user.id);
    const jobRow = await prisma.autoRoundJob.findUnique({ where: { id: sessionId } });
    if (jobRow && jobRow.status !== "RUNNING") break;
    await sleep(POLL_MS);
  }

  const finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  if (finalJob?.status === "RUNNING") {
    await stopAutoRoundJob(user.id).catch(() => null);
    criticalFailures.push({
      code: "JOB_TIMEOUT",
      message: `Job still RUNNING after ${JOB_DEADLINE_MS / 60_000} minutes`,
    });
  }

  const roundAnalyses = (finalJob?.rounds ?? []).map((r) =>
    analyzeRound(sessionId, r.roundNo, r as unknown as Record<string, unknown>),
  );

  for (const ra of roundAnalyses) {
    criticalFailures.push(...ra.p0.criticalFailures);
    if (!ra.terminal) {
      criticalFailures.push({
        code: "ROUND_NOT_TERMINAL",
        message: `Round ${ra.roundNo} state=${ra.state}`,
        roundId: ra.roundId,
      });
    }
    if (!ra.artifactsExist) {
      criticalFailures.push({
        code: "ARTIFACTS_MISSING",
        message: `Round ${ra.roundNo} forensic export missing`,
        roundId: ra.roundId,
      });
    }
  }

  const zombieCount = await prisma.autoRoundRun.count({
    where: {
      jobId: sessionId,
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });
  if (zombieCount > 0) {
    criticalFailures.push({ code: "ZOMBIE_ROUNDS", message: `${zombieCount} zombie run(s) after job end` });
  }

  const tradeRound = roundAnalyses.find((r) => r.pnl.tradeCount > 0);
  const dbConsistency = tradeRound ? await compareDbTrade(prisma, sessionId, tradeRound) : { status: "NO_TRADES", message: "Zero trades across 5 rounds — pipeline blocking stage analysis required" };

  const allPnl = roundAnalyses.flatMap((r) => {
    const p = readJson<{ entries?: Array<Record<string, unknown>> }>(path.join(r.artifactRoot, "pnl-ledger.json"));
    return p?.entries ?? [];
  });
  const wins = allPnl.filter((r) => Number(r.netPnL) > 0).length;
  const losses = allPnl.filter((r) => Number(r.netPnL) < 0).length;
  const grossPnL = allPnl.reduce((a, r) => a + Number(r.grossPnL ?? 0), 0);
  const totalFees = allPnl.reduce((a, r) => a + Number(r.totalFee ?? 0), 0);
  const netPnL = allPnl.reduce((a, r) => a + Number(r.netPnL ?? 0), 0);

  const stopEarly = criticalFailures.some((f) =>
    ["AI_VETO_BYPASS", "AI_GATE_CONTRADICTION", "PNL_FEE_MISMATCH"].includes(f.code),
  );

  const terminalRounds = roundAnalyses.filter((r) => r.terminal).length;
  let productionReadiness: "NOT_READY" | "CONDITIONAL_READY" | "READY" = "NOT_READY";
  if (stopEarly || criticalFailures.some((f) => f.code.startsWith("AI_") || f.code === "PNL_FEE_MISMATCH")) {
    productionReadiness = "NOT_READY";
  } else if (terminalRounds === TOTAL_ROUNDS && zombieCount === 0 && criticalFailures.length === 0) {
    productionReadiness = "READY";
  } else if (terminalRounds >= 3 && !stopEarly) {
    productionReadiness = "CONDITIONAL_READY";
  }

  const result = {
    validationId: VALIDATION_ID,
    startedAt,
    completedAt: new Date().toISOString(),
    sessionId,
    config: {
      mode: "PAPER",
      exchange: process.env.BINANCE_PLATFORM ?? "tr",
      aiGatePolicy: process.env.EXECUTION_AI_GATE_POLICY ?? "VETO",
      maxWaitSec: MAX_WAIT_SEC,
      totalRounds: TOTAL_ROUNDS,
    },
    preflight: {
      canStart: preflight.canStart,
      overallVerdict: preflight.overallVerdict,
      checks: preflight.checks,
      artifactPath: path.join(sessionRoot, "preflight.json"),
    },
    job: finalJob
      ? {
          id: finalJob.id,
          status: finalJob.status,
          completedRounds: finalJob.completedRounds,
          failedRounds: finalJob.failedRounds,
          lastError: finalJob.lastError,
          finishedAt: finalJob.finishedAt,
        }
      : null,
    rounds: roundAnalyses,
    profitability: {
      classification: "NOT_PROVEN",
      trades: allPnl.length,
      wins,
      losses,
      grossPnL: Number(grossPnL.toFixed(4)),
      fees: Number(totalFees.toFixed(4)),
      netPnL: Number(netPnL.toFixed(4)),
      note: "5-round validation sample only — not a profitability proof",
    },
    dbConsistency,
    criticalFailures,
    stopEarly,
    zombieCount,
    terminalRounds,
    productionReadiness,
    lastStatus,
  };

  writeJson(path.join(process.cwd(), "kripto-5round-paper-validation.json"), result);
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  process.exit(stopEarly ? 10 : criticalFailures.length > 0 ? 11 : 0);
}

main().catch(async (e) => {
  console.error(JSON.stringify({ validationId: VALIDATION_ID, ok: false, error: (e as Error).message, stack: (e as Error).stack }, null, 2));
  process.exit(1);
});
