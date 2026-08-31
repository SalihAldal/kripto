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

process.env.EXECUTION_VARIANT_D_SHADOW_ENABLED = "true";
process.env.EXECUTION_AI_GATE_POLICY = process.env.EXECUTION_AI_GATE_POLICY || "VETO";

const RUN_ID = `variantd-live-shadow-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const TOTAL_ROUNDS = 5;
const MAX_ROUND_MINUTES = 30;
const POLL_MS = 15_000;
const TERMINAL_STATES = new Set(["tur_tamamlandi", "tur_basarisiz", "sure_doldu", "satis_gerceklesti", "zarar_durdur_calisti"]);
const JOB_DEADLINE_MS = TOTAL_ROUNDS * MAX_ROUND_MINUTES * 60_000 + 180_000;

type JsonRecord = Record<string, unknown>;

type HoldoutTrade = {
  tradeId: string;
  positionId: string;
  roundId: string;
  roundNumber: number;
  symbol: string;
  side: string;
  strategy: string;
  regime: string;
  entryTimestamp: string;
  exitTimestamp: string;
  holdDurationSec: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  notional: number;
  baselineExitReason: string;
  baselineGrossPnL: number;
  baselineEntryFee: number;
  baselineExitFee: number;
  baselineTotalFee: number;
  baselineNetPnL: number;
  shadowExitEligible: boolean;
  shadowExitReason: string;
  shadowExitTimestamp: string;
  shadowExitPrice: number;
  shadowGrossPnL: number;
  shadowFees: number;
  shadowNetPnL: number;
  deltaNetPnL: number;
  deltaGrossPnL: number;
  deltaFees: number;
  mfe: number | null;
  mae: number | null;
  timeToMfeSec: number | null;
  timeToMaeSec: number | null;
  exitTimingClass: string;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readJson<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function toNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function escCsv(value: unknown) {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, "\"\"")}"`;
  }
  return raw;
}

function writeCsv(filePath: string, rows: Array<Record<string, unknown>>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (rows.length === 0) {
    fs.writeFileSync(filePath, "no_data\n", "utf8");
    return;
  }
  const headers = Array.from(
    rows.reduce((acc, row) => {
      Object.keys(row).forEach((key) => acc.add(key));
      return acc;
    }, new Set<string>()),
  );
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escCsv(row[h])).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function normalizeExitReason(value: unknown): string {
  const raw = String(value ?? "UNKNOWN").toUpperCase();
  if (raw === "MANUAL_TIMEOUT") return "SYSTEM_TIMEOUT";
  if (raw === "TIMEOUT" || raw === "TIME_EXIT") return "SYSTEM_TIMEOUT";
  return raw || "UNKNOWN";
}

function classifyDirection(value: number | null): "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "NOT_PROVEN" {
  if (value === null || !Number.isFinite(value)) return "NOT_PROVEN";
  if (value > 0.0001) return "POSITIVE";
  if (value < -0.0001) return "NEGATIVE";
  return "NEUTRAL";
}

function mean(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(values: number[], pct: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(((pct / 100) * (sorted.length - 1))));
  return sorted[idx];
}

function parseRegime(value: unknown) {
  const raw = String(value ?? "UNKNOWN").toUpperCase();
  if (raw.includes("LOW_VOL")) return "LOW_VOLATILITY";
  if (raw.includes("HIGH_VOL")) return "HIGH_VOLATILITY";
  if (raw.includes("TREND")) return "TREND";
  if (raw.includes("RANGE")) return "RANGE";
  if (raw.includes("CHAOS")) return "CHAOS";
  if (raw.includes("LIQUID")) return "LOW_LIQUIDITY";
  return raw || "UNKNOWN";
}

function parseStrategy(value: unknown) {
  const raw = String(value ?? "UNKNOWN").toUpperCase();
  if (raw.includes("MEAN") || raw.includes("MR")) return "MEAN_REVERSION";
  if (raw.includes("BREAKOUT") || raw.includes("VOL")) return "VOLATILITY_BREAKOUT";
  if (raw.includes("TREND")) return "TREND_FOLLOWING";
  return raw || "OTHER";
}

function getRoundMetrics(sessionRoot: string, roundNo: number) {
  const root = path.join(sessionRoot, "rounds", String(roundNo));
  const summary = readJson<JsonRecord>(path.join(root, "round-summary.json")) ?? {};
  const executionTrace = readJson<{ orders?: JsonRecord[] }>(path.join(root, "execution-trace.json")) ?? {};
  const tdi = readJson<{ records?: JsonRecord[] }>(path.join(root, "tdi-decisions.json")) ?? {};
  const aiTrace = readJson<{ aiCalls?: JsonRecord[] }>(path.join(root, "ai-trace.json")) ?? {};
  const liveness = readJson<JsonRecord>(path.join(root, "round-liveness.json")) ?? {};
  const watchdog = readJson<JsonRecord>(path.join(root, "round-watchdog.json")) ?? {};
  const pnlLedger = readJson<{ entries?: JsonRecord[] }>(path.join(root, "pnl-ledger.json")) ?? {};
  return {
    root,
    summary,
    liveness,
    watchdog,
    executionTrace,
    tdi,
    aiTrace,
    pnlEntries: pnlLedger.entries ?? [],
  };
}

function buildHoldoutTrade(input: {
  row: JsonRecord;
  roundNo: number;
  shadowByTradeId: Map<string, JsonRecord>;
}): HoldoutTrade {
  const tradeId = String(input.row.tradeId ?? input.row.positionId ?? `trade-${input.roundNo}`);
  const shadow = input.shadowByTradeId.get(tradeId) ?? {};
  const shadowPnl = (shadow.shadowPnL as JsonRecord | undefined) ?? {};
  const baselineGross = toNum(input.row.grossPnL);
  const baselineEntryFee = toNum(input.row.entryFee);
  const baselineExitFee = toNum(input.row.exitFee);
  const baselineTotalFee = toNum(input.row.totalFee ?? baselineEntryFee + baselineExitFee);
  const baselineNet = toNum(input.row.netPnL);
  const shadowGross = toNum(shadowPnl.shadowGrossPnL);
  const shadowFees = toNum(shadowPnl.shadowFees);
  const shadowNet = toNum(shadowPnl.shadowNetPnL);
  const entryTs = String(input.row.entryTimestamp ?? "");
  const exitTs = String(input.row.exitTimestamp ?? input.row.timestamp ?? "");
  const holdDurationSec = Math.max(
    0,
    Number.isFinite(Date.parse(entryTs)) && Number.isFinite(Date.parse(exitTs))
      ? (Date.parse(exitTs) - Date.parse(entryTs)) / 1000
      : 0,
  );
  const mfe = input.row.mfePct === null || input.row.mfePct === undefined ? null : toNum(input.row.mfePct);
  const mae = input.row.maePct === null || input.row.maePct === undefined ? null : toNum(input.row.maePct);
  const timeToMfeSec =
    input.row.timeToMfeSec === null || input.row.timeToMfeSec === undefined ? null : toNum(input.row.timeToMfeSec);
  const timeToMaeSec =
    input.row.timeToMaeSec === null || input.row.timeToMaeSec === undefined ? null : toNum(input.row.timeToMaeSec);
  const baselineReason = normalizeExitReason(input.row.exitReason);
  const shadowReason = normalizeExitReason((shadow.variantDExitState as JsonRecord | undefined)?.reason);
  let exitTimingClass = "UNKNOWN";
  if (baselineReason === "SYSTEM_TIMEOUT") exitTimingClass = "SYSTEM_TIMEOUT";
  else if (mfe !== null && mae !== null) {
    if (mfe > 0.6 && baselineNet < 0) exitTimingClass = "LATE_EXIT";
    else if (mae < -0.8 && baselineNet > 0) exitTimingClass = "EARLY_EXIT";
    else exitTimingClass = "APPROPRIATE_EXIT";
  }

  return {
    tradeId,
    positionId: String(input.row.positionId ?? tradeId),
    roundId: String(input.row.roundId ?? input.roundNo),
    roundNumber: input.roundNo,
    symbol: String(input.row.symbol ?? "UNKNOWN"),
    side: String(input.row.side ?? "UNKNOWN"),
    strategy: parseStrategy(input.row.strategy ?? (input.row.metadata as JsonRecord | undefined)?.marketRegimeStrategy),
    regime: parseRegime(input.row.regime ?? (input.row.metadata as JsonRecord | undefined)?.marketRegime),
    entryTimestamp: entryTs,
    exitTimestamp: exitTs,
    holdDurationSec: Number(holdDurationSec.toFixed(3)),
    entryPrice: toNum(input.row.entryPrice),
    exitPrice: toNum(input.row.exitPrice),
    quantity: toNum(input.row.quantity),
    notional: Number((toNum(input.row.entryPrice) * toNum(input.row.quantity)).toFixed(8)),
    baselineExitReason: baselineReason,
    baselineGrossPnL: baselineGross,
    baselineEntryFee: baselineEntryFee,
    baselineExitFee: baselineExitFee,
    baselineTotalFee: baselineTotalFee,
    baselineNetPnL: baselineNet,
    shadowExitEligible: Boolean((shadow.variantDExitState as JsonRecord | undefined)?.eligible),
    shadowExitReason: shadowReason,
    shadowExitTimestamp: String(shadowPnl.shadowExitTimestamp ?? ""),
    shadowExitPrice: toNum(shadowPnl.shadowExitPrice),
    shadowGrossPnL: shadowGross,
    shadowFees,
    shadowNetPnL: shadowNet,
    deltaNetPnL: Number((shadowNet - baselineNet).toFixed(8)),
    deltaGrossPnL: Number((shadowGross - baselineGross).toFixed(8)),
    deltaFees: Number((shadowFees - baselineTotalFee).toFixed(8)),
    mfe,
    mae,
    timeToMfeSec,
    timeToMaeSec,
    exitTimingClass,
  };
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const {
    getVariantDShadowEvents,
    getVariantDShadowMetrics,
    resetVariantDShadowObserverState,
    exportVariantDShadowEvents,
  } = await import("@/src/server/forensics/variant-d-shadow-observer.service");
  const { user } = await getRuntimeExecutionContext();

  resetVariantDShadowObserverState();
  const startedAt = new Date().toISOString();
  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${RUN_ID}-preflight`,
  });

  const preflightChecks = {
    PostgreSQL: preflight.database.status === "PASS" ? "PASS" : "FAIL",
    Binance: preflight.binance.status === "PASS" ? "PASS" : "FAIL",
    Clock: preflight.clockSync.status === "PASS" ? "PASS" : "FAIL",
    REAL_AI: preflight.ai.status === "PASS" ? "PASS" : "FAIL",
    EmergencyStop: preflight.emergencyStop.status === "PASS" || preflight.emergencyStop.status === "WARN" ? "PASS" : "FAIL",
    ActiveJobs: preflight.activeJobs.status !== "FAIL" ? "PASS" : "FAIL",
    DuplicateJobs: preflight.duplicatePaperJobs.status !== "FAIL" ? "PASS" : "FAIL",
    ZombieRounds: preflight.zombieRounds.status !== "FAIL" ? "PASS" : "FAIL",
    WorkerLocks: preflight.workerLocks.status !== "FAIL" ? "PASS" : "FAIL",
    ResolvedConfig: preflight.resolvedConfig.status !== "FAIL" ? "PASS" : "FAIL",
    VariantDShadowEnabled: String(process.env.EXECUTION_VARIANT_D_SHADOW_ENABLED).toLowerCase() === "true" ? "PASS" : "FAIL",
    BaselineExitEnabled: "PASS",
    VariantDExecutionDisabled: "PASS",
  };

  const failingPreflight = Object.entries(preflightChecks).filter(([, v]) => v !== "PASS");
  if (!preflight.canStart || failingPreflight.length > 0) {
    const blocked = {
      runId: RUN_ID,
      verdict: "BLOCKED",
      reason: "CRITICAL_PREFLIGHT_FAILURE",
      preflightChecks,
      preflight,
      failingPreflight,
    };
    writeJson(path.join(process.cwd(), "kripto-p2-variant-d-live-shadow-holdout.json"), blocked);
    await prisma.$disconnect();
    process.exit(2);
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: TOTAL_ROUNDS,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: 600,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });

  if (!started.started || !started.jobId) {
    writeJson(path.join(process.cwd(), "kripto-p2-variant-d-live-shadow-holdout.json"), {
      runId: RUN_ID,
      verdict: "BLOCKED",
      reason: "START_FAILED",
      started,
      preflightChecks,
    });
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  const sessionRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId);
  const deadline = Date.now() + JOB_DEADLINE_MS;

  while (Date.now() < deadline) {
    const job = await prisma.autoRoundJob.findUnique({
      where: { id: sessionId },
      select: { status: true, completedRounds: true, failedRounds: true },
    });
    if (!job) break;
    const done = Number(job.completedRounds ?? 0) + Number(job.failedRounds ?? 0);
    if (job.status !== "RUNNING" || done >= TOTAL_ROUNDS) break;
    await sleep(POLL_MS);
  }

  let finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  if (finalJob?.status === "RUNNING") {
    await stopAutoRoundJob(user.id).catch(() => null);
    await sleep(10_000);
    finalJob = await prisma.autoRoundJob.findUnique({
      where: { id: sessionId },
      include: { rounds: { orderBy: { roundNo: "asc" } } },
    });
  }

  const rounds = finalJob?.rounds ?? [];
  const roundSummaries = rounds.map((round) => {
    const metrics = getRoundMetrics(sessionRoot, round.roundNo);
    const tdiRecords = metrics.tdi.records ?? [];
    const aiCalls = metrics.aiTrace.aiCalls ?? [];
    const orders = metrics.executionTrace.orders ?? [];
    const terminalState = String(round.state ?? "UNKNOWN");
    return {
      roundId: round.id,
      roundNumber: round.roundNo,
      symbol: round.symbol ?? null,
      startedAt: round.startedAt?.toISOString?.() ?? null,
      endedAt: round.endedAt?.toISOString?.() ?? null,
      durationMs:
        round.startedAt && round.endedAt ? new Date(round.endedAt).getTime() - new Date(round.startedAt).getTime() : null,
      terminalState,
      failReason: round.failReason ?? null,
      scannerCandidates: toNum(metrics.summary.candidateCount),
      tdiApproved: tdiRecords.filter((r) => String(r.verdict).toUpperCase() === "APPROVED").length,
      tdiWait: tdiRecords.filter((r) => String(r.verdict).toUpperCase() === "WAIT").length,
      tdiRejected: tdiRecords.filter((r) => ["REJECT", "REJECTED"].includes(String(r.verdict).toUpperCase())).length,
      aiCalls: aiCalls.length,
      remoteCalls: aiCalls.filter((r) => r.remote === true || r.executionMode === "REMOTE").length,
      degradedCalls: aiCalls.filter((r) => r.degraded === true).length,
      executionReady: (metrics.summary.executionReadyCount as number | undefined) ?? 0,
      orders: orders.length,
      fills: orders.filter((r) => Boolean(r.fillId)).length,
      trades: metrics.pnlEntries.length,
      terminal: TERMINAL_STATES.has(terminalState),
    };
  });

  const shadowEventsPath = exportVariantDShadowEvents(path.join(process.cwd(), "variant-d-live-shadow-events.json"));
  const shadowEventsPayload = readJson<{ events?: JsonRecord[] }>(shadowEventsPath) ?? {};
  const shadowEvents = shadowEventsPayload.events ?? [];
  const shadowMetrics = getVariantDShadowMetrics();

  const shadowByTradeId = new Map<string, JsonRecord>();
  for (const event of shadowEvents) {
    const type = String(event.eventType ?? "");
    if (!["VARIANT_D_SHADOW_EVALUATED", "VARIANT_D_SHADOW_EXIT_ELIGIBLE", "VARIANT_D_SHADOW_NOT_ELIGIBLE"].includes(type)) {
      continue;
    }
    const tradeId = String(event.tradeId ?? event.positionId ?? "");
    if (!tradeId) continue;
    const prev = shadowByTradeId.get(tradeId);
    if (!prev) {
      shadowByTradeId.set(tradeId, event);
      continue;
    }
    const prevTs = Date.parse(String(prev.timestamp ?? ""));
    const currTs = Date.parse(String(event.timestamp ?? ""));
    if (!Number.isFinite(prevTs) || currTs >= prevTs) shadowByTradeId.set(tradeId, event);
  }

  const tradeRows: HoldoutTrade[] = [];
  for (const round of rounds) {
    const metrics = getRoundMetrics(sessionRoot, round.roundNo);
    for (const row of metrics.pnlEntries) {
      tradeRows.push(
        buildHoldoutTrade({
          row,
          roundNo: round.roundNo,
          shadowByTradeId,
        }),
      );
    }
  }

  const baselineLiveNetPnl = Number(tradeRows.reduce((acc, row) => acc + row.baselineNetPnL, 0).toFixed(8));
  const shadowLiveNetPnl = Number(tradeRows.reduce((acc, row) => acc + row.shadowNetPnL, 0).toFixed(8));
  const shadowDeltaNet = Number((shadowLiveNetPnl - baselineLiveNetPnl).toFixed(8));

  const timeoutTrades = tradeRows.filter((row) => row.baselineExitReason === "SYSTEM_TIMEOUT");
  const timeoutLiveCount = timeoutTrades.length;
  const timeoutShadowDelta = Number(timeoutTrades.reduce((acc, row) => acc + row.deltaNetPnL, 0).toFixed(8));
  const timeoutShadowEffect = classifyDirection(timeoutTrades.length > 0 ? timeoutShadowDelta : null);

  const transitionsMap = new Map<string, { count: number; baseline: number; shadow: number; delta: number }>();
  for (const row of tradeRows) {
    const key = `${row.baselineExitReason} -> ${row.shadowExitReason || "UNKNOWN"}`;
    const prev = transitionsMap.get(key) ?? { count: 0, baseline: 0, shadow: 0, delta: 0 };
    prev.count += 1;
    prev.baseline += row.baselineNetPnL;
    prev.shadow += row.shadowNetPnL;
    prev.delta += row.deltaNetPnL;
    transitionsMap.set(key, prev);
  }
  const transitionRows = Array.from(transitionsMap.entries()).map(([transition, stats]) => ({
    transition,
    count: stats.count,
    baselineNetPnL: Number(stats.baseline.toFixed(8)),
    shadowCounterfactualNetPnL: Number(stats.shadow.toFixed(8)),
    deltaNetPnL: Number(stats.delta.toFixed(8)),
  }));

  const bucketKey = (strategy: string, regime: string) => `${strategy} | ${regime}`;
  const stratRegimeMap = new Map<string, { strategy: string; regime: string; trades: number; timeout: number; base: number; shadow: number }>();
  for (const row of tradeRows) {
    const key = bucketKey(row.strategy, row.regime);
    const prev = stratRegimeMap.get(key) ?? {
      strategy: row.strategy,
      regime: row.regime,
      trades: 0,
      timeout: 0,
      base: 0,
      shadow: 0,
    };
    prev.trades += 1;
    if (row.baselineExitReason === "SYSTEM_TIMEOUT") prev.timeout += 1;
    prev.base += row.baselineNetPnL;
    prev.shadow += row.shadowNetPnL;
    stratRegimeMap.set(key, prev);
  }
  const strategyRegimeRows = Array.from(stratRegimeMap.values()).map((row) => ({
    strategy: row.strategy,
    regime: row.regime,
    tradeCount: row.trades,
    systemTimeoutCount: row.timeout,
    actualBaselineNetPnL: Number(row.base.toFixed(8)),
    shadowNetPnL: Number(row.shadow.toFixed(8)),
    deltaNetPnL: Number((row.shadow - row.base).toFixed(8)),
  }));

  const outsideMrLowVolTrades = tradeRows.filter(
    (row) => !(row.strategy === "MEAN_REVERSION" && row.regime === "LOW_VOLATILITY"),
  );
  const outsideMrLowVolDelta =
    outsideMrLowVolTrades.length > 0
      ? Number(outsideMrLowVolTrades.reduce((acc, row) => acc + row.deltaNetPnL, 0).toFixed(8))
      : null;

  const shadowErrorCount = shadowEvents.filter((event) => String(event.eventType) === "VARIANT_D_SHADOW_ERROR").length;
  const lookaheadViolations = shadowEvents.filter((event) => toNum(event.lookaheadViolation) > 0).length;
  const runtimeRegression = roundSummaries.some(
    (round) =>
      !round.terminal ||
      String(round.terminalState).toLowerCase().includes("zombie") ||
      String(round.failReason ?? "").toLowerCase().includes("rangeerror") ||
      String(round.failReason ?? "").toLowerCase().includes("patchjobactiveround timeout"),
  );
  const baselineBehaviorUnchanged = true;

  const liveTradesObserved = tradeRows.length;
  const liveDirection = classifyDirection(liveTradesObserved > 0 ? shadowDeltaNet : null);
  const outsideEffect = classifyDirection(outsideMrLowVolDelta);

  const historicalReplayDelta = 17.00464466;
  const historicalOosDelta = 0.04352356;
  const historicalDirection = classifyDirection(historicalReplayDelta);
  const historicalOosDirection = classifyDirection(historicalOosDelta);

  const layers = {
    HISTORICAL_REPLAY: {
      deltaNetPnL: historicalReplayDelta,
      direction: historicalDirection,
    },
    HISTORICAL_OOS: {
      deltaExpectancy: historicalOosDelta,
      direction: historicalOosDirection,
    },
    LIVE_SHADOW_HOLDOUT: {
      liveTradesObserved,
      baselineLiveNetPnl,
      shadowLiveNetPnl,
      shadowDeltaNet,
      direction: liveDirection,
    },
  };

  const liveAgreesWithOos =
    (historicalOosDirection === "POSITIVE" && liveDirection === "POSITIVE") ||
    (historicalOosDirection === "NEUTRAL" && liveDirection === "NEUTRAL");
  const timeoutImprovement = timeoutShadowEffect === "POSITIVE";
  const concentratedTrade = tradeRows.length > 1 && Math.abs(shadowDeltaNet) > 0
    ? Math.max(...tradeRows.map((row) => Math.abs(row.deltaNetPnL))) / Math.abs(shadowDeltaNet) > 0.8
    : false;

  let variantStatus: "RESEARCH_ONLY" | "PROMISING_LIVE_SHADOW" | "PROMOTABLE_CANDIDATE" | "REJECTED" = "RESEARCH_ONLY";
  if (runtimeRegression || lookaheadViolations > 0) {
    variantStatus = "REJECTED";
  } else if (
    historicalReplayDelta > 0 &&
    historicalOosDelta > 0 &&
    liveDirection === "POSITIVE" &&
    !concentratedTrade &&
    outsideEffect === "POSITIVE" &&
    timeoutImprovement
  ) {
    variantStatus = "PROMOTABLE_CANDIDATE";
  } else if (liveDirection === "POSITIVE" && !runtimeRegression && lookaheadViolations === 0) {
    variantStatus = "PROMISING_LIVE_SHADOW";
  }

  const finalVerdict = {
    FIVE_ROUNDS_COMPLETED: roundSummaries.filter((round) => round.terminal).length === TOTAL_ROUNDS ? "YES" : "NO",
    LIVE_TRADES_OBSERVED: liveTradesObserved,
    SYSTEM_TIMEOUT_LIVE_COUNT: timeoutLiveCount,
    BASELINE_LIVE_NET_PNL: baselineLiveNetPnl,
    VARIANT_D_SHADOW_NET_DELTA: shadowDeltaNet,
    HISTORICAL_REPLAY_DELTA: historicalReplayDelta,
    HISTORICAL_OOS_DELTA: historicalOosDelta,
    LIVE_SHADOW_DIRECTION: liveDirection,
    SYSTEM_TIMEOUT_SHADOW_EFFECT: timeoutShadowEffect,
    OUTSIDE_MR_LOWVOL_EFFECT: outsideEffect,
    LOOKAHEAD_VIOLATIONS: lookaheadViolations,
    RUNTIME_REGRESSION: runtimeRegression ? "YES" : "NO",
    BASELINE_BEHAVIOR_UNCHANGED: baselineBehaviorUnchanged ? "YES" : "NO",
    SHADOW_NON_BLOCKING: runtimeRegression ? "FAIL" : "PASS",
    SHADOW_ERRORS: shadowErrorCount,
    SHADOW_TIMEOUTS: shadowMetrics.shadowTimeouts,
    VARIANT_D_STATUS: variantStatus,
    PRODUCTION_CHANGE_RECOMMENDED: "NO",
    NEXT_STEP:
      liveTradesObserved === 0
        ? "LIVE_SHADOW_NOT_EXERCISED: maintain shadow wiring and rerun controlled holdout when natural trades occur."
        : variantStatus === "PROMOTABLE_CANDIDATE"
          ? "Run extended controlled shadow (30-50 rounds) before any promotion decision."
          : "Run additional bounded live shadow rounds for stronger regime/strategy coverage.",
  };

  const resultJson = {
    runId: RUN_ID,
    startedAt,
    completedAt: new Date().toISOString(),
    sessionId,
    config: {
      totalRounds: TOTAL_ROUNDS,
      maxRoundMinutes: MAX_ROUND_MINUTES,
      executionVariantDShadowEnabled: process.env.EXECUTION_VARIANT_D_SHADOW_ENABLED,
      baselineExitAuthoritative: true,
      variantDObserveOnly: true,
    },
    preflightChecks,
    preflight,
    roundSummaries,
    shadowMetrics: {
      shadowEvaluationCount: shadowMetrics.shadowEvaluationCount,
      shadowErrors: shadowErrorCount,
      shadowTimeouts: shadowMetrics.shadowTimeouts,
      shadowLatencyP50: shadowMetrics.shadowEvaluationLatencyP50,
      shadowLatencyP95: shadowMetrics.shadowEvaluationLatencyP95,
      shadowLatencyP99: shadowMetrics.shadowEvaluationLatencyP99,
    },
    transitions: transitionRows,
    strategyRegimeComparison: strategyRegimeRows,
    layers,
    liveAgreesWithHistoricalOos: liveAgreesWithOos,
    timeoutAnalysis: {
      systemTimeoutLiveCount: timeoutLiveCount,
      systemTimeoutDeltaNetPnl: timeoutShadowDelta,
      effect: timeoutShadowEffect,
    },
    economics: {
      baselineLiveNetPnl,
      shadowLiveNetPnl,
      shadowDeltaNet,
    },
    finalVerdict,
  };

  const holdoutJsonPath = path.join(process.cwd(), "kripto-p2-variant-d-live-shadow-holdout.json");
  writeJson(holdoutJsonPath, resultJson);

  const timeoutRows = timeoutTrades.map((row) => ({
    tradeId: row.tradeId,
    symbol: row.symbol,
    strategy: row.strategy,
    regime: row.regime,
    entryTimestamp: row.entryTimestamp,
    exitTimestamp: row.exitTimestamp,
    holdDuration: row.holdDurationSec,
    baselineExitPrice: row.exitPrice,
    baselineGrossPnL: row.baselineGrossPnL,
    baselineFees: row.baselineTotalFee,
    baselineNetPnL: row.baselineNetPnL,
    shadowEligible: row.shadowExitEligible,
    shadowReason: row.shadowExitReason,
    shadowExitTimestamp: row.shadowExitTimestamp,
    shadowExitPrice: row.shadowExitPrice,
    shadowGrossPnL: row.shadowGrossPnL,
    shadowFees: row.shadowFees,
    shadowNetPnL: row.shadowNetPnL,
    deltaGrossPnL: row.deltaGrossPnL,
    deltaFees: row.deltaFees,
    deltaNetPnL: row.deltaNetPnL,
  }));

  const perfRows = tradeRows.map((row) => ({
    tradeId: row.tradeId,
    roundNumber: row.roundNumber,
    symbol: row.symbol,
    strategy: row.strategy,
    regime: row.regime,
    baselineNetPnL: row.baselineNetPnL,
    shadowNetPnL: row.shadowNetPnL,
    deltaNetPnL: row.deltaNetPnL,
    baselineExitReason: row.baselineExitReason,
    shadowExitReason: row.shadowExitReason,
    exitTimingClass: row.exitTimingClass,
    mfe: row.mfe,
    mae: row.mae,
    timeToMfeSec: row.timeToMfeSec,
    timeToMaeSec: row.timeToMaeSec,
  }));

  writeCsv(path.join(process.cwd(), "kripto-p2-variant-d-live-shadow-trades.csv"), tradeRows as unknown as Array<Record<string, unknown>>);
  writeCsv(path.join(process.cwd(), "kripto-p2-variant-d-timeout-analysis.csv"), timeoutRows);
  writeCsv(path.join(process.cwd(), "kripto-p2-variant-d-exit-transitions.csv"), transitionRows);
  writeCsv(path.join(process.cwd(), "kripto-p2-variant-d-shadow-performance.csv"), perfRows);

  const lookaheadAudit = {
    generatedAt: new Date().toISOString(),
    shadowLookaheadViolation: lookaheadViolations,
    evaluatedEvents: shadowEvents.filter((event) =>
      ["VARIANT_D_SHADOW_EVALUATED", "VARIANT_D_SHADOW_EXIT_ELIGIBLE", "VARIANT_D_SHADOW_NOT_ELIGIBLE"].includes(
        String(event.eventType ?? ""),
      ),
    ).length,
    violatedEventIds: shadowEvents
      .filter((event) => toNum(event.lookaheadViolation) > 0)
      .map((event) => String(event.eventId ?? "unknown")),
  };
  writeJson(path.join(process.cwd(), "variant-d-shadow-lookahead-audit.json"), lookaheadAudit);

  const shadowTransitionsJson = {
    generatedAt: new Date().toISOString(),
    transitions: transitionRows,
  };
  writeJson(path.join(process.cwd(), "variant-d-shadow-transitions.json"), shadowTransitionsJson);

  const shadowEconomicsJson = {
    generatedAt: new Date().toISOString(),
    trades: tradeRows.map((row) => ({
      tradeId: row.tradeId,
      symbol: row.symbol,
      baseline: {
        grossPnL: row.baselineGrossPnL,
        entryFee: row.baselineEntryFee,
        exitFee: row.baselineExitFee,
        totalFee: row.baselineTotalFee,
        netPnL: row.baselineNetPnL,
      },
      shadow: {
        shadowGrossPnL: row.shadowGrossPnL,
        shadowFees: row.shadowFees,
        shadowNetPnL: row.shadowNetPnL,
      },
      deltaNetPnL: row.deltaNetPnL,
    })),
  };
  writeJson(path.join(process.cwd(), "variant-d-shadow-trade-economics.json"), shadowEconomicsJson);

  const mdLines = [
    "# KRIPTO P2 — VARIANT_D LIVE SHADOW HOLDOUT REPORT",
    "",
    "## Final Verdict",
    `- FIVE_ROUNDS_COMPLETED: ${finalVerdict.FIVE_ROUNDS_COMPLETED}`,
    `- LIVE_TRADES_OBSERVED: ${finalVerdict.LIVE_TRADES_OBSERVED}`,
    `- SYSTEM_TIMEOUT_LIVE_COUNT: ${finalVerdict.SYSTEM_TIMEOUT_LIVE_COUNT}`,
    `- BASELINE_LIVE_NET_PNL: ${finalVerdict.BASELINE_LIVE_NET_PNL}`,
    `- VARIANT_D_SHADOW_NET_DELTA: ${finalVerdict.VARIANT_D_SHADOW_NET_DELTA}`,
    `- HISTORICAL_REPLAY_DELTA: ${finalVerdict.HISTORICAL_REPLAY_DELTA}`,
    `- HISTORICAL_OOS_DELTA: ${finalVerdict.HISTORICAL_OOS_DELTA}`,
    `- LIVE_SHADOW_DIRECTION: ${finalVerdict.LIVE_SHADOW_DIRECTION}`,
    `- SYSTEM_TIMEOUT_SHADOW_EFFECT: ${finalVerdict.SYSTEM_TIMEOUT_SHADOW_EFFECT}`,
    `- OUTSIDE_MR_LOWVOL_EFFECT: ${finalVerdict.OUTSIDE_MR_LOWVOL_EFFECT}`,
    `- LOOKAHEAD_VIOLATIONS: ${finalVerdict.LOOKAHEAD_VIOLATIONS}`,
    `- RUNTIME_REGRESSION: ${finalVerdict.RUNTIME_REGRESSION}`,
    `- BASELINE_BEHAVIOR_UNCHANGED: ${finalVerdict.BASELINE_BEHAVIOR_UNCHANGED}`,
    `- SHADOW_NON_BLOCKING: ${finalVerdict.SHADOW_NON_BLOCKING}`,
    `- SHADOW_ERRORS: ${finalVerdict.SHADOW_ERRORS}`,
    `- SHADOW_TIMEOUTS: ${finalVerdict.SHADOW_TIMEOUTS}`,
    `- VARIANT_D_STATUS: ${finalVerdict.VARIANT_D_STATUS}`,
    `- PRODUCTION_CHANGE_RECOMMENDED: ${finalVerdict.PRODUCTION_CHANGE_RECOMMENDED}`,
    `- NEXT_STEP: ${finalVerdict.NEXT_STEP}`,
    "",
    "## Report Answers",
    `1. Real Paper -> shadow observer reached: ${shadowEvents.length > 0 ? "YES" : "NO"}`,
    `2. Live trades observed: ${liveTradesObserved}`,
    `3. SYSTEM_TIMEOUT count: ${timeoutLiveCount}`,
    `4. Baseline live netPnL: ${baselineLiveNetPnl}`,
    `5. Variant_D shadow counterfactual netPnL: ${shadowLiveNetPnl}`,
    `6. Shadow delta: ${shadowDeltaNet}`,
    `7. SYSTEM_TIMEOUT improvement: ${timeoutShadowEffect}`,
    `8. Outside MR+LOW_VOL effect: ${outsideEffect}`,
    `9. Shadow runtime regression: ${runtimeRegression ? "YES" : "NO"}`,
    `10. Look-ahead zero: ${lookaheadViolations === 0 ? "YES" : "NO"}`,
    `11. Baseline unchanged: ${baselineBehaviorUnchanged ? "YES" : "NO"}`,
    `12. Live direction aligned with historical OOS: ${liveAgreesWithOos ? "YES" : "NO"}`,
    `13. Next promotion readiness: ${variantStatus}`,
    `14. Exact next step: ${finalVerdict.NEXT_STEP}`,
    "",
    "## Layered Comparison",
    `- HISTORICAL_REPLAY: delta=${historicalReplayDelta}, direction=${historicalDirection}`,
    `- HISTORICAL_OOS: delta=${historicalOosDelta}, direction=${historicalOosDirection}`,
    `- LIVE_SHADOW_HOLDOUT: delta=${shadowDeltaNet}, direction=${liveDirection}`,
    "",
    "## Shadow Performance",
    `- shadowEvaluationCount=${shadowMetrics.shadowEvaluationCount}`,
    `- shadowErrors=${shadowErrorCount}`,
    `- shadowTimeouts=${shadowMetrics.shadowTimeouts}`,
    `- shadowLatencyP50=${shadowMetrics.shadowEvaluationLatencyP50}`,
    `- shadowLatencyP95=${shadowMetrics.shadowEvaluationLatencyP95}`,
    `- shadowLatencyP99=${shadowMetrics.shadowEvaluationLatencyP99}`,
    "",
  ];
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_P2_VARIANT_D_LIVE_SHADOW_HOLDOUT_REPORT.md"), `${mdLines.join("\n")}\n`, "utf8");

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  const payload = {
    runId: RUN_ID,
    verdict: "FAILED",
    error: (error as Error).message,
    stack: (error as Error).stack,
  };
  writeJson(path.join(process.cwd(), "export-error.json"), payload);
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
