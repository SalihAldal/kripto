/**
 * Controlled 10-round paper validation (P0/P1/P2 runtime proof).
 * Does NOT modify strategy, thresholds, or safety gates.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { classifyRoundTerminalReason } from "@/src/server/forensics/round-terminal-classification.service";
import { buildMicroBottleneckForensic } from "@/src/server/forensics/micro-bottleneck-forensic.service";
import type { CandidateLifecycleState } from "@/src/server/candidate/candidate-store.service";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}
process.env.CANONICAL_RUNTIME_ENFORCE_NO_LEGACY_PERSIST = "true";
process.env.SCANNER_WORKER_USE_LEGACY_PIPELINE = "false";

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

const TOTAL_ROUNDS = Number(cli.rounds ?? 10);
const VALIDATION_KIND = String(cli.kind ?? `${TOTAL_ROUNDS}round`);
const VALIDATION_ID = `${VALIDATION_KIND}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const RESULT_FILE = String(cli.out ?? `kripto-${TOTAL_ROUNDS}round-paper-validation.json`);
const MAX_WAIT_SEC = Number(cli.maxWaitSec ?? 600);
const POLL_MS = 15_000;
const MAX_ROUND_MINUTES = Number(cli.maxRoundMinutes ?? 30);
const ENGINE_TERMINALIZATION_GRACE_MS = 180_000;
const JOB_DEADLINE_MS = TOTAL_ROUNDS * MAX_ROUND_MINUTES * 60_000 + ENGINE_TERMINALIZATION_GRACE_MS;
const HANDOFF_DIAGNOSTIC_MS = 15 * 60_000;
const HANDOFF_TICK_MS = 5_000;

const EXPECTED_ARTIFACTS = [
  "round-summary.json",
  "round-liveness.json",
  "selectionTimeBudgetBreakdown.json",
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

async function waitForJobTerminalization(input: {
  prisma: typeof import("@/src/server/db/prisma").prisma;
  sessionId: string;
  timeoutMs: number;
}) {
  const deadline = Date.now() + Math.max(1_000, input.timeoutMs);
  while (Date.now() < deadline) {
    const row = await input.prisma.autoRoundJob.findUnique({
      where: { id: input.sessionId },
      select: { status: true },
    });
    if (row && row.status !== "RUNNING") break;
    await sleep(Math.min(POLL_MS, 5_000));
  }
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

type CandidateTransitionEvent = {
  at: number;
  candidateId: string;
  symbol: string;
  lane: string;
  state: CandidateLifecycleState;
  reasons: string[];
};

function countStates(events: CandidateTransitionEvent[]) {
  const byState: Record<string, number> = {};
  const byLane: Record<string, Record<string, number>> = {};
  for (const row of events) {
    byState[row.state] = (byState[row.state] ?? 0) + 1;
    const lane = row.lane || "UNKNOWN";
    byLane[lane] = byLane[lane] ?? {};
    byLane[lane][row.state] = (byLane[lane][row.state] ?? 0) + 1;
  }
  return { byState, byLane };
}

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
      (row.verdict === "REJECT" ||
        row.verdict === "REJECTED" ||
        row.reasonCode === "NO_TRADE" ||
        String(row.executionVerdict) === "AI_GATE_BLOCK"),
  );

  for (const order of input.orders) {
    const side = String(order.side ?? "").toUpperCase();
    if (side !== "BUY" && side !== "SELL") continue;
    const aiVerdict = String(order.aiVerdict ?? "").toUpperCase();
    const execVerdict = String(order.executionVerdict ?? "");
    if (BLOCKING_AI.has(aiVerdict)) {
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
  const hangSnapshotExists = fs.existsSync(path.join(root, "round-hang-snapshot.json"));

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
  const remoteCount = (aiTrace?.aiCalls ?? []).filter((r) => r.remote === true || r.executionMode === "REMOTE").length;
  const degradedCount = (aiTrace?.aiCalls ?? []).filter((r) => r.degraded === true).length;

  const riskPassed = riskRows.filter((r) => r.verdict === "PASS" || r.verdict === "APPROVED").length;
  const riskRejected = riskRows.filter((r) => r.verdict === "REJECT" || r.verdict === "REJECTED" || r.verdict === "FAILED").length;
  const sizingPassed = riskRows.filter((r) => r.stage === "sizing" && (r.verdict === "PASS" || r.verdict === "APPROVED")).length;
  const sizingRejected = riskRows.filter(
    (r) => r.stage === "sizing" && (r.verdict === "REJECT" || r.verdict === "REJECTED" || r.verdict === "FAILED"),
  ).length;

  const tdiApprovals = tdiRecords.filter((r) => r.verdict === "APPROVED").length;
  const tdiWaitCount = tdiRecords.filter((r) => r.verdict === "WAIT").length;
  const tdiRejects = tdiRecords.filter((r) => r.verdict === "REJECT" || r.verdict === "REJECTED").length;

  const terminal = TERMINAL_ROUND_STATES.includes(String(roundMeta.state));
  const terminalClassification = classifyRoundTerminalReason({
    reason: String(roundMeta.failReason ?? summary?.failReason ?? ""),
    reasonCode: String((watchdog?.reasonCode as string | undefined) ?? ""),
    currentStage: String(roundMeta.state ?? summary?.currentStage ?? ""),
  });
  const hangSnapshotRequired = terminalClassification.terminalClass === "ABNORMAL_RUNTIME_TERMINAL";
  const durationMs =
    roundMeta.startedAt && roundMeta.endedAt
      ? new Date(String(roundMeta.endedAt)).getTime() - new Date(String(roundMeta.startedAt)).getTime()
      : Number(summary?.durationMs ?? 0);

  return {
    roundNo,
    roundId: rid,
    dbRunId: roundMeta.id,
    state: roundMeta.state,
    startedAt: roundMeta.startedAt,
    endedAt: roundMeta.endedAt,
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
    hangSnapshotExists,
    hangSnapshotRequired,
    terminalClass: terminalClassification.terminalClass,
    terminalClassRule: terminalClassification.matchedRule,
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
    exit: {
      exitReasons,
      exitModels,
      exitEdgeNotProven:
        pnlEntries.length > 0 &&
        Object.keys(exitReasons).every((k) => k === "TIME_EXIT" || k === "END_OF_REPLAY"),
    },
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
  const { getLegacyScannerTelemetry, resetLegacyScannerTelemetry } = await import(
    "@/src/server/scanner/legacy-scanner-telemetry.service"
  );
  const { getCanonicalCandidateStore } = await import("@/src/server/candidate/candidate-store.service");
  const { getCanonicalInstanceOwnership } = await import("@/src/server/candidate/instance-ownership.service");
  const { getShadowOutcomeEngine } = await import("@/src/server/shadow-outcome/shadow-outcome-engine");
  const { ensureMarketDataDaemonStarted } = await import("@/src/server/market-data/spine/daemon-worker");
  const { getMarketDataDaemon } = await import("@/src/server/market-data/spine/market-data-daemon");
  const { getOpportunityEngine } = await import("@/src/server/opportunity/opportunity-engine");
  const { getMicrostructureEngine } = await import("@/src/server/microstructure/microstructure-engine");
  const { observeCanonicalShadowTick } = await import("@/src/server/shadow-outcome/shadow-outcome-engine");
  const { persistShadowOutcomes } = await import("@/src/server/shadow-outcome/persist");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();
  resetLegacyScannerTelemetry();

  const criticalFailures: CriticalFailure[] = [];
  const startedAt = new Date().toISOString();
  const configSnapshot = {
    EXECUTION_MODE: process.env.EXECUTION_MODE ?? null,
    LIVE_TRADING_ENABLED: process.env.LIVE_TRADING_ENABLED ?? null,
    LIVE_TRADING_ACK: process.env.LIVE_TRADING_ACK ?? null,
    OPPORTUNITY_HOT_THRESHOLD: process.env.OPPORTUNITY_HOT_THRESHOLD ?? null,
    OPPORTUNITY_WATCH_THRESHOLD: process.env.OPPORTUNITY_WATCH_THRESHOLD ?? null,
    MICRO_WARMUP_MS: process.env.MICRO_WARMUP_MS ?? null,
    MICRO_WARMUP_TRADES: process.env.MICRO_WARMUP_TRADES ?? null,
    MICRO_DEEP_LIMIT: process.env.MICRO_DEEP_LIMIT ?? null,
    EXECUTION_AI_GATE_POLICY: process.env.EXECUTION_AI_GATE_POLICY ?? null,
    MAX_WAIT_SEC,
    TOTAL_ROUNDS,
    MAX_ROUND_MINUTES,
  };
  const configHash = createHash("sha256").update(JSON.stringify(configSnapshot)).digest("hex");

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
    writeJson(path.join(process.cwd(), RESULT_FILE), blocked);
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    process.exit(2);
  }

  ensureMarketDataDaemonStarted();
  const daemonAtStart = getMarketDataDaemon().telemetry();
  const diagnosticStartedAt = Date.now();
  const diagnosticCounters = {
    opportunityEvaluations: 0,
    discovered: 0,
    hot: 0,
    microAnalyzed: 0,
    microConfirmed: 0,
    deepActiveMax: 0,
  };
  while (Date.now() - diagnosticStartedAt < HANDOFF_DIAGNOSTIC_MS) {
    const daemon = getMarketDataDaemon();
    const opportunity = getOpportunityEngine().scan();
    const micro = getMicrostructureEngine().evaluate(opportunity.ranked);
    observeCanonicalShadowTick({
      opportunity: opportunity.ranked,
      micro: micro.ranked,
      snapshots: daemon.getMarketSnapshot(),
    });
    await persistShadowOutcomes().catch(() => null);
    diagnosticCounters.opportunityEvaluations += Number(opportunity.evaluated ?? 0);
    diagnosticCounters.discovered += Number(opportunity.ranked.length ?? 0);
    diagnosticCounters.hot += opportunity.ranked.filter((row) => row.state === "HOT" || row.state === "PROMOTED").length;
    diagnosticCounters.microAnalyzed += Number(micro.hotCount ?? 0);
    diagnosticCounters.microConfirmed += Number(micro.confirmedCount ?? 0);
    diagnosticCounters.deepActiveMax = Math.max(
      diagnosticCounters.deepActiveMax,
      Number(daemon.telemetry().deepSubscriptions ?? 0),
    );
    await sleep(HANDOFF_TICK_MS);
  }
  const preRoundStore = getCanonicalCandidateStore().getTelemetry();
  const preRoundShadow = getShadowOutcomeEngine().getTelemetry();
  const preRoundMovers = getShadowOutcomeEngine().getMoverEvents().length;
  const diagnosticPass = {
    opportunityEvaluations: diagnosticCounters.opportunityEvaluations > 0,
    discovered: diagnosticCounters.discovered > 0 || Number(preRoundStore.byState.DISCOVERED ?? 0) > 0,
    hot: diagnosticCounters.hot > 0 || Number(preRoundStore.byState.HOT ?? 0) > 0,
    microInput: diagnosticCounters.microAnalyzed > 0,
    legacyInvocationZero: getLegacyScannerTelemetry().invocationTotal === 0,
    legacyPersistZero: getLegacyScannerTelemetry().persistenceTotal === 0,
    shadowTracked: Number(preRoundShadow.tracked ?? 0) > 0,
    moverActive: Number(preRoundShadow.symbols ?? 0) > 0 && Number(preRoundShadow.lastTickAt ?? 0) > 0,
  };
  if (!Object.values(diagnosticPass).every(Boolean)) {
    const blocked = {
      validationId: VALIDATION_ID,
      phase: "HANDOFF_DIAGNOSTIC_BLOCKED",
      preflight,
      diagnostic: {
        pass: diagnosticPass,
        counters: diagnosticCounters,
        candidateStore: preRoundStore,
        shadow: preRoundShadow,
        moverEvents: preRoundMovers,
      },
      productionReadiness: "NOT_READY",
    };
    writeJson(path.join(process.cwd(), RESULT_FILE), blocked);
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    process.exit(4);
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
    writeJson(path.join(process.cwd(), RESULT_FILE), fail);
    console.log(JSON.stringify(fail, null, 2));
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  const sessionRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId);
  writeJson(path.join(sessionRoot, "preflight.json"), preflight);

  const deadline = Date.now() + JOB_DEADLINE_MS;
  let lastStatus: Awaited<ReturnType<typeof getAutoRoundStatus>> | null = null;
  let statusReadFailures = 0;
  while (Date.now() < deadline) {
    try {
      lastStatus = await getAutoRoundStatus(user.id);
      statusReadFailures = 0;
      const jobRow = await prisma.autoRoundJob.findUnique({ where: { id: sessionId } });
      if (jobRow && jobRow.status !== "RUNNING") break;
    } catch (error) {
      statusReadFailures += 1;
      if (statusReadFailures >= 8) throw error;
      await sleep(5_000);
      continue;
    }
    await sleep(POLL_MS);
  }

  let finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  let engineGraceObservedMs = 0;
  if (finalJob?.status === "RUNNING") {
    const graceStartedAt = Date.now();
    await stopAutoRoundJob(user.id).catch(() => null);
    await waitForJobTerminalization({
      prisma,
      sessionId,
      timeoutMs: ENGINE_TERMINALIZATION_GRACE_MS,
    });
    engineGraceObservedMs = Date.now() - graceStartedAt;
    finalJob = await prisma.autoRoundJob.findUnique({
      where: { id: sessionId },
      include: { rounds: { orderBy: { roundNo: "asc" } } },
    });
  }

  if (finalJob?.status === "RUNNING") {
    criticalFailures.push({
      code: "JOB_TIMEOUT",
      message: `Job still RUNNING after ${JOB_DEADLINE_MS / 60_000} minutes`,
    });
  }

  const roundAnalyses = (finalJob?.rounds ?? []).map((r) =>
    analyzeRound(sessionId, r.roundNo, r as unknown as Record<string, unknown>),
  );
  const storeTelemetry = getCanonicalCandidateStore().getTelemetry();
  const transitionEvents = (storeTelemetry.recentTransitions ?? []) as CandidateTransitionEvent[];

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
    if (ra.hangSnapshotRequired && !ra.hangSnapshotExists) {
      criticalFailures.push({
        code: "HANG_SNAPSHOT_MISSING",
        message: `Round ${ra.roundNo} abnormal terminal but hang snapshot is missing`,
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
  const dbConsistency = tradeRound ? await compareDbTrade(prisma, sessionId, tradeRound) : { status: "NO_TRADES", message: "Zero trades across 10 rounds — pipeline blocking stage analysis required" };

  const allPnl = roundAnalyses.flatMap((r) => {
    const p = readJson<{ entries?: Array<Record<string, unknown>> }>(path.join(r.artifactRoot, "pnl-ledger.json"));
    return p?.entries ?? [];
  });
  const wins = allPnl.filter((r) => Number(r.netPnL) > 0).length;
  const losses = allPnl.filter((r) => Number(r.netPnL) < 0).length;
  const grossPnL = allPnl.reduce((a, r) => a + Number(r.grossPnL ?? 0), 0);
  const totalFees = allPnl.reduce((a, r) => a + Number(r.totalFee ?? 0), 0);
  const netPnL = allPnl.reduce((a, r) => a + Number(r.netPnL ?? 0), 0);
  const microForensic = await buildMicroBottleneckForensic({
    startedAt: new Date(startedAt),
    completedAt: new Date(),
    moverTarget: Number((getShadowOutcomeEngine().getMoverEvents() ?? []).length || 6),
  });

  const stopEarly = criticalFailures.some((f) =>
    ["AI_VETO_BYPASS", "AI_GATE_CONTRADICTION", "PNL_FEE_MISMATCH"].includes(f.code),
  );

  const terminalRounds = roundAnalyses.filter((r) => r.terminal).length;
  const daemonAtEnd = getMarketDataDaemon().telemetry();
  const ws1008Count = Number(daemonAtEnd.recentSocketCloses?.filter?.((x: { code?: number }) => Number(x?.code) === 1008)?.length ?? 0);
  const legacyScanner = getLegacyScannerTelemetry();
  if (legacyScanner.invocationTotal > 0) {
    criticalFailures.push({
      code: "LEGACY_SCANNER_INVOCATION_NONZERO",
      message: `legacyScannerInvocationCount=${legacyScanner.invocationTotal}`,
      details: { recent: legacyScanner.recentInvocations },
    });
  }
  if (legacyScanner.persistenceTotal > 0) {
    criticalFailures.push({
      code: "LEGACY_SCANNER_PERSIST_NONZERO",
      message: `legacyScannerPersistCount=${legacyScanner.persistenceTotal}`,
      details: { recent: legacyScanner.recentPersistence },
    });
  }
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
      maxRoundMinutes: MAX_ROUND_MINUTES,
      terminalizationGraceMs: ENGINE_TERMINALIZATION_GRACE_MS,
      configHash,
      snapshot: configSnapshot,
    },
    preflight: {
      canStart: preflight.canStart,
      overallVerdict: preflight.overallVerdict,
      checks: preflight.checks,
      artifactPath: path.join(sessionRoot, "preflight.json"),
    },
    handoffDiagnostic: {
      durationSec: Math.round((Date.now() - diagnosticStartedAt) / 1000),
      counters: diagnosticCounters,
      pass: diagnosticPass,
      candidateStore: preRoundStore,
      shadow: preRoundShadow,
      moverEvents: preRoundMovers,
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
    canonical: {
      legacyScannerInvocationCount: legacyScanner.invocationTotal,
      legacyScannerPersistCount: legacyScanner.persistenceTotal,
      instanceOwnership: getCanonicalInstanceOwnership(),
      candidateStore: {
        instanceId: storeTelemetry.instanceId,
        created: storeTelemetry.created,
        transitions: storeTelemetry.transitions,
        active: storeTelemetry.active,
        executionReady: storeTelemetry.executionReady,
        byState: storeTelemetry.byState,
      },
    },
    rounds: roundAnalyses.map((ra) => {
      const started = Date.parse(String((ra as { startedAt?: string }).startedAt ?? ""));
      const ended = Date.parse(String((ra as { endedAt?: string }).endedAt ?? ""));
      const inWindow = transitionEvents.filter((e) => {
        if (!Number.isFinite(started) || !Number.isFinite(ended)) return true;
        return e.at >= started && e.at <= ended;
      });
      const counts = countStates(inWindow);
      return {
        ...ra,
        funnel: counts.byState,
        lanes: counts.byLane,
      };
    }),
    totalFunnel: countStates(transitionEvents),
    shadow: {
      tracked: getShadowOutcomeEngine().getTracked().length,
      movers: getShadowOutcomeEngine().getMoverEvents().length,
    },
    marketRuntime: {
      start: daemonAtStart,
      end: daemonAtEnd,
      ws1008Count,
      priceDriftRejectCount: roundAnalyses.filter((r) => String(r.failReason ?? "").includes("Price drift exceeds tolerance")).length,
      flashCandleRejectCount: roundAnalyses.filter((r) => String(r.failReason ?? "").includes("Flash candle price jump")).length,
    },
    microForensic,
    profitability: {
      classification: "NOT_PROVEN",
      trades: allPnl.length,
      wins,
      losses,
      grossPnL: Number(grossPnL.toFixed(4)),
      fees: Number(totalFees.toFixed(4)),
      netPnL: Number(netPnL.toFixed(4)),
      note: "10-round validation sample only — not a profitability proof",
    },
    dbConsistency,
    criticalFailures,
    stopEarly,
    zombieCount,
    terminalRounds,
    productionReadiness,
    engineGraceObservedMs,
    lastStatus,
  };

  writeJson(path.join(process.cwd(), RESULT_FILE), result);
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  process.exit(stopEarly ? 10 : criticalFailures.length > 0 ? 11 : 0);
}

main().catch(async (e) => {
  console.error(JSON.stringify({ validationId: VALIDATION_ID, ok: false, error: (e as Error).message, stack: (e as Error).stack }, null, 2));
  process.exit(1);
});
