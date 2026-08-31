/**
 * 5-round stress paper validation (~20 min/round operational ceiling).
 * Post P0 scheduler recovery + clock-sync + forensic export fixes.
 * Does NOT modify strategy, thresholds, or safety gates.
 */
import fs from "node:fs";
import path from "node:path";
import { classifyRoundTerminalReason } from "@/src/server/forensics/round-terminal-classification.service";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

process.env.EXECUTION_AI_GATE_POLICY = process.env.EXECUTION_AI_GATE_POLICY ?? "VETO";

const VALIDATION_ID = `5round-stress-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const OUTPUT_JSON = "kripto-5round-stress-validation-final.json";
const OUTPUT_MD = "KRIPTO_5ROUND_STRESS_PAPER_VALIDATION_FINAL.md";
const STARTED_ORPHAN_MS = 180_000;
const TOTAL_ROUNDS = 5;
const MAX_WAIT_SEC = 600;
const POLL_MS = 10_000;
const ROUND_CEILING_MS = 20 * 60_000;
const JOB_DEADLINE_MS = TOTAL_ROUNDS * ROUND_CEILING_MS + 30 * 60_000;

const MINIMUM_ARTIFACTS = [
  "round-summary.json",
  "round-liveness.json",
  "selectionTimeBudgetBreakdown.json",
  "recovery-decisions.json",
  "recovery-telemetry.json",
];

const EXPECTED_ARTIFACTS = [
  ...MINIMUM_ARTIFACTS,
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

function checkMidRunCritical(input: {
  sessionId: string;
  roundNo: number;
  aiCandidates: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  aiGatePolicy: string;
}): CriticalFailure[] {
  const failures: CriticalFailure[] = [];
  const orphans = assessStartedOrphans(input.aiCandidates);
  if (orphans.length > 0) {
    failures.push({
      code: "AI_STARTED_ORPHAN",
      message: `${orphans.length} AI candidate(s) stuck STARTED > ${STARTED_ORPHAN_MS}ms`,
      roundId: String(input.roundNo),
      details: { orphans: orphans.map((o) => ({ candidateId: o.candidateId, symbol: o.symbol, startedAt: o.startedAt })) },
    });
  }
  if (input.aiGatePolicy === "VETO") {
    for (const order of input.orders) {
      const side = String(order.side ?? "").toUpperCase();
      if (side !== "BUY" && side !== "SELL") continue;
      const aiVerdict = String(order.aiVerdict ?? "").toUpperCase();
      const execVerdict = String(order.executionVerdict ?? "");
      if (BLOCKING_AI.has(aiVerdict) && execVerdict !== "AI_ADVISORY_ONLY") {
        failures.push({
          code: "CRITICAL_AI_EXECUTION_BYPASS",
          message: "Order created despite blocking AI verdict under VETO policy — validation stopped",
          roundId: String(input.roundNo),
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
  }
  return failures;
}

function classifyRoundOutcome(input: {
  state: string;
  failReason?: string | null;
  tradeCount: number;
  terminal: boolean;
}): string {
  const reason = String(input.failReason ?? "");
  if (!input.terminal) return "NON_TERMINAL";
  if (reason.includes("Recovery restart current stage")) return "RECOVERY_FAILURE";
  if (reason.includes("Clock synchronization failed")) return "SAFETY_BLOCK";
  if (input.tradeCount === 0 && input.terminal) return "LEGITIMATE_ZERO_TRADE";
  if (input.state === "tur_tamamlandi" || input.tradeCount > 0) return "COMPLETED_WITH_ACTIVITY";
  return "SYSTEM_FAILURE";
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
  const recoveryDecisions = readJson<{ records?: Array<Record<string, unknown>> }>(
    path.join(root, "recovery-decisions.json"),
  );
  const exportError = readJson<Record<string, unknown>>(path.join(root, "export-error.json"));
  const clockForensics = readJson<Record<string, unknown>>(path.join(root, "clock-sync-forensics.json"));
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
  const remoteCount = (aiTrace?.aiCalls ?? []).filter(
    (r) => r.remote === true || String(r.executionMode).toUpperCase() === "REMOTE",
  ).length;
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
  const exportErrorArtifact = String(exportError?.artifact ?? "");
  const hangSnapshotExportFailed = exportErrorArtifact === "round-hang-snapshot.json";
  const durationMs =
    roundMeta.startedAt && roundMeta.endedAt
      ? new Date(String(roundMeta.endedAt)).getTime() - new Date(String(roundMeta.startedAt)).getTime()
      : Number(summary?.durationMs ?? 0);

  const missingMinimumArtifacts = MINIMUM_ARTIFACTS.filter((f) => !fs.existsSync(path.join(root, f)));

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
    outcomeClass: classifyRoundOutcome({
      state: String(roundMeta.state),
      failReason: roundMeta.failReason as string | null,
      tradeCount: pnlEntries.length,
      terminal,
    }),
    durationMs,
    durationMin: Number((durationMs / 60_000).toFixed(2)),
    selectionBudgetMs: Number(summary?.selectionBudgetMs ?? 1_200_000),
    elapsedMs: Number(summary?.elapsedMs ?? durationMs),
    artifactRoot: root,
    artifactsExist: exists,
    missingArtifacts,
    missingMinimumArtifacts,
    hangSnapshotExists,
    hangSnapshotRequired,
    hangSnapshotExportFailed,
    terminalClass: terminalClassification.terminalClass,
    terminalClassRule: terminalClassification.matchedRule,
    exportStatus: String(summary?.exportStatus ?? (exportError ? "FAILED" : "UNKNOWN")),
    exportErrorExists: Boolean(exportError),
    exportKind: summary?.exportKind ?? null,
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
      recoveryCount: (recoveryDecisions?.records ?? recovery?.records ?? []).length,
      restartCurrentStageCount: (recoveryDecisions?.records ?? []).filter(
        (r) => r.recoveryDecision === "RESTART_CURRENT_STAGE" || r.action === "RESTART_CURRENT_STAGE",
      ).length,
      lastProgressAt: summary?.lastProgressAt ?? null,
      heartbeatAt: summary?.heartbeatAt ?? null,
      clockForensicsExists: Boolean(clockForensics),
      clockSkewMs: clockForensics?.clockSkewMs ?? null,
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

function aggregateClockStats(rounds: Array<Record<string, unknown>>) {
  const skews: number[] = [];
  const latencies: number[] = [];
  let safetyBlocks = 0;
  for (const r of rounds) {
    const root = String(r.artifactRoot ?? "");
    const clock = readJson<Record<string, unknown>>(path.join(root, "clock-sync-forensics.json"));
    if (!clock) continue;
    const skew = Number(clock.clockSkewMs);
    const latency = Number(clock.apiLatencyMs ?? clock.latencyMs);
    if (Number.isFinite(skew)) skews.push(skew);
    if (Number.isFinite(latency)) latencies.push(latency);
    if (clock.blocked === true || clock.verdict === "BLOCK") safetyBlocks += 1;
  }
  const stat = (values: number[]) => {
    if (values.length === 0) return { min: null, avg: null, max: null, count: 0 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { min, avg: Number(avg.toFixed(2)), max, count: values.length };
  };
  return { skew: stat(skews), latency: stat(latencies), safetyBlocks };
}

function aggregateExitStats(rounds: Array<Record<string, unknown>>) {
  const reasons: Record<string, number> = {};
  const models: Record<string, number> = {};
  for (const r of rounds) {
    const exit = (r.exit as Record<string, unknown>) ?? {};
    for (const [k, v] of Object.entries((exit.exitReasons as Record<string, number>) ?? {})) {
      reasons[k] = (reasons[k] ?? 0) + Number(v);
    }
    for (const [k, v] of Object.entries((exit.exitModels as Record<string, number>) ?? {})) {
      models[k] = (models[k] ?? 0) + Number(v);
    }
  }
  const hasRealExit = Object.keys(reasons).some((k) => k !== "END_OF_REPLAY" && k !== "UNKNOWN");
  return { reasons, models, exitEdgeNotProven: !hasRealExit };
}

function writeStressReport(result: Record<string, unknown>) {
  const rounds = (result.rounds as Array<Record<string, unknown>>) ?? [];
  const scheduler = (result.schedulerStress as Record<string, unknown>) ?? {};
  const preflight = (result.preflight as Record<string, unknown>) ?? {};
  const clockSync = (preflight.clockSync as Record<string, unknown>) ?? {};
  const profitability = (result.profitability as Record<string, unknown>) ?? {};
  const job = (result.job as Record<string, unknown>) ?? {};
  const critical = (result.criticalFailures as Array<Record<string, unknown>>) ?? [];
  const dbConsistency = result.dbConsistency as Record<string, unknown> | null;
  const failedRoundConsistency = result.failedRoundConsistency as Record<string, unknown> | null;
  const clockStats = aggregateClockStats(rounds);
  const exitStats = aggregateExitStats(rounds);
  const aiGate = (result.aiGateSummary as Record<string, unknown>) ?? {};
  const runtimeHealth = (result.runtimeHealth as Record<string, unknown>) ?? {};
  const p1p2 = (result.p1p2Summary as Record<string, unknown>) ?? {};

  const lines: string[] = [
    "# KRIPTO — 5 Round × 20 Minute Full Stress Paper Validation (FINAL)",
    "",
    `**Validation ID:** \`${result.validationId}\``,
    `**Session ID:** \`${result.sessionId ?? "N/A"}\``,
    `**Started:** ${result.startedAt ?? "N/A"}`,
    `**Completed:** ${result.completedAt}`,
    `**Production readiness:** **${result.productionReadiness}**`,
    "",
    "## 1. Preflight",
    "",
    `| Check | Status | Detail |`,
    `|-------|--------|--------|`,
    `| Overall | ${preflight.overallVerdict ?? "N/A"} | canStart=${preflight.canStart} |`,
    `| Database | ${(preflight.database as Record<string, unknown>)?.reasonCode ?? "N/A"} | ${(preflight.database as Record<string, unknown>)?.reasonDetail ?? ""} |`,
    `| Binance TR | ${(preflight.binance as Record<string, unknown>)?.reasonCode ?? "N/A"} | ${(preflight.binance as Record<string, unknown>)?.reasonDetail ?? ""} |`,
    `| Clock sync | ${clockSync.reasonCode ?? "N/A"} | skewMs=${clockSync.clockSkewMs ?? "N/A"} threshold=${clockSync.skewThresholdMs ?? 5000} |`,
    `| AI providers | ${(preflight.ai as Record<string, unknown>)?.reasonCode ?? "N/A"} | ${(preflight.ai as Record<string, unknown>)?.reasonDetail ?? ""} |`,
    `| Emergency stop | ${(preflight.emergencyStop as Record<string, unknown>)?.reasonCode ?? "N/A"} | |`,
    `| Artifact | \`${preflight.artifactPath ?? "N/A"}\` | |`,
    "",
    "## 2. Round-by-round",
    "",
    "| Round | Duration (min) | Outcome | Candidates | TDI appr/wait | Sizing +/- | Exec ready | AI (remote) | Risk +/- | Orders | Fills | Closed | Gross | Fees | Net | Recovery | Terminal | Fail reason |",
    "|-------|----------------|---------|------------|---------------|------------|------------|-------------|----------|--------|-------|--------|-------|------|-----|----------|----------|-------------|",
  ];
  for (const r of rounds) {
    const ai = r.ai as Record<string, unknown>;
    const exec = r.execution as Record<string, unknown>;
    const pnl = r.pnl as Record<string, unknown>;
    const tdi = r.tdi as Record<string, unknown>;
    const sizing = r.sizing as Record<string, unknown>;
    const risk = r.risk as Record<string, unknown>;
    const runtime = r.runtime as Record<string, unknown>;
    lines.push(
      `| ${r.roundNo} | ${r.durationMin} | ${r.outcomeClass} | ${r.candidateCount} | ${tdi?.tdiApprovals ?? 0}/${tdi?.tdiWait ?? 0} | ${sizing?.sizingPassedCount ?? 0}/${sizing?.sizingRejectedCount ?? 0} | ${exec?.executionReadyCount ?? 0} | ${ai?.aiInvokedCount ?? 0} (${ai?.remoteCount ?? 0}) | ${risk?.riskPassedCount ?? 0}/${risk?.riskRejectedCount ?? 0} | ${exec?.ordersCreatedCount ?? 0} | ${exec?.fillsCount ?? 0} | ${pnl?.tradeCount ?? 0} | ${pnl?.grossPnL ?? 0} | ${pnl?.totalFees ?? 0} | ${pnl?.netPnL ?? 0} | ${runtime?.restartCurrentStageCount ?? 0}/${runtime?.recoveryCount ?? 0} | ${r.state} | ${String(r.failReason ?? "").slice(0, 50)} |`,
    );
  }
  lines.push(
    "",
    `**Job status:** ${job.status ?? "N/A"} | completed=${job.completedRounds ?? 0} failed=${job.failedRounds ?? 0} | terminal rounds=${result.terminalRounds ?? 0}/${rounds.length}`,
    "",
    "## 3. Scheduler stress results",
    "",
    `- Progress samples: ${scheduler.progressSampleCount ?? 0}`,
    `- Recovery snapshots: ${scheduler.recoverySnapshotCount ?? 0}`,
    `- RESTART_CURRENT_STAGE total: **${scheduler.restartCurrentStageTotal ?? 0}**`,
    `- Premature restart on healthy progress: **${scheduler.prematureRestartDetected ? "YES — FAIL" : "NO"}**`,
    `- Progress state distribution: \`${JSON.stringify(scheduler.progressStateDistribution ?? {})}\``,
    "",
    "## 4. AI gate results",
    "",
    `- Policy: \`${process.env.EXECUTION_AI_GATE_POLICY ?? "VETO"}\``,
    `- NO_TRADE / HOLD / REJECT / WAIT → orders: **${aiGate.blockingVerdictOrderCount ?? 0}** (must be 0)`,
    `- VETO bypass count: **${aiGate.vetoBypassCount ?? 0}**`,
    `- AI gate contradictions: **${aiGate.contradictionCount ?? 0}**`,
    `- Remote AI calls (aggregate): **${aiGate.remoteCount ?? 0}**`,
    `- Degraded AI calls (aggregate): **${aiGate.degradedCount ?? 0}**`,
    "",
    "## 5. Clock / API results",
    "",
    `- Skew ms — min: ${clockStats.skew.min ?? "N/A"} | avg: ${clockStats.skew.avg ?? "N/A"} | max: ${clockStats.skew.max ?? "N/A"} (${clockStats.skew.count} samples)`,
    `- API latency ms — min: ${clockStats.latency.min ?? "N/A"} | avg: ${clockStats.latency.avg ?? "N/A"} | max: ${clockStats.latency.max ?? "N/A"} (${clockStats.latency.count} samples)`,
    `- Clock safety blocks observed: **${clockStats.safetyBlocks}**`,
    "",
    "## 6. Exit results",
    "",
    `- Exit reasons: \`${JSON.stringify(exitStats.reasons)}\``,
    `- Exit models: \`${JSON.stringify(exitStats.models)}\``,
    `- EXIT_EDGE_NOT_PROVEN: **${exitStats.exitEdgeNotProven ? "YES (no TP/SL/STRATEGY/TIME exits observed)" : "NO"}**`,
    "",
    "## 7. Fee results",
    "",
    `| Gross | Fees | Net | Reconciliation |`,
    `|-------|------|-----|----------------|`,
    `| ${profitability.grossPnL ?? 0} | ${profitability.fees ?? 0} | ${profitability.netPnL ?? 0} | ${critical.some((f) => f.code === "PNL_FEE_MISMATCH") ? "FAIL" : "PASS"} |`,
    "",
    "## 8. P1/P2 artifact results",
    "",
    `- Mean reversion entries: ${p1p2.meanReversionEntries ?? 0} | complete audit rows: ${p1p2.mrCompleteCount ?? 0}`,
    `- Scanner qualification rejections: ${p1p2.scannerQualificationRejections ?? 0}`,
    `- Entry timing records: ${p1p2.entryTimingRecords ?? 0}`,
    `- EV calibration rounds with data: ${p1p2.evCalibrationRounds ?? 0}`,
    `- TDI WAIT distribution: \`${JSON.stringify(p1p2.tdiWaitDistribution ?? {})}\``,
    `- Slot report rows: ${p1p2.slotReportRows ?? 0}`,
    `- Fee-aware policy evaluations: ${p1p2.feePolicyEvaluations ?? 0}`,
    "",
    "## 9. Runtime health",
    "",
    `- Zombie rounds at job end: **${result.zombieCount ?? 0}**`,
    `- Worker / recovery audits (job metadata): ${runtimeHealth.recoveryAuditCount ?? 0}`,
    `- Watchdog NO_ACTION (scheduler crash checks): ${runtimeHealth.noActionRecoveryCount ?? 0}`,
    `- Validation runner DB disconnect: ${runtimeHealth.runnerDbDisconnect ? "YES (postprocess used)" : "NO"}`,
    "",
    "## 10. Runtime ↔ artifact ↔ DB consistency",
    "",
    `- Trade consistency: **${dbConsistency?.status ?? "NO_TRADES"}** ${dbConsistency?.message ? `— ${dbConsistency.message}` : ""}`,
    `- Failed-round consistency: **${failedRoundConsistency?.status ?? "N/A"}**`,
  );
  if (failedRoundConsistency?.status === "AGREE" && failedRoundConsistency.roundNo) {
    lines.push(`  - Round ${failedRoundConsistency.roundNo}: failReason, terminalState, endedAt aligned`);
  } else if (failedRoundConsistency?.status === "MISMATCH") {
    lines.push(`  - Round ${failedRoundConsistency.roundNo}: ${JSON.stringify(failedRoundConsistency.delta ?? {})}`);
  }
  lines.push(
    "",
    "## 11. Failures / warnings",
    "",
  );
  if (critical.length === 0) lines.push("- None");
  else for (const f of critical) lines.push(`- **${f.code}**: ${f.message}${f.roundId ? ` (round ${f.roundId})` : ""}`);
  lines.push(
    "",
    "## 12. Production readiness",
    "",
    `**Verdict: ${result.productionReadiness}**`,
    "",
    "### Profitability (classification: NOT_PROVEN)",
    "",
    `| Trades | Wins | Losses | Gross | Fees | Net | Note |`,
    `|--------|------|--------|-------|------|-----|------|`,
    `| ${profitability.trades ?? 0} | ${profitability.wins ?? 0} | ${profitability.losses ?? 0} | ${profitability.grossPnL ?? 0} | ${profitability.fees ?? 0} | ${profitability.netPnL ?? 0} | Stress run — not strategy certification |`,
    "",
    "### Readiness criteria",
    "",
    `- Critical safety tests: ${critical.some((f) => ["AI_VETO_BYPASS", "PNL_FEE_MISMATCH", "PREMATURE_RECOVERY_RESTART"].includes(String(f.code))) ? "FAIL" : "PASS"}`,
    `- All rounds terminal: ${Number(result.terminalRounds) === 5 ? "YES" : `NO (${result.terminalRounds}/5)`}`,
    `- Forensic minimum exports: ${rounds.every((r) => (r.missingMinimumArtifacts as string[] | undefined)?.length === 0) ? "YES" : "PARTIAL"}`,
    `- Scheduler false restart: ${scheduler.prematureRestartDetected ? "DETECTED" : "NONE"}`,
    "",
  );
  fs.writeFileSync(path.join(process.cwd(), OUTPUT_MD), `${lines.join("\n")}\n`, "utf8");
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

async function compareDbFailedRound(
  prisma: typeof import("@/src/server/db/prisma").prisma,
  sessionId: string,
  roundAnalysis: ReturnType<typeof analyzeRound>,
) {
  const run = await prisma.autoRoundRun.findFirst({
    where: { jobId: sessionId, roundNo: roundAnalysis.roundNo },
  });
  if (!run) return { status: "NO_DB_ROUND", roundNo: roundAnalysis.roundNo };

  const summary = readJson<Record<string, unknown>>(path.join(roundAnalysis.artifactRoot, "round-summary.json"));
  if (!summary) return { status: "NO_ARTIFACT_SUMMARY", roundNo: roundAnalysis.roundNo };

  const dbFail = String(run.failReason ?? "");
  const artFail = String(summary.failReason ?? "");
  const dbState = String(run.state);
  const artState = String(summary.terminalState ?? summary.state ?? "");
  const dbEnded = run.endedAt ? new Date(run.endedAt).toISOString() : null;
  const artEnded = summary.endedAt ? new Date(String(summary.endedAt)).toISOString() : null;
  const recoveryCount = Number((roundAnalysis.runtime as Record<string, unknown>).recoveryCount ?? 0);

  const failMatch = dbFail === artFail || (dbFail && artFail && dbFail.includes(artFail.slice(0, 20)));
  const stateMatch = dbState === artState;
  const endedMatch = !dbEnded || !artEnded || Math.abs(new Date(dbEnded).getTime() - new Date(artEnded).getTime()) < 5000;

  return {
    status: failMatch && stateMatch && endedMatch ? "AGREE" : "MISMATCH",
    roundNo: roundAnalysis.roundNo,
    db: { failReason: dbFail, state: dbState, endedAt: dbEnded, recoveryCount: null },
    artifact: { failReason: artFail, terminalState: artState, endedAt: artEnded, recoveryCount },
    delta: { failReason: failMatch, state: stateMatch, endedAt: endedMatch },
  };
}

function buildSchedulerStressFromArtifacts(
  sessionId: string,
  roundAnalyses: ReturnType<typeof analyzeRound>[],
  recoverySnapshots: Array<Record<string, unknown>>,
) {
  const progressSamples: Array<Record<string, unknown>> = [];
  let prematureRestartDetected = false;
  for (const ra of roundAnalyses) {
    const recovery = readJson<{ records?: Array<Record<string, unknown>> }>(
      path.join(ra.artifactRoot, "recovery-telemetry.json"),
    );
    for (const row of recovery?.records ?? []) {
      progressSamples.push({ roundNo: ra.roundNo, source: "artifact-recovery-telemetry", ...row });
      if (
        row.recoveryDecision === "RESTART_CURRENT_STAGE" &&
        ["ACTIVE_PROGRESS", "HEARTBEAT_ONLY", "POSSIBLY_HUNG"].includes(String(row.progressState))
      ) {
        prematureRestartDetected = true;
      }
    }
    const summary = readJson<Record<string, unknown>>(path.join(ra.artifactRoot, "round-summary.json"));
    if (summary?.heartbeatAt || summary?.lastProgressAt) {
      progressSamples.push({
        roundNo: ra.roundNo,
        source: "round-summary",
        heartbeatAt: summary.heartbeatAt,
        lastProgressAt: summary.lastProgressAt,
        elapsedMs: summary.elapsedMs,
        selectionBudgetMs: summary.selectionBudgetMs,
      });
    }
  }
  const restartCurrentStageTotal = roundAnalyses.reduce(
    (sum, r) => sum + Number(r.runtime.restartCurrentStageCount ?? 0),
    0,
  );
  const progressStateDistribution = progressSamples.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.progressState ?? row.source ?? "UNKNOWN");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  return {
    progressSamples,
    recoverySnapshots,
    prematureRestartDetected,
    restartCurrentStageTotal,
    progressStateDistribution,
  };
}

function buildSummaries(roundAnalyses: ReturnType<typeof analyzeRound>[]) {
  const tdiWaitDistribution: Record<string, number> = {};
  let meanReversionEntries = 0;
  let mrCompleteCount = 0;
  let scannerQualificationRejections = 0;
  let entryTimingRecords = 0;
  let evCalibrationRounds = 0;
  let slotReportRows = 0;
  let feePolicyEvaluations = 0;
  let remoteCount = 0;
  let degradedCount = 0;
  let blockingVerdictOrderCount = 0;
  let vetoBypassCount = 0;
  let contradictionCount = 0;

  for (const ra of roundAnalyses) {
    for (const [k, v] of Object.entries(ra.tdi.waitReasonDistribution ?? {})) {
      tdiWaitDistribution[k] = (tdiWaitDistribution[k] ?? 0) + Number(v);
    }
    meanReversionEntries += ra.p1.meanReversionEntries;
    if (ra.p1.mrComplete) mrCompleteCount += 1;
    scannerQualificationRejections += ra.p1.scannerQualificationRejections;
    entryTimingRecords += ra.p1.entryTimingRecords;
    if (ra.p1.entryTimingRecords > 0) evCalibrationRounds += 1;
    slotReportRows += ra.p2.slotReportRows;
    feePolicyEvaluations += ra.p2.feePolicyEvaluations;
    remoteCount += ra.ai.remoteCount;
    degradedCount += ra.ai.degradedCount;
    vetoBypassCount += ra.p0.aiGateFailures.filter((f) => f.code === "AI_VETO_BYPASS").length;
    contradictionCount += ra.p0.aiGateFailures.filter((f) => f.code === "AI_GATE_CONTRADICTION").length;
    const orders = readJson<{ orders?: Array<Record<string, unknown>> }>(
      path.join(ra.artifactRoot, "execution-trace.json"),
    )?.orders ?? [];
    const decisions = readJson<{ decisions?: Array<Record<string, unknown>> }>(
      path.join(ra.artifactRoot, "decision-trace.json"),
    )?.decisions ?? [];
    for (const d of decisions) {
      const verdict = String(d.aiVerdict ?? d.reasonCode ?? "").toUpperCase();
      if (BLOCKING_AI.has(verdict) && orders.length > 0) blockingVerdictOrderCount += orders.length;
    }
  }
  return {
    aiGateSummary: { blockingVerdictOrderCount, vetoBypassCount, contradictionCount, remoteCount, degradedCount },
    p1p2Summary: {
      meanReversionEntries,
      mrCompleteCount,
      scannerQualificationRejections,
      entryTimingRecords,
      evCalibrationRounds,
      tdiWaitDistribution,
      slotReportRows,
      feePolicyEvaluations,
    },
  };
}

export async function finalizeStressSession(
  sessionId: string,
  context: {
    startedAt?: string;
    progressSamples?: Array<Record<string, unknown>>;
    recoverySnapshots?: Array<Record<string, unknown>>;
    prematureRestartDetected?: boolean;
    lastStatus?: unknown;
    runnerDbDisconnect?: boolean;
    validationId?: string;
    preRunCriticalFailures?: CriticalFailure[];
    stopValidationReason?: CriticalFailure | null;
  } = {},
) {
  const { getRecoveryTelemetryLog } = await import("@/src/server/forensics/recovery-telemetry.service");
  const { prisma } = await import("@/src/server/db/prisma");

  const criticalFailures: CriticalFailure[] = [...(context.preRunCriticalFailures ?? [])];
  const sessionRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId);
  const preflightFile = readJson<Record<string, unknown>>(path.join(sessionRoot, "preflight.json"));
  const startedAt =
    context.startedAt ??
    String(preflightFile?.generatedAt ?? preflightFile?.timestamp ?? new Date().toISOString());
  const validationId =
    context.validationId ??
    String(preflightFile?.attemptId ?? `5round-stress-finalize-${sessionId}`).replace(/-preflight$/, "");

  let progressSamples = context.progressSamples ?? [];
  let recoverySnapshots = context.recoverySnapshots ?? [];
  let prematureRestartDetected = context.prematureRestartDetected ?? false;

  for (const row of getRecoveryTelemetryLog(500).filter((t) => t.jobId === sessionId)) {
    const key = `${row.timestamp}:${row.recoveryDecision}:${row.reasonCode}:${row.roundId}`;
    if (!recoverySnapshots.some((s) => s.key === key)) {
      recoverySnapshots.push({ key, ...row });
      if (
        row.recoveryDecision === "RESTART_CURRENT_STAGE" &&
        ["ACTIVE_PROGRESS", "HEARTBEAT_ONLY", "POSSIBLY_HUNG"].includes(String(row.progressState))
      ) {
        prematureRestartDetected = true;
      }
    }
  }

  const finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  if (finalJob?.status === "RUNNING") {
    criticalFailures.push({
      code: "JOB_STILL_RUNNING",
      message: "Finalize invoked while job still RUNNING — incomplete stress session",
    });
  }

  const roundAnalyses = (finalJob?.rounds ?? []).map((r) =>
    analyzeRound(sessionId, r.roundNo, r as unknown as Record<string, unknown>),
  );

  if (progressSamples.length === 0) {
    const rebuilt = buildSchedulerStressFromArtifacts(sessionId, roundAnalyses, recoverySnapshots);
    progressSamples = rebuilt.progressSamples;
    prematureRestartDetected = prematureRestartDetected || rebuilt.prematureRestartDetected;
  }

  for (const ra of roundAnalyses) {
    criticalFailures.push(...ra.p0.criticalFailures);
    if (!ra.terminal) {
      criticalFailures.push({
        code: "ROUND_NOT_TERMINAL",
        message: `Round ${ra.roundNo} state=${ra.state}`,
        roundId: ra.roundId,
      });
    }
    if (!ra.artifactsExist || ra.missingMinimumArtifacts.length > 0) {
      criticalFailures.push({
        code: ra.exportErrorExists ? "FORENSIC_EXPORT_FAILED" : "ARTIFACTS_MISSING",
        message:
          ra.missingMinimumArtifacts.length > 0
            ? `Round ${ra.roundNo} missing minimum artifacts: ${ra.missingMinimumArtifacts.join(", ")}`
            : `Round ${ra.roundNo} forensic export missing`,
        roundId: ra.roundId,
      });
    }
    if (ra.hangSnapshotRequired && !ra.hangSnapshotExists) {
      criticalFailures.push({
        code: ra.hangSnapshotExportFailed ? "HANG_SNAPSHOT_EXPORT_FAILED" : "HANG_SNAPSHOT_MISSING",
        message: ra.hangSnapshotExportFailed
          ? `Round ${ra.roundNo} abnormal terminal but hang snapshot export failed`
          : `Round ${ra.roundNo} abnormal terminal but hang snapshot is missing`,
        roundId: ra.roundId,
      });
    }
  }

  if (prematureRestartDetected) {
    criticalFailures.push({
      code: "PREMATURE_RECOVERY_RESTART",
      message: "RESTART_CURRENT_STAGE during healthy progress detected",
    });
  }

  const restartCurrentStageTotal = roundAnalyses.reduce(
    (sum, r) => sum + Number(r.runtime.restartCurrentStageCount ?? 0),
    0,
  );

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
  const dbConsistency = tradeRound
    ? await compareDbTrade(prisma, sessionId, tradeRound)
    : { status: "NO_TRADES", message: "Zero trades across rounds — pipeline blocking stage analysis required" };

  const failedRound = roundAnalyses.find((r) => r.outcomeClass === "LEGITIMATE_ZERO_TRADE" || r.failReason);
  const failedRoundConsistency = failedRound ? await compareDbFailedRound(prisma, sessionId, failedRound) : null;
  if (failedRoundConsistency?.status === "MISMATCH") {
    criticalFailures.push({
      code: "DB_ARTIFACT_CONTRADICTION",
      message: `Failed round ${failedRoundConsistency.roundNo} DB vs artifact mismatch`,
      details: failedRoundConsistency as Record<string, unknown>,
    });
  }

  const allPnl = roundAnalyses.flatMap((r) => {
    const p = readJson<{ entries?: Array<Record<string, unknown>> }>(path.join(r.artifactRoot, "pnl-ledger.json"));
    return p?.entries ?? [];
  });
  const wins = allPnl.filter((r) => Number(r.netPnL) > 0).length;
  const losses = allPnl.filter((r) => Number(r.netPnL) < 0).length;
  const grossPnL = allPnl.reduce((a, r) => a + Number(r.grossPnL ?? 0), 0);
  const totalFees = allPnl.reduce((a, r) => a + Number(r.totalFee ?? 0), 0);
  const netPnL = allPnl.reduce((a, r) => a + Number(r.netPnL ?? 0), 0);

  const { aiGateSummary, p1p2Summary } = buildSummaries(roundAnalyses);

  if (aiGateSummary.degradedCount > 0 && aiGateSummary.remoteCount === 0 && roundAnalyses.some((r) => r.ai.aiInvokedCount > 0)) {
    criticalFailures.push({
      code: "AI_DEGRADED",
      message: "Degraded AI observed without remote calls — verify REAL_AI path",
    });
  }

  const recoveryAudit = ((finalJob?.metadata as Record<string, unknown> | null)?.recoveryAudit ?? []) as Array<
    Record<string, unknown>
  >;
  const runtimeHealth = {
    recoveryAuditCount: recoveryAudit.length,
    noActionRecoveryCount: recoveryAudit.filter((r) => r.action === "NO_ACTION").length,
    runnerDbDisconnect: context.runnerDbDisconnect ?? false,
  };

  const stopEarly = criticalFailures.some((f) =>
    [
      "AI_VETO_BYPASS",
      "AI_GATE_CONTRADICTION",
      "PNL_FEE_MISMATCH",
      "PREMATURE_RECOVERY_RESTART",
      "CRITICAL_AI_EXECUTION_BYPASS",
      "AI_STARTED_ORPHAN",
      "DB_ARTIFACT_CONTRADICTION",
    ].includes(f.code),
  );

  const terminalRounds = roundAnalyses.filter((r) => r.terminal).length;
  let productionReadiness: "NOT_READY" | "CONDITIONAL_READY" | "READY" = "NOT_READY";
  const jobStillRunning = finalJob?.status === "RUNNING";
  if (jobStillRunning || terminalRounds < TOTAL_ROUNDS) {
    productionReadiness = "NOT_READY";
  } else if (stopEarly || criticalFailures.some((f) => f.code.startsWith("AI_") && f.code !== "AI_DEGRADED")) {
    productionReadiness = "NOT_READY";
  } else if (
    terminalRounds === TOTAL_ROUNDS &&
    zombieCount === 0 &&
    !criticalFailures.some((f) =>
      ["PREMATURE_RECOVERY_RESTART", "ZOMBIE_ROUNDS", "PNL_FEE_MISMATCH", "DB_ARTIFACT_CONTRADICTION", "JOB_STILL_RUNNING"].includes(f.code),
    ) &&
    !prematureRestartDetected &&
    roundAnalyses.every((r) => r.missingMinimumArtifacts.length === 0)
  ) {
    productionReadiness = "READY";
  } else if (terminalRounds >= 3 && !stopEarly && !prematureRestartDetected) {
    productionReadiness = "CONDITIONAL_READY";
  }

  const progressStateDistribution = progressSamples.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.progressState ?? "UNKNOWN");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const result = {
    validationId,
    startedAt,
    completedAt: new Date().toISOString(),
    sessionId,
    config: {
      mode: "PAPER",
      exchange: process.env.BINANCE_PLATFORM ?? "tr",
      aiGatePolicy: process.env.EXECUTION_AI_GATE_POLICY ?? "VETO",
      maxWaitSec: MAX_WAIT_SEC,
      totalRounds: TOTAL_ROUNDS,
      roundCeilingMin: ROUND_CEILING_MS / 60_000,
      selectionBudgetMs: 1_200_000,
    },
    preflight: preflightFile
      ? {
          canStart: preflightFile.canStart,
          overallVerdict: preflightFile.overallVerdict,
          clockSync: preflightFile.clockSync,
          database: preflightFile.database,
          binance: preflightFile.binance,
          ai: preflightFile.ai,
          emergencyStop: preflightFile.emergencyStop,
          artifactPath: path.join(sessionRoot, "preflight.json"),
        }
      : { canStart: null, overallVerdict: "MISSING" },
    job: finalJob
      ? {
          id: finalJob.id,
          status: finalJob.status,
          completedRounds: finalJob.completedRounds,
          failedRounds: finalJob.failedRounds,
          lastError: finalJob.lastError,
          finishedAt: finalJob.finishedAt,
          createdAt: finalJob.createdAt,
        }
      : null,
    schedulerStress: {
      progressSampleCount: progressSamples.length,
      progressStateDistribution,
      recoverySnapshotCount: recoverySnapshots.length,
      restartCurrentStageTotal,
      prematureRestartDetected,
      recoverySnapshots: recoverySnapshots.slice(0, 50),
    },
    progressSamples: progressSamples.slice(-120),
    rounds: roundAnalyses,
    aiGateSummary,
    p1p2Summary,
    runtimeHealth,
    profitability: {
      classification: "NOT_PROVEN",
      trades: allPnl.length,
      wins,
      losses,
      grossPnL: Number(grossPnL.toFixed(4)),
      fees: Number(totalFees.toFixed(4)),
      netPnL: Number(netPnL.toFixed(4)),
      note: "5-round stress validation — not a profitability proof",
    },
    dbConsistency,
    failedRoundConsistency,
    criticalFailures,
    stopEarly,
    stopValidationReason: context.stopValidationReason ?? null,
    zombieCount,
    terminalRounds,
    productionReadiness,
    lastStatus: context.lastStatus ?? null,
  };

  writeJson(path.join(process.cwd(), OUTPUT_JSON), result);
  writeStressReport(result);
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  return { result, exitCode: stopEarly ? 10 : criticalFailures.length > 0 ? 11 : 0 };
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus, stopAutoRoundJob } = await import(
    "@/src/server/execution/auto-round-engine.service"
  );
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { getRecoveryTelemetryLog } = await import("@/src/server/forensics/recovery-telemetry.service");
  const { assessRoundProgressState } = await import("@/src/server/execution/round-progress-state.service");
  const { getAiBatchProgress } = await import("@/src/server/forensics/ai-runtime.service");
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
    writeJson(path.join(process.cwd(), OUTPUT_JSON), blocked);
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
    writeJson(path.join(process.cwd(), OUTPUT_JSON), fail);
    console.log(JSON.stringify(fail, null, 2));
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  const sessionRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId);
  writeJson(path.join(sessionRoot, "preflight.json"), preflight);

  const progressSamples: Array<Record<string, unknown>> = [];
  const recoverySnapshots: Array<Record<string, unknown>> = [];
  let prematureRestartDetected = false;
  let lastRecoveryKeys = new Set<string>();

  const deadline = Date.now() + JOB_DEADLINE_MS;
  let lastStatus: Awaited<ReturnType<typeof getAutoRoundStatus>> | null = null;
  let runnerDbDisconnect = false;
  let stopValidation = false;
  let stopValidationReason: CriticalFailure | null = null;
  while (Date.now() < deadline && !stopValidation) {
    try {
      lastStatus = await getAutoRoundStatus(user.id);
    } catch (pollError) {
      runnerDbDisconnect = true;
      console.error(
        JSON.stringify({
          validationId: VALIDATION_ID,
          warning: "POLL_DB_ERROR",
          message: (pollError as Error).message,
          sessionId,
        }),
      );
      await sleep(POLL_MS);
      continue;
    }
    const jobRow = await prisma.autoRoundJob.findUnique({
      where: { id: sessionId },
      include: { rounds: { orderBy: { roundNo: "asc" } } },
    });
    const activeRun = jobRow?.rounds.find((r) => !r.endedAt) ?? jobRow?.rounds[jobRow.rounds.length - 1];
    const runtime = activeRun ? readRuntime(activeRun.metadata) : null;
    const recoveryState = ((jobRow?.metadata as Record<string, unknown> | null)?.recoveryState ?? {}) as Record<
      string,
      unknown
    >;

    if (runtime && activeRun) {
      const assessment = assessRoundProgressState({
        runtime: runtime as never,
        selectionBudgetMs: Number(runtime.selectionBudgetMs ?? 0) || undefined,
        selectionStartedAt: runtime.elapsedMs != null ? Date.now() - Number(runtime.elapsedMs) : undefined,
      });
      progressSamples.push({
        at: new Date().toISOString(),
        roundNo: activeRun.roundNo,
        runState: activeRun.state,
        step: runtime.step,
        elapsedMs: runtime.elapsedMs,
        selectionBudgetMs: runtime.selectionBudgetMs,
        heartbeatAt: runtime.heartbeatAt,
        lastProgressAt: runtime.lastProgressAt,
        aiProcessed: runtime.aiProcessed,
        aiTotal: runtime.aiTotal,
        progressState: assessment.progressState,
        reasonCode: assessment.reasonCode,
        recoveryCount: recoveryState.recoveryCount,
      });
      if (
        assessment.progressState === "RESTART_CURRENT_STAGE" ||
        (activeRun.failReason === "Recovery restart current stage" &&
          ["ACTIVE_PROGRESS", "HEARTBEAT_ONLY", "POSSIBLY_HUNG"].includes(assessment.progressState))
      ) {
        prematureRestartDetected = true;
      }

      const roundId = String(activeRun.roundNo);
      const aiProgressFile = readJson<{ candidates?: Array<Record<string, unknown>> }>(
        path.join(roundDir(sessionId, roundId), "ai-progress.json"),
      );
      const memBatch = getAiBatchProgress(roundId, activeRun.id);
      const aiCandidates = aiProgressFile?.candidates ?? memBatch?.candidates ?? [];
      const execTrace = readJson<{ orders?: Array<Record<string, unknown>> }>(
        path.join(roundDir(sessionId, roundId), "execution-trace.json"),
      );
      const midRunCritical = checkMidRunCritical({
        sessionId,
        roundNo: activeRun.roundNo,
        aiCandidates,
        orders: execTrace?.orders ?? [],
        aiGatePolicy: process.env.EXECUTION_AI_GATE_POLICY ?? "VETO",
      });
      if (midRunCritical.length > 0) {
        criticalFailures.push(...midRunCritical);
        stopValidationReason = midRunCritical[0] ?? null;
        stopValidation = true;
        console.error(JSON.stringify({ validationId: VALIDATION_ID, stopValidation: true, critical: midRunCritical }, null, 2));
        try {
          await stopAutoRoundJob(user.id);
        } catch {
          /* best effort */
        }
        break;
      }
    }

    for (const row of getRecoveryTelemetryLog(300).filter((t) => t.jobId === sessionId)) {
      const key = `${row.timestamp}:${row.recoveryDecision}:${row.reasonCode}:${row.roundId}`;
      if (!lastRecoveryKeys.has(key)) {
        lastRecoveryKeys.add(key);
        recoverySnapshots.push({ key, ...row });
        if (
          row.recoveryDecision === "RESTART_CURRENT_STAGE" &&
          ["ACTIVE_PROGRESS", "HEARTBEAT_ONLY", "POSSIBLY_HUNG"].includes(String(row.progressState))
        ) {
          prematureRestartDetected = true;
        }
      }
    }

    if (jobRow && jobRow.status !== "RUNNING") break;
    await sleep(POLL_MS);
  }

  const { exitCode } = await finalizeStressSession(sessionId, {
    startedAt,
    progressSamples,
    recoverySnapshots,
    prematureRestartDetected,
    lastStatus,
    runnerDbDisconnect,
    validationId: VALIDATION_ID,
    preRunCriticalFailures: criticalFailures,
    stopValidationReason,
  });
  process.exit(exitCode);
}

const scriptPath = process.argv[1]?.replace(/\\/g, "/") ?? "";
const runningDirectly = scriptPath.endsWith("run-5round-stress-validation.ts");

if (runningDirectly && process.argv[2] === "--finalize") {
  const sessionId = process.argv[3];
  if (!sessionId) {
    console.error("Usage: npx tsx scripts/run-5round-stress-validation.ts --finalize <sessionId>");
    process.exit(1);
  }
  finalizeStressSession(sessionId, { runnerDbDisconnect: true }).then(({ exitCode }) => process.exit(exitCode));
} else if (runningDirectly) {
  main().catch(async (e) => {
    console.error(
      JSON.stringify(
        { validationId: VALIDATION_ID, ok: false, error: (e as Error).message, stack: (e as Error).stack },
        null,
        2,
      ),
    );
    process.exit(1);
  });
}
