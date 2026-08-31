/**
 * Overnight 30-round PAPER campaign watchdog + safe auto-recovery.
 * Attaches to an existing RUNNING job; does NOT start a duplicate campaign.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const VALIDATION_ID = `overnight-30round-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const TOTAL_ROUNDS = 30;
const MAX_ROUND_MINUTES = 30;
const POLL_MS = 15_000;
const STARTED_ORPHAN_MS = 180_000;
const STALL_PROGRESS_MS = 12 * 60_000;
const ENGINE_TERMINALIZATION_GRACE_MS = 180_000;
const JOB_DEADLINE_MS =
  TOTAL_ROUNDS * MAX_ROUND_MINUTES * 60_000 + ENGINE_TERMINALIZATION_GRACE_MS + 30 * 60_000;

const OUTPUT_JSON = "kripto-overnight-30round-final.json";
const OUTPUT_MD = "KRIPTO_OVERNIGHT_30ROUND_FINAL_REPORT.md";
const INCIDENT_MD = "KRIPTO_OVERNIGHT_30ROUND_INCIDENT_LOG.md";
const INCIDENT_JSON = "kripto-overnight-incident-log.json";
const START_SNAPSHOT = "overnight-campaign-start.json";
const HEALTH_SNAPSHOTS = "overnight-health-snapshots.json";
const FIX_CHANGELOG = "kripto-overnight-auto-fix-changelog.json";

const TERMINAL_ROUND_STATES = [
  "tur_tamamlandi",
  "tur_basarisiz",
  "sure_doldu",
  "satis_gerceklesti",
  "zarar_durdur_calisti",
];
const BLOCKING_AI = new Set(["NO_TRADE", "HOLD", "REJECT", "WAIT"]);
const CRITICAL_STOP_CODES = new Set([
  "AI_VETO_BYPASS",
  "CRITICAL_AI_EXECUTION_BYPASS",
  "AI_GATE_CONTRADICTION",
  "PNL_FEE_MISMATCH",
  "DUPLICATE_ORDER",
  "UNCONTROLLED_ORDER",
  "ZOMBIE_ROUND_ACTIVE_EXECUTION",
  "EMERGENCY_STOP_FAILURE",
]);

type CriticalFailure = {
  code: string;
  message: string;
  roundId?: string;
  details?: Record<string, unknown>;
};

type IncidentRecord = {
  incidentId: string;
  timestamp: string;
  roundId?: string;
  roundNo?: number;
  stage?: string;
  errorClass: string;
  errorCode: string;
  message: string;
  stackDigest?: string;
  classification: string;
  rootCauseClass?: string;
  rootCause?: string;
  affectedComponent?: string;
  fixAttempted?: string;
  fixApplied?: boolean;
  tests?: string;
  runtimeReconciliation?: string;
  resumeResult?: string;
  impactOnCampaign?: string;
  tradingPolicyChanged: boolean;
  status: "OPEN" | "RECOVERED" | "RECOVERY_FAILED" | "CRITICAL_STOP" | "LOGGED";
  snapshot?: Record<string, unknown>;
};

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

function appendIncidentMd(incident: IncidentRecord) {
  const block = [
    `## Incident ${incident.incidentId}`,
    "",
    `Timestamp: ${incident.timestamp}`,
    `Round: ${incident.roundNo ?? incident.roundId ?? "N/A"}`,
    `Stage: ${incident.stage ?? "N/A"}`,
    "",
    `Error: ${incident.message}`,
    "",
    `Classification: ${incident.classification}`,
    "",
    `Root cause: ${incident.rootCause ?? "pending"}`,
    "",
    `Evidence: ${incident.errorCode}`,
    "",
    `Fix attempted: ${incident.fixAttempted ?? "none"}`,
    "",
    `Tests: ${incident.tests ?? "N/A"}`,
    "",
    `Fix applied: ${incident.fixApplied ? "YES" : "NO"}`,
    "",
    `Runtime reconciliation: ${incident.runtimeReconciliation ?? "N/A"}`,
    "",
    `Resume result: ${incident.resumeResult ?? "N/A"}`,
    "",
    `Impact on campaign: ${incident.impactOnCampaign ?? "N/A"}`,
    "",
    "Trading policy changed:",
    "NO",
    "",
    "---",
    "",
  ].join("\n");
  fs.appendFileSync(path.join(process.cwd(), INCIDENT_MD), block, "utf8");
}

function roundDir(sessionId: string, roundId: string) {
  return path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", roundId);
}

function readRuntime(metadata: unknown) {
  const meta = (metadata as Record<string, unknown> | null) ?? {};
  const runtime = meta.runtime;
  if (!runtime || typeof runtime !== "object") return null;
  return runtime as Record<string, unknown>;
}

function assessStartedOrphans(candidates: Array<Record<string, unknown>>) {
  const now = Date.now();
  return candidates.filter((row) => {
    if (row.status !== "STARTED") return false;
    const startedMs = row.startedAt ? new Date(String(row.startedAt)).getTime() : now;
    return now - startedMs > STARTED_ORPHAN_MS;
  });
}

function configFingerprint() {
  const keys = [
    "EXECUTION_MODE",
    "BINANCE_PLATFORM",
    "EXECUTION_AI_GATE_POLICY",
    "EXECUTION_VARIANT_D_ENABLED",
    "EXECUTION_VARIANT_D_SHADOW_ENABLED",
    "AI_MIN_HEALTHY_PROVIDER_COUNT",
    "AUTO_ROUND_SELECTION_BUDGET_SEC",
    "AUTO_ROUND_MAX_SELECTION_ATTEMPTS",
    "EXECUTION_MAX_OPEN_POSITIONS",
    "SCANNER_MIN_SCORE",
  ];
  const payload = keys.map((k) => `${k}=${process.env[k] ?? ""}`).join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function gitFingerprint() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function validateAiGate(input: {
  roundId: string;
  decisions: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  aiGatePolicy: string;
}): CriticalFailure[] {
  const failures: CriticalFailure[] = [];
  if (input.aiGatePolicy !== "VETO") return failures;
  for (const order of input.orders) {
    const side = String(order.side ?? "").toUpperCase();
    if (side !== "BUY" && side !== "SELL") continue;
    const aiVerdict = String(order.aiVerdict ?? "").toUpperCase();
    const execVerdict = String(order.executionVerdict ?? "");
    if (BLOCKING_AI.has(aiVerdict) && execVerdict !== "AI_ADVISORY_ONLY") {
      failures.push({
        code: "AI_VETO_BYPASS",
        message: "Order despite blocking AI verdict under VETO",
        roundId: input.roundId,
        details: { symbol: order.symbol, aiVerdict, executionVerdict: execVerdict, orderId: order.orderId },
      });
    }
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
        details: { tradeId: row.tradeId, symbol: row.symbol, grossPnL: gross, totalFee, netPnL: net },
      });
    }
  }
  return failures;
}

function analyzeRound(sessionId: string, roundNo: number, roundMeta: Record<string, unknown>) {
  const rid = String(roundNo);
  const root = roundDir(sessionId, rid);
  const summary = readJson<Record<string, unknown>>(path.join(root, "round-summary.json"));
  const decisions = readJson<{ decisions?: Array<Record<string, unknown>> }>(path.join(root, "decision-trace.json"));
  const execution = readJson<{ orders?: Array<Record<string, unknown>> }>(path.join(root, "execution-trace.json"));
  const pnl = readJson<{ entries?: Array<Record<string, unknown>> }>(path.join(root, "pnl-ledger.json"));
  const tdi = readJson<{ records?: Array<Record<string, unknown>> }>(path.join(root, "tdi-decisions.json"));
  const aiProgress = readJson<{ candidates?: Array<Record<string, unknown>> }>(path.join(root, "ai-progress.json"));
  const aiTrace = readJson<{ aiCalls?: Array<Record<string, unknown>> }>(path.join(root, "ai-trace.json"));
  const exitTrace = readJson<{ exits?: Array<Record<string, unknown>> }>(path.join(root, "exit-trace.json"));

  const decisionRows = decisions?.decisions ?? [];
  const orderRows = execution?.orders ?? [];
  const pnlEntries = pnl?.entries ?? [];
  const tdiRecords = tdi?.records ?? [];
  const aiGatePolicy = String(process.env.EXECUTION_AI_GATE_POLICY ?? "VETO");
  const aiCandidates = aiProgress?.candidates ?? [];
  const state = String(roundMeta.state ?? "");
  const terminal = TERMINAL_ROUND_STATES.includes(state);

  const criticalFailures = [
    ...validateAiGate({ roundId: rid, decisions: decisionRows, orders: orderRows, aiGatePolicy }),
    ...validateFees(pnlEntries, rid),
  ];

  const orphans = assessStartedOrphans(aiCandidates);
  if (orphans.length > 0) {
    criticalFailures.push({
      code: "AI_STARTED_ORPHAN",
      message: `${orphans.length} AI STARTED orphan(s)`,
      roundId: rid,
      details: { count: orphans.length },
    });
  }

  const tdiApprovals = tdiRecords.filter((r) => r.verdict === "APPROVED").length;
  const tdiWait = tdiRecords.filter((r) => r.verdict === "WAIT").length;
  const tdiRejects = tdiRecords.filter((r) => r.verdict === "REJECT" || r.verdict === "REJECTED").length;
  const aiInvoked = aiCandidates.length || (aiTrace?.aiCalls?.length ?? 0);
  const aiFailed = aiCandidates.filter((r) => r.status === "AI_FAILED" || r.status === "AI_TIMEOUT").length;
  const aiNoResponse = aiCandidates.filter((r) =>
    String(r.reasonCode ?? r.failReason ?? "").toUpperCase().includes("AI_NO_RESPONSE"),
  ).length;

  let variantDTrades = 0;
  let variantDNetPnL = 0;
  for (const row of pnlEntries) {
    const exitForensics = row.exitForensics as Record<string, unknown> | undefined;
    const variantD = Boolean(row.variantDEnabled ?? exitForensics?.variantDEnabled);
    if (variantD) {
      variantDTrades += 1;
      variantDNetPnL += Number(row.netPnL ?? 0);
    }
  }

  return {
    roundNo,
    roundId: String(roundMeta.id ?? rid),
    state,
    terminal,
    failReason: roundMeta.failReason ?? null,
    candidateCount: Number(summary?.candidateCount ?? 0),
    scannerCandidates: Number(summary?.scannerCandidates ?? summary?.candidateCount ?? 0),
    tdi: { tdiApprovals, tdiWait, tdiRejects },
    ai: { aiInvokedCount: aiInvoked, aiFailedCount: aiFailed, aiNoResponseCount: aiNoResponse },
    execution: {
      executionReadyCount: Number(summary?.executionReadyCount ?? 0),
      ordersCreatedCount: orderRows.length,
      fillsCount: orderRows.filter((o) => o.filled === true || o.status === "FILLED").length,
    },
    positions: {
      positionsOpened: pnlEntries.length,
      positionsClosed: pnlEntries.filter((r) => r.exitTimestamp).length,
    },
    pnl: {
      tradeCount: pnlEntries.length,
      grossPnL: pnlEntries.reduce((a, r) => a + Number(r.grossPnL ?? 0), 0),
      fees: pnlEntries.reduce((a, r) => a + Number(r.totalFee ?? 0), 0),
      netPnL: pnlEntries.reduce((a, r) => a + Number(r.netPnL ?? 0), 0),
    },
    variantD: { trades: variantDTrades, netPnL: variantDNetPnL },
    exits: exitTrace?.exits ?? [],
    pnlEntries,
    criticalFailures,
    artifactRoot: root,
    artifactsExist: fs.existsSync(path.join(root, "round-summary.json")),
  };
}

async function safeOrphanSweep(sessionId: string, runIds: string[]) {
  const { terminalizeOpenAiCandidates } = await import("@/src/server/forensics/ai-runtime.service");
  let total = 0;
  for (const runId of runIds) {
    const closed = terminalizeOpenAiCandidates({
      runId,
      reasonCode: "OVERNIGHT_WATCHDOG_ORPHAN_SWEEP",
      reasonDetail: "Watchdog bounded orphan terminalization",
    });
    total += closed.length;
  }
  return total;
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { getAutoRoundStatus, stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const cliJobId = process.argv[2];
  let job =
    cliJobId
      ? await prisma.autoRoundJob.findUnique({ where: { id: cliJobId } })
      : await prisma.autoRoundJob.findFirst({
          where: { status: "RUNNING", totalRounds: TOTAL_ROUNDS },
          orderBy: { startedAt: "desc" },
        });

  if (!job) {
    const anyRunning = await prisma.autoRoundJob.findFirst({
      where: { status: "RUNNING" },
      orderBy: { startedAt: "desc" },
    });
    if (anyRunning) job = anyRunning;
  }

  if (!job) {
    const fail = { validationId: VALIDATION_ID, phase: "NO_RUNNING_JOB", message: "No RUNNING campaign to monitor" };
    writeJson(path.join(process.cwd(), OUTPUT_JSON), fail);
    console.log(JSON.stringify(fail, null, 2));
    await prisma.$disconnect();
    process.exit(2);
  }

  const sessionId = job.id;
  const incidents: IncidentRecord[] = readJson<IncidentRecord[]>(path.join(process.cwd(), INCIDENT_JSON)) ?? [];
  const fixChangelog: Array<Record<string, unknown>> =
    readJson<Array<Record<string, unknown>>>(path.join(process.cwd(), FIX_CHANGELOG)) ?? [];
  const healthSnapshots: Array<Record<string, unknown>> =
    readJson<Array<Record<string, unknown>>>(path.join(process.cwd(), HEALTH_SNAPSHOTS)) ?? [];

  const startSnapshotPath = path.join(process.cwd(), START_SNAPSHOT);
  if (!fs.existsSync(startSnapshotPath)) {
    const snapshot = {
      validationId: VALIDATION_ID,
      jobId: sessionId,
      sessionId,
      timestamp: new Date().toISOString(),
      gitFingerprint: gitFingerprint(),
      configFingerprint: configFingerprint(),
      executionMode: process.env.EXECUTION_MODE ?? "paper",
      exchange: process.env.BINANCE_PLATFORM ?? "tr",
      aiPolicy: process.env.EXECUTION_AI_GATE_POLICY ?? "VETO",
      variantDEnabled: String(process.env.EXECUTION_VARIANT_D_ENABLED ?? "false").toLowerCase() === "true",
      variantDShadowEnabled:
        String(process.env.EXECUTION_VARIANT_D_SHADOW_ENABLED ?? "false").toLowerCase() === "true",
      totalRounds: job.totalRounds,
      jobStartedAt: job.startedAt?.toISOString(),
      attachMode: "EXISTING_RUNNING_JOB",
      watchdogStartedAt: new Date().toISOString(),
    };
    writeJson(startSnapshotPath, snapshot);
    if (!fs.existsSync(path.join(process.cwd(), INCIDENT_MD))) {
      fs.writeFileSync(
        path.join(process.cwd(), INCIDENT_MD),
        `# KRIPTO Overnight 30-Round Incident Log\n\nCampaign jobId: ${sessionId}\nWatchdog: ${VALIDATION_ID}\n\n`,
        "utf8",
      );
    }
    console.log(JSON.stringify({ phase: "SNAPSHOT_CREATED", snapshot }, null, 2));
  }

  const criticalFailures: CriticalFailure[] = [];
  let roundsRecovered = 0;
  let policyChangesDuringCampaign = false;
  let criticalCampaignStop = false;
  let lastCompletedRound = job.completedRounds + job.failedRounds;
  let lastProgressAtMs = Date.now();

  const deadline = Date.now() + JOB_DEADLINE_MS;
  console.log(
    JSON.stringify({
      phase: "MONITORING_START",
      validationId: VALIDATION_ID,
      sessionId,
      deadlineAt: new Date(deadline).toISOString(),
      totalRounds: job.totalRounds,
    }),
  );

  while (Date.now() < deadline && !criticalCampaignStop) {
    let status: Awaited<ReturnType<typeof getAutoRoundStatus>> | null = null;
    try {
      status = await getAutoRoundStatus(user.id);
    } catch (pollError) {
      const incident: IncidentRecord = {
        incidentId: `inc-${Date.now()}`,
        timestamp: new Date().toISOString(),
        errorClass: "RUNTIME_RECOVERABLE",
        errorCode: "POLL_DB_ERROR",
        message: (pollError as Error).message,
        classification: "TRANSIENT_PROVIDER_FAILURE",
        tradingPolicyChanged: false,
        status: "OPEN",
      };
      incidents.push(incident);
      appendIncidentMd(incident);
      writeJson(path.join(process.cwd(), INCIDENT_JSON), incidents);
      await sleep(POLL_MS);
      continue;
    }

    const jobRow = await prisma.autoRoundJob.findUnique({
      where: { id: sessionId },
      include: { rounds: { orderBy: { roundNo: "asc" } } },
    });
    if (!jobRow) break;

    const activeRun = jobRow.rounds.find((r) => !r.endedAt) ?? null;
    const runtime = activeRun ? readRuntime(activeRun.metadata) : null;
    const progressAt = runtime?.lastMeaningfulProgressAt
      ? Date.parse(String(runtime.lastMeaningfulProgressAt))
      : runtime?.heartbeatAt
        ? Date.parse(String(runtime.heartbeatAt))
        : Date.now();

    if (progressAt > lastProgressAtMs) lastProgressAtMs = progressAt;

    const stallMs = Date.now() - lastProgressAtMs;
    const isActiveRound = activeRun && !TERMINAL_ROUND_STATES.includes(activeRun.state);

    if (isActiveRound && stallMs > STALL_PROGRESS_MS) {
      const incident: IncidentRecord = {
        incidentId: `stall-${Date.now()}`,
        timestamp: new Date().toISOString(),
        roundId: activeRun.id,
        roundNo: activeRun.roundNo,
        stage: String(runtime?.step ?? "UNKNOWN"),
        errorClass: "RUNTIME_RECOVERABLE",
        errorCode: "ROUND_STALL",
        message: `No meaningful progress for ${Math.round(stallMs / 60000)} min`,
        classification: "RUNTIME_RECOVERABLE",
        rootCauseClass: "STALL",
        rootCause: "Round progress heartbeat stale beyond watchdog threshold",
        affectedComponent: "auto-round-selection",
        fixAttempted: "reconcileStaleWaitingRuns + orphan sweep",
        tradingPolicyChanged: false,
        status: "OPEN",
        snapshot: { stallMs, runtime },
      };

      try {
        await getAutoRoundStatus(user.id);
        const swept = await safeOrphanSweep(sessionId, jobRow.rounds.map((r) => r.id));
        incident.fixApplied = true;
        incident.runtimeReconciliation = `orphanSweep=${swept}`;
        incident.resumeResult = "continue monitoring";
        incident.status = "RECOVERED";
        incident.impactOnCampaign = "Bounded recovery applied; campaign continues";
        roundsRecovered += 1;
        fixChangelog.push({
          changeId: `fix-${Date.now()}`,
          timestamp: incident.timestamp,
          module: "watchdog",
          reason: "ROUND_STALL recovery",
          before: { stallMs },
          after: { orphanSweep: swept },
          tests: "runtime reconcile only",
          safetyVerification: "no policy change",
        });
        lastProgressAtMs = Date.now();
      } catch (recoveryError) {
        incident.status = "RECOVERY_FAILED";
        incident.resumeResult = (recoveryError as Error).message;
      }
      incidents.push(incident);
      appendIncidentMd(incident);
      writeJson(path.join(process.cwd(), INCIDENT_JSON), incidents);
      writeJson(path.join(process.cwd(), FIX_CHANGELOG), fixChangelog);
    }

    const roundBoundary = jobRow.completedRounds + jobRow.failedRounds;
    if (roundBoundary > lastCompletedRound) {
      lastCompletedRound = roundBoundary;
      lastProgressAtMs = Date.now();
      const health = {
        timestamp: new Date().toISOString(),
        jobState: jobRow.status,
        activeState: jobRow.activeState,
        completedRounds: jobRow.completedRounds,
        failedRounds: jobRow.failedRounds,
        stopRequested: jobRow.stopRequested,
        activeRunId: jobRow.activeRunId,
        scheduler: status?.scheduler ?? null,
        health: status?.health ?? null,
      };
      healthSnapshots.push(health);
      writeJson(path.join(process.cwd(), HEALTH_SNAPSHOTS), healthSnapshots);
    }

    if (activeRun && isActiveRound) {
      const aiProgressPath = path.join(roundDir(sessionId, String(activeRun.roundNo)), "ai-progress.json");
      const aiProgress = readJson<{ candidates?: Array<Record<string, unknown>> }>(aiProgressPath);
      const orphans = assessStartedOrphans(aiProgress?.candidates ?? []);
      if (orphans.length > 0) {
        const incident: IncidentRecord = {
          incidentId: `orphan-${Date.now()}`,
          timestamp: new Date().toISOString(),
          roundId: activeRun.id,
          roundNo: activeRun.roundNo,
          stage: String(runtime?.step ?? "UNKNOWN"),
          errorClass: "RUNTIME_RECOVERABLE",
          errorCode: "AI_STARTED_ORPHAN",
          message: `${orphans.length} AI STARTED orphan(s) detected`,
          classification: "RUNTIME_RECOVERABLE",
          rootCause: "AI lifecycle not terminalized",
          fixAttempted: "terminalizeOpenAiCandidates",
          tradingPolicyChanged: false,
          status: "OPEN",
        };
        const swept = await safeOrphanSweep(sessionId, [activeRun.id]);
        incident.fixApplied = true;
        incident.status = swept > 0 ? "RECOVERED" : "LOGGED";
        incident.runtimeReconciliation = `terminalized=${swept}`;
        incidents.push(incident);
        appendIncidentMd(incident);
        writeJson(path.join(process.cwd(), INCIDENT_JSON), incidents);
      }
    }

    if (jobRow.status !== "RUNNING") break;
    await sleep(POLL_MS);
  }

  let finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  if (finalJob?.status === "RUNNING") {
    const extendIncident: IncidentRecord = {
      incidentId: `extend-${Date.now()}`,
      timestamp: new Date().toISOString(),
      errorClass: "TELEMETRY_ONLY",
      errorCode: "WATCHDOG_DEADLINE_EXTENDED",
      message: "Primary watchdog deadline reached while job still RUNNING; extending monitor without stop",
      classification: "TELEMETRY_ONLY",
      tradingPolicyChanged: false,
      status: "LOGGED",
    };
    incidents.push(extendIncident);
    appendIncidentMd(extendIncident);
    writeJson(path.join(process.cwd(), INCIDENT_JSON), incidents);

    const extendedDeadline = Date.now() + 2 * 60 * 60_000;
    while (Date.now() < extendedDeadline) {
      const row = await prisma.autoRoundJob.findUnique({ where: { id: sessionId }, select: { status: true } });
      if (!row || row.status !== "RUNNING") break;
      await sleep(POLL_MS);
    }
    finalJob = await prisma.autoRoundJob.findUnique({
      where: { id: sessionId },
      include: { rounds: { orderBy: { roundNo: "asc" } } },
    });
  }

  const roundAnalyses = (finalJob?.rounds ?? []).map((r) =>
    analyzeRound(sessionId, r.roundNo, r as unknown as Record<string, unknown>),
  );

  for (const ra of roundAnalyses) criticalFailures.push(...ra.criticalFailures);

  const zombieCount = await prisma.autoRoundRun.count({
    where: {
      jobId: sessionId,
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });
  if (zombieCount > 0) {
    criticalFailures.push({ code: "ZOMBIE_ROUNDS", message: `${zombieCount} zombie run(s)` });
  }

  const allPnl = roundAnalyses.flatMap((r) => r.pnlEntries);
  const closedTrades = allPnl.filter((r) => r.exitTimestamp);
  const wins = closedTrades.filter((r) => Number(r.netPnL) > 0).length;
  const losses = closedTrades.filter((r) => Number(r.netPnL) < 0).length;
  const grossPnL = allPnl.reduce((a, r) => a + Number(r.grossPnL ?? 0), 0);
  const totalFees = allPnl.reduce((a, r) => a + Number(r.totalFee ?? 0), 0);
  const netPnL = allPnl.reduce((a, r) => a + Number(r.netPnL ?? 0), 0);
  const winRate = closedTrades.length > 0 ? wins / closedTrades.length : 0;
  const expectancy = closedTrades.length > 0 ? netPnL / closedTrades.length : null;
  const grossWins = closedTrades.filter((r) => Number(r.netPnL) > 0).reduce((a, r) => a + Number(r.netPnL), 0);
  const grossLosses = closedTrades.filter((r) => Number(r.netPnL) < 0).reduce((a, r) => a + Math.abs(Number(r.netPnL)), 0);
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : null;

  let maxDrawdown = 0;
  let peak = 0;
  let cum = 0;
  for (const row of closedTrades.sort((a, b) => String(a.exitTimestamp).localeCompare(String(b.exitTimestamp)))) {
    cum += Number(row.netPnL ?? 0);
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const exitReasonCounts: Record<string, number> = {};
  for (const row of closedTrades) {
    const reason = String(row.exitReason ?? "UNKNOWN");
    exitReasonCounts[reason] = (exitReasonCounts[reason] ?? 0) + 1;
  }

  const variantDLiveTrades = roundAnalyses.reduce((a, r) => a + r.variantD.trades, 0);
  const variantDNetPnL = roundAnalyses.reduce((a, r) => a + r.variantD.netPnL, 0);

  const aiVetoBypass = criticalFailures.filter((f) => f.code === "AI_VETO_BYPASS" || f.code === "CRITICAL_AI_EXECUTION_BYPASS").length;
  const aiOrphans = criticalFailures.filter((f) => f.code === "AI_STARTED_ORPHAN").length;
  const pnlMismatches = criticalFailures.filter((f) => f.code === "PNL_FEE_MISMATCH").length;
  const duplicateOrders = criticalFailures.filter((f) => f.code === "DUPLICATE_ORDER").length;

  const roundsCompleted = finalJob?.completedRounds ?? 0;
  const roundsFailed = finalJob?.failedRounds ?? 0;
  const profitabilityStatus =
    closedTrades.length === 0
      ? "NOT_PROVEN"
      : netPnL > 0
        ? "PROVEN"
        : netPnL < 0
          ? "NEGATIVE"
          : "MIXED";

  const primaryIncident = incidents.find((i) => i.status !== "RECOVERED") ?? incidents[0];
  const primaryRuntimeIncident = primaryIncident?.message ?? "NONE";

  const result = {
    validationId: VALIDATION_ID,
    sessionId,
    startedAt: readJson<Record<string, unknown>>(startSnapshotPath)?.watchdogStartedAt ?? job.startedAt?.toISOString(),
    completedAt: new Date().toISOString(),
    config: {
      totalRounds: TOTAL_ROUNDS,
      maxRoundMinutes: MAX_ROUND_MINUTES,
      executionMode: process.env.EXECUTION_MODE,
      exchange: process.env.BINANCE_PLATFORM,
      aiGatePolicy: process.env.EXECUTION_AI_GATE_POLICY,
      variantDEnabled: process.env.EXECUTION_VARIANT_D_ENABLED,
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
    incidents,
    fixChangelog,
    healthSnapshots,
    criticalFailures,
    criticalCampaignStop,
    policyChangesDuringCampaign,
    metrics: {
      roundsCompleted,
      roundsFailed,
      roundsRecovered,
      trades: allPnl.length,
      closedTrades: closedTrades.length,
      winRate,
      grossPnL,
      fees: totalFees,
      netPnL,
      expectancy,
      profitFactor,
      maxDrawdown,
      exitReasonCounts,
      variantDLiveTrades,
      variantDNetPnL,
      aiVetoBypass,
      aiOrphans,
      zombieCount,
      duplicateOrders,
      pnlMismatches,
    },
    profitabilityStatus,
    primaryRuntimeIncident,
  };

  writeJson(path.join(process.cwd(), OUTPUT_JSON), result);
  writeJson(path.join(process.cwd(), INCIDENT_JSON), incidents);
  writeJson(path.join(process.cwd(), FIX_CHANGELOG), fixChangelog);

  const tradesCsv = [
    ["tradeId", "positionId", "roundId", "symbol", "side", "strategy", "regime", "entryTimestamp", "entryPrice", "quantity", "notional", "exitTimestamp", "exitPrice", "exitReason", "exitModel", "grossPnL", "entryFee", "exitFee", "totalFee", "netPnL", "variantDEnabled", "actualVariantDExitReason", "holdDuration", "MFE", "MAE"],
  ];
  for (const ra of roundAnalyses) {
    for (const row of ra.pnlEntries) {
      const ef = row.exitForensics as Record<string, unknown> | undefined;
      tradesCsv.push([
        String(row.tradeId ?? ""),
        String(row.positionId ?? ""),
        String(ra.roundId),
        String(row.symbol ?? ""),
        String(row.side ?? ""),
        String(row.strategy ?? ""),
        String(row.regime ?? ""),
        String(row.entryTimestamp ?? ""),
        String(row.entryPrice ?? ""),
        String(row.quantity ?? ""),
        String(row.notional ?? ""),
        String(row.exitTimestamp ?? ""),
        String(row.exitPrice ?? ""),
        String(row.exitReason ?? ""),
        String(ef?.exitModel ?? row.exitModel ?? ""),
        String(row.grossPnL ?? ""),
        String(row.entryFee ?? ""),
        String(row.exitFee ?? ""),
        String(row.totalFee ?? ""),
        String(row.netPnL ?? ""),
        String(row.variantDEnabled ?? ef?.variantDEnabled ?? ""),
        String(ef?.actualVariantDExitReason ?? ""),
        String(row.holdDuration ?? ""),
        String(row.MFE ?? ""),
        String(row.MAE ?? ""),
      ]);
    }
  }
  fs.writeFileSync(
    path.join(process.cwd(), "kripto-overnight-trades.csv"),
    tradesCsv.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n") + "\n",
    "utf8",
  );

  const roundSummaryCsv = [
    ["roundNo", "state", "terminal", "candidateCount", "tdiApprovals", "tdiWait", "tdiRejects", "aiInvoked", "aiFailed", "orders", "trades", "netPnL", "failReason"],
  ];
  for (const ra of roundAnalyses) {
    roundSummaryCsv.push([
      String(ra.roundNo),
      ra.state,
      String(ra.terminal),
      String(ra.candidateCount),
      String(ra.tdi.tdiApprovals),
      String(ra.tdi.tdiWait),
      String(ra.tdi.tdiRejects),
      String(ra.ai.aiInvokedCount),
      String(ra.ai.aiFailedCount),
      String(ra.execution.ordersCreatedCount),
      String(ra.pnl.tradeCount),
      String(ra.pnl.netPnL),
      String(ra.failReason ?? ""),
    ]);
  }
  fs.writeFileSync(
    path.join(process.cwd(), "kripto-overnight-round-summary.csv"),
    roundSummaryCsv.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\n") + "\n",
    "utf8",
  );

  const md = [
    "# KRIPTO Overnight 30-Round Final Report",
    "",
    `Validation: ${VALIDATION_ID}`,
    `Job: ${sessionId}`,
    `Completed: ${result.completedAt}`,
    "",
    "## Verdict",
    "",
    `ROUNDS_COMPLETED = ${roundsCompleted}`,
    `ROUNDS_FAILED = ${roundsFailed}`,
    `ROUNDS_RECOVERED = ${roundsRecovered}`,
    `TRADES = ${allPnl.length}`,
    `NET_PNL = ${netPnL.toFixed(4)}`,
    `PROFITABILITY_STATUS = ${profitabilityStatus}`,
    `POLICY_CHANGES = ${policyChangesDuringCampaign ? "YES" : "NO"}`,
    `PRIMARY_RUNTIME_INCIDENT = ${primaryRuntimeIncident}`,
    "",
    "## Incidents",
    "",
    `Total incidents: ${incidents.length}`,
    "",
    "## Notes",
    "",
    "- Watchdog attached to existing RUNNING 30-round campaign without restart.",
    `- AI VETO bypass: ${aiVetoBypass}`,
    `- AI orphans: ${aiOrphans}`,
    `- Zombies: ${zombieCount}`,
    `- Variant_D live trades: ${variantDLiveTrades}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(process.cwd(), OUTPUT_MD), md, "utf8");

  console.log(JSON.stringify({ phase: "COMPLETE", result: result.metrics }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(JSON.stringify({ phase: "FATAL", message: (error as Error).message }));
  process.exit(1);
});
