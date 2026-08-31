/**
 * P2 — Single-variable spread+momentum shadow paper validation.
 * Phase 1: 1 baseline round. Phase 2: 5 observe-only experimental rounds.
 * No production scanner decision change (no experimental enable flag exists).
 *
 * Usage: npx tsx scripts/run-p2-single-variable-spread-momentum-paper.ts
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";
import { classifyRoundTerminalReason } from "@/src/server/forensics/round-terminal-classification.service";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import {
  buildScannerRejectTelemetryBundle,
  classifyFalseNegativeScannerCause,
} from "@/src/server/scanner/scanner-reject-telemetry.service";
import type { MarketContext } from "@/src/types/scanner";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const VALIDATION_ID = `spread-momentum-shadow-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const BASELINE_ROUNDS = 1;
const EXPERIMENTAL_ROUNDS = 5;
const TOTAL_ROUNDS = BASELINE_ROUNDS + EXPERIMENTAL_ROUNDS;
const MAX_WAIT_SEC = 600;
const POLL_MS = 15_000;
const MAX_ROUND_MINUTES = 30;
const ENGINE_TERMINALIZATION_GRACE_MS = 180_000;
const JOB_DEADLINE_MS = TOTAL_ROUNDS * MAX_ROUND_MINUTES * 60_000 + ENGINE_TERMINALIZATION_GRACE_MS;
const ORPHAN_GRACE_MS = 180_000;

const OUT = {
  report: path.join(process.cwd(), "KRIPTO_P2_SINGLE_VARIABLE_SPREAD_MOMENTUM_PAPER_REPORT.md"),
  summary: path.join(process.cwd(), "kripto-p2-single-variable-spread-momentum.json"),
  rounds: path.join(process.cwd(), "kripto-p2-single-variable-rounds.csv"),
  trades: path.join(process.cwd(), "kripto-p2-single-variable-trades.csv"),
  pnl: path.join(process.cwd(), "kripto-p2-single-variable-pnl.csv"),
  shadowDiff: path.join(process.cwd(), "kripto-p2-single-variable-shadow-diff.csv"),
  runtime: path.join(process.cwd(), "kripto-p2-single-variable-runtime.json"),
};

const TERMINAL_ROUND_STATES = [
  "tur_tamamlandi",
  "tur_basarisiz",
  "sure_doldu",
  "satis_gerceklesti",
  "zarar_durdur_calisti",
];

type ShadowDiffRow = {
  symbol: string;
  timestamp: string;
  roundNo: number;
  phase: "BASELINE" | "EXPERIMENTAL";
  baselineDecision: string;
  shadowDecision: string;
  shadowReason: string;
  currentSpread: number | string;
  spreadThreshold: number;
  momentumBreakoutOk: boolean | string;
  dataQuality: string;
  source: string;
  falsePositiveClass: string;
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

function roundDir(sessionId: string, roundNo: number | string) {
  return path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", String(roundNo));
}

function maxPreAiSpread() {
  return Math.min(0.14, Math.max(0.08, env.SCANNER_MAX_SPREAD_PERCENT));
}

function asMarketContext(raw: unknown): MarketContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!r.symbol) return null;
  return {
    symbol: String(r.symbol),
    lastPrice: Number(r.lastPrice ?? 0),
    change24h: Number(r.change24h ?? 0),
    volume24h: Number(r.volume24h ?? 0),
    volumeSpikePercent: Number(r.volumeSpikePercent ?? 0),
    spreadPercent: Number(r.spreadPercent ?? 0),
    volatilityPercent: Number(r.volatilityPercent ?? 0),
    momentumPercent: Number(r.momentumPercent ?? 0),
    orderBookImbalance: Number(r.orderBookImbalance ?? 0),
    buyPressure: Number(r.buyPressure ?? 0),
    shortCandleSignal: Number(r.shortCandleSignal ?? 0),
    fakeSpikeScore: Number(r.fakeSpikeScore ?? 0),
    pumpRisk: Number(r.pumpRisk ?? 0),
    pumpIntensity: Number(r.pumpIntensity ?? 0),
    tradable: Boolean(r.tradable),
    rejectReasons: Array.isArray(r.rejectReasons) ? (r.rejectReasons as string[]) : [],
    metadata: (r.metadata as Record<string, unknown>) ?? {},
  };
}

function extractShadowFromTimeline(details: unknown): Partial<ShadowDiffRow> | null {
  if (!details || typeof details !== "object") return null;
  const d = details as Record<string, unknown>;
  const shadow = d.spreadMomentumShadow as Record<string, unknown> | undefined;
  if (!shadow) return null;
  const baseline = String(shadow.currentPolicyDecision ?? "");
  const shadowDec = String(shadow.shadowPolicyDecision ?? "");
  if (!baseline || !shadowDec) return null;
  return {
    baselineDecision: baseline,
    shadowDecision: shadowDec,
    shadowReason: String(shadow.shadowRationale ?? ""),
    currentSpread: shadow.spreadPercent ?? "MISSING",
    spreadThreshold: Number(shadow.spreadThreshold ?? maxPreAiSpread()),
    momentumBreakoutOk: shadow.momentumBreakoutOk as boolean | string,
    dataQuality: String(shadow.dataQuality ?? "UNKNOWN"),
    source: "timeline",
  };
}

function replayShadowFromContext(context: MarketContext, candidateId: string): ShadowDiffRow | null {
  const score = scoreContext(context);
  const bundle = buildScannerRejectTelemetryBundle({
    context,
    score,
    maxPreAiSpreadPercent: maxPreAiSpread(),
    candidateId,
  });
  const baseline = bundle.shadow.currentPolicyDecision;
  const shadow = bundle.shadow.shadowPolicyDecision;
  if (baseline === shadow) return null;
  const fpClass = classifyFalseNegativeScannerCause(bundle.telemetry, bundle.shadow);
  return {
    symbol: context.symbol.toUpperCase(),
    timestamp: new Date().toISOString(),
    roundNo: 0,
    phase: "EXPERIMENTAL",
    baselineDecision: baseline,
    shadowDecision: shadow,
    shadowReason: bundle.shadow.shadowRationale,
    currentSpread: bundle.shadow.spreadPercent,
    spreadThreshold: bundle.shadow.spreadThreshold,
    momentumBreakoutOk: bundle.shadow.momentumBreakoutOk,
    dataQuality: String(bundle.shadow.dataQuality),
    source: "offline_replay",
    falsePositiveClass: fpClass === "true_spread" ? "LEGITIMATE_REJECTION" : fpClass === "unknown" ? "UNKNOWN" : "SAFE_RELEASE",
  };
}

async function extractRoundShadowDiffs(
  prisma: typeof import("@/src/server/db/prisma").prisma,
  sessionId: string,
  roundNo: number,
  phase: "BASELINE" | "EXPERIMENTAL",
  startedAt?: Date | null,
  endedAt?: Date | null,
): Promise<ShadowDiffRow[]> {
  const root = roundDir(sessionId, roundNo);
  const diffs: ShadowDiffRow[] = [];
  const seen = new Set<string>();

  if (startedAt && endedAt) {
    const events = await prisma.decisionTimelineEvent.findMany({
      where: { createdAt: { gte: startedAt, lte: endedAt }, stage: "SCANNER" },
      include: { decision: true },
    });
    for (const ev of events) {
      const partial = extractShadowFromTimeline(ev.details);
      if (!partial || partial.baselineDecision === partial.shadowDecision) continue;
      const sym = String(ev.decision?.symbol ?? "").toUpperCase();
      const key = `${sym}|${partial.baselineDecision}|${partial.shadowDecision}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diffs.push({
        symbol: sym,
        timestamp: ev.createdAt.toISOString(),
        roundNo,
        phase,
        baselineDecision: partial.baselineDecision,
        shadowDecision: partial.shadowDecision,
        shadowReason: partial.shadowReason ?? "",
        currentSpread: partial.currentSpread ?? "MISSING",
        spreadThreshold: partial.spreadThreshold ?? maxPreAiSpread(),
        momentumBreakoutOk: partial.momentumBreakoutOk ?? "MISSING",
        dataQuality: partial.dataQuality ?? "UNKNOWN",
        source: "timeline_db",
        falsePositiveClass: "UNKNOWN",
      });
    }
  }

  const candidates = readJson<{ candidates?: Array<Record<string, unknown>> }>(path.join(root, "candidate-trace.json"));
  for (const c of candidates?.candidates ?? []) {
    const ctx = asMarketContext(c.marketContext);
    if (!ctx) continue;
    const replay = replayShadowFromContext(ctx, String(c.candidateId ?? `replay:${ctx.symbol}`));
    if (!replay) continue;
    const key = `${replay.symbol}|${replay.baselineDecision}|${replay.shadowDecision}|replay`;
    if (seen.has(key)) continue;
    seen.add(key);
    diffs.push({ ...replay, roundNo, phase, timestamp: String(c.timestamp ?? replay.timestamp) });
  }

  const decisions = readJson<{ decisions?: Array<Record<string, unknown>> }>(path.join(root, "decision-trace.json"));
  for (const d of decisions?.decisions ?? []) {
    if (String(d.stage) !== "scanner" && String(d.reasonCode) !== "PRE_AI_SPREAD_REJECT") continue;
    const sym = String(d.symbol ?? "").toUpperCase();
    const key = `${sym}|PRE_AI|trace`;
    if (seen.has(key)) continue;
    seen.add(key);
    diffs.push({
      symbol: sym,
      timestamp: String(d.timestamp ?? ""),
      roundNo,
      phase,
      baselineDecision: "REJECT",
      shadowDecision: "UNKNOWN",
      shadowReason: String(d.reasonDetail ?? d.reasonCode ?? "PRE_AI_SPREAD_REJECT"),
      currentSpread: "UNKNOWN",
      spreadThreshold: maxPreAiSpread(),
      momentumBreakoutOk: "UNKNOWN",
      dataQuality: "UNKNOWN",
      source: "decision_trace",
      falsePositiveClass: "UNKNOWN",
    });
  }

  return diffs;
}

function analyzeRoundBasics(sessionId: string, roundNo: number, roundMeta: Record<string, unknown>, phase: string) {
  const rid = String(roundNo);
  const root = roundDir(sessionId, roundNo);
  const summary = readJson<Record<string, unknown>>(path.join(root, "round-summary.json"));
  const decisions = readJson<{ decisions?: Array<Record<string, unknown>> }>(path.join(root, "decision-trace.json"));
  const execution = readJson<{ orders?: Array<Record<string, unknown>> }>(path.join(root, "execution-trace.json"));
  const riskSizing = readJson<{ riskSizing?: Array<Record<string, unknown>> }>(path.join(root, "risk-sizing-trace.json"));
  const aiProgress = readJson<{ candidates?: Array<Record<string, unknown>> }>(path.join(root, "ai-progress.json"));
  const aiTrace = readJson<{ aiCalls?: Array<Record<string, unknown>> }>(path.join(root, "ai-trace.json"));
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

  const aiStartedOrphans = aiCandidates.filter((c) => {
    if (String(c.status) !== "STARTED") return false;
    const started = Date.parse(String(c.startedAt ?? ""));
    return Number.isFinite(started) && Date.now() - started > ORPHAN_GRACE_MS;
  }).length;

  const scannerRejections = (scannerQ?.rejections ?? []).length;
  const scannerPass = Number(summary?.qualifiedCount ?? summary?.candidateCount ?? 0) - scannerRejections;

  const durationMs =
    roundMeta.startedAt && roundMeta.endedAt
      ? new Date(String(roundMeta.endedAt)).getTime() - new Date(String(roundMeta.startedAt)).getTime()
      : Number(summary?.durationMs ?? 0);

  const terminalClass = classifyRoundTerminalReason({
    reason: String(roundMeta.failReason ?? summary?.failReason ?? ""),
    currentStage: String(roundMeta.state ?? ""),
  });

  return {
    roundNo,
    roundId: rid,
    phase,
    startedAt: roundMeta.startedAt,
    endedAt: roundMeta.endedAt,
    durationMs,
    durationMin: Number((durationMs / 60_000).toFixed(2)),
    terminalState: roundMeta.state,
    failReason: roundMeta.failReason,
    terminal: TERMINAL_ROUND_STATES.includes(String(roundMeta.state)),
    terminalClass: terminalClass.terminalClass,
    scanner: {
      candidateCount: Number(summary?.candidateCount ?? 0),
      scannerPass: Math.max(0, scannerPass),
      scannerReject: scannerRejections,
      exactRejectCodes: (scannerQ?.rejections ?? []).map((r) => String(r.reasonCode ?? "")),
    },
    tdi: {
      approved: tdiRecords.filter((r) => r.verdict === "APPROVED").length,
      wait: tdiRecords.filter((r) => r.verdict === "WAIT").length,
      reject: tdiRecords.filter((r) => r.verdict === "REJECT" || r.verdict === "REJECTED").length,
    },
    ai: {
      invoked: aiCandidates.length || (aiTrace?.aiCalls?.length ?? 0),
      remote: (aiTrace?.aiCalls ?? []).filter((r) => r.remote === true).length,
      degraded: (aiTrace?.aiCalls ?? []).filter((r) => r.degraded === true).length,
      timeouts: aiCandidates.filter((r) => String(r.reasonCode).includes("TIMEOUT")).length,
      veto: decisionRows.filter((r) => String(r.reasonCode).includes("VETO")).length,
      finalDecision: decisionRows.find((r) => r.stage === "consensus")?.verdict ?? "",
    },
    ev: {
      evaluated: (evTrace?.evAudits ?? []).length,
      pass: (evTrace?.evAudits ?? []).filter((r) => r.verdict === "APPROVED").length,
      wait: (evTrace?.evAudits ?? []).filter((r) => r.verdict === "WAIT").length,
      reject: (evTrace?.evAudits ?? []).filter((r) => r.verdict === "REJECT" || r.verdict === "REJECTED").length,
    },
    risk: {
      evaluated: riskRows.filter((r) => r.stage === "risk" || !r.stage).length,
      pass: riskRows.filter((r) => (r.verdict === "PASS" || r.verdict === "APPROVED") && r.stage !== "sizing").length,
      reject: riskRows.filter((r) => r.verdict === "REJECT" || r.verdict === "REJECTED").length,
    },
    sizing: {
      evaluated: riskRows.filter((r) => r.stage === "sizing").length,
      pass: riskRows.filter((r) => r.stage === "sizing" && (r.verdict === "PASS" || r.verdict === "APPROVED")).length,
      reject: riskRows.filter((r) => r.stage === "sizing" && (r.verdict === "REJECT" || r.verdict === "REJECTED")).length,
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
      tradeCount: pnlEntries.length,
    },
    safety: {
      aiStartedOrphans: aiStartedOrphans,
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
  const { startAutoRoundJob, getAutoRoundStatus, stopAutoRoundJob } = await import(
    "@/src/server/execution/auto-round-engine.service"
  );
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const startedAt = new Date().toISOString();
  const criticalFailures: Array<{ code: string; message: string }> = [];

  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${VALIDATION_ID}-preflight`,
  });

  if (!preflight.canStart) {
    const blocked = { validationId: VALIDATION_ID, phase: "PREFLIGHT_BLOCKED", preflight };
    writeJson(OUT.summary, blocked);
    console.log(JSON.stringify(blocked));
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
  const sessionRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId);
  writeJson(path.join(sessionRoot, "preflight.json"), preflight);
  writeJson(path.join(sessionRoot, "single-variable-spread-momentum-meta.json"), {
    validationId: VALIDATION_ID,
    experimentalMode: "OBSERVE_ONLY",
    productionPolicyChanged: false,
    variable: "spread+momentum shadow telemetry",
    baselineRounds: BASELINE_ROUNDS,
    experimentalRounds: EXPERIMENTAL_ROUNDS,
    note: "No SCANNER_SHADOW enable flag — baseline decisions unchanged; shadow recorded only",
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

  const roundAnalyses: ReturnType<typeof analyzeRoundBasics>[] = [];
  const allShadowDiffs: ShadowDiffRow[] = [];

  for (const r of finalJob?.rounds ?? []) {
    const phase = r.roundNo <= BASELINE_ROUNDS ? "BASELINE" : "EXPERIMENTAL";
    const analysis = analyzeRoundBasics(sessionId, r.roundNo, r as unknown as Record<string, unknown>, phase);
    roundAnalyses.push(analysis);

    const shadowDiffs = await extractRoundShadowDiffs(
      prisma,
      sessionId,
      r.roundNo,
      phase as "BASELINE" | "EXPERIMENTAL",
      r.startedAt,
      r.endedAt,
    );
    for (const row of shadowDiffs) {
      row.roundNo = r.roundNo;
      row.phase = phase as "BASELINE" | "EXPERIMENTAL";
    }
    analysis.scanner.scannerShadowDifferent = shadowDiffs.length;
    allShadowDiffs.push(...shadowDiffs);
  }

  const zombieCount = await prisma.autoRoundRun.count({
    where: {
      jobId: sessionId,
      endedAt: null,
      state: { in: ["tariyor", "coin_secildi", "alim_yapildi", "satis_bekleniyor"] },
    },
  });

  const aiVetoBypass = roundAnalyses.reduce((a, r) => {
    const decisions = readJson<{ decisions?: Array<Record<string, unknown>> }>(
      path.join(roundDir(sessionId, r.roundNo), "decision-trace.json"),
    );
    const orders = readJson<{ orders?: Array<Record<string, unknown>> }>(
      path.join(roundDir(sessionId, r.roundNo), "execution-trace.json"),
    );
    let n = 0;
    for (const o of orders?.orders ?? []) {
      const aiVerdict = String(o.aiVerdict ?? "").toUpperCase();
      if (["NO_TRADE", "HOLD", "REJECT", "WAIT"].includes(aiVerdict) && String(o.side).toUpperCase() === "BUY") n += 1;
    }
    return a + n;
  }, 0);

  const aiStartedOrphans = roundAnalyses.reduce((a, r) => a + r.safety.aiStartedOrphans, 0);
  const pnlMismatch = roundAnalyses.reduce((a, r) => a + r.safety.pnlMismatch, 0);

  const allPnlEntries = roundAnalyses.flatMap((r) => r.pnlEntries as Array<Record<string, unknown>>);
  const allOrders = roundAnalyses.flatMap((r) => r.orderRows as Array<Record<string, unknown>>);
  const grossPnL = allPnlEntries.reduce((a, r) => a + Number(r.grossPnL ?? 0), 0);
  const fees = allPnlEntries.reduce((a, r) => a + Number(r.totalFee ?? 0), 0);
  const netPnL = allPnlEntries.reduce((a, r) => a + Number(r.netPnL ?? 0), 0);
  const wins = allPnlEntries.filter((r) => Number(r.netPnL) > 0).length;
  const losses = allPnlEntries.filter((r) => Number(r.netPnL) < 0).length;
  const closedTrades = allPnlEntries.length;
  const liveTrades = allOrders.filter((r) => String(r.side).toUpperCase() === "BUY").length;

  const expectancy = closedTrades > 0 ? netPnL / closedTrades : null;
  const profitFactor =
    losses > 0
      ? allPnlEntries.filter((r) => Number(r.netPnL) > 0).reduce((a, r) => a + Number(r.netPnL), 0) /
        Math.abs(allPnlEntries.filter((r) => Number(r.netPnL) < 0).reduce((a, r) => a + Number(r.netPnL), 0))
      : null;

  const baselineRounds = roundAnalyses.filter((r) => r.phase === "BASELINE");
  const experimentalRounds = roundAnalyses.filter((r) => r.phase === "EXPERIMENTAL");
  const executionReadyBaseline = baselineRounds.reduce((a, r) => a + r.execution.executionReady, 0);
  const executionReadyExperimental = experimentalRounds.reduce((a, r) => a + r.execution.executionReady, 0);

  const shadowFalseReleases = allShadowDiffs.filter(
    (r) => r.baselineDecision === "REJECT" && r.shadowDecision === "PASS" && r.falsePositiveClass === "SAFE_RELEASE",
  ).length;

  const technicalValidity =
    zombieCount === 0 &&
    aiVetoBypass === 0 &&
    pnlMismatch === 0 &&
    aiStartedOrphans === 0 &&
    !criticalFailures.length &&
    roundAnalyses.filter((r) => r.terminal).length >= BASELINE_ROUNDS
      ? "PASS"
      : zombieCount > 0 || aiVetoBypass > 0 || pnlMismatch > 0
        ? "FAIL"
        : "PASS";

  const economicSignal = closedTrades > 0 ? (netPnL > 0 ? "POSITIVE" : "NEGATIVE") : "NOT_PROVEN";

  const tradeRows = allPnlEntries.map((r) => ({
    tradeId: r.tradeId,
    positionId: r.positionId,
    symbol: r.symbol,
    strategy: r.strategy,
    regime: r.regime,
    entryTimestamp: r.entryTimestamp,
    entryPrice: r.entryPrice,
    quantity: r.quantity,
    notional: r.notional,
    exitTimestamp: r.exitTimestamp,
    exitPrice: r.exitPrice,
    exitReason: r.exitReason,
    exitModel: (r.exitForensics as Record<string, unknown> | undefined)?.exitModel ?? r.exitModel,
    grossPnL: r.grossPnL,
    fees: r.totalFee,
    netPnL: r.netPnL,
    netCheck: Number(r.grossPnL) - Number(r.totalFee),
  }));

  const pnlRows = allPnlEntries.map((r) => ({
    tradeId: r.tradeId,
    symbol: r.symbol,
    grossPnL: r.grossPnL,
    fees: r.totalFee,
    netPnL: r.netPnL,
    netEqualsGrossMinusFees: Math.abs(Number(r.netPnL) - (Number(r.grossPnL) - Number(r.totalFee))) < 0.0001,
  }));

  const roundCsvRows = roundAnalyses.map((r) => ({
    roundId: r.roundId,
    roundNo: r.roundNo,
    phase: r.phase,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMin: r.durationMin,
    terminalState: r.terminalState,
    failReason: r.failReason,
    candidateCount: r.scanner.candidateCount,
    scannerPass: r.scanner.scannerPass,
    scannerReject: r.scanner.scannerReject,
    scannerShadowDifferent: r.scanner.scannerShadowDifferent ?? 0,
    tdiApproved: r.tdi.approved,
    tdiWait: r.tdi.wait,
    tdiReject: r.tdi.reject,
    aiInvoked: r.ai.invoked,
    aiDegraded: r.ai.degraded,
    evEvaluated: r.ev.evaluated,
    executionReady: r.execution.executionReady,
    orders: r.execution.orders,
    closedTrades: r.execution.closedTrades,
    netPnL: r.pnl.netPnL,
  }));

  writeCsv(OUT.rounds, roundCsvRows);
  writeCsv(OUT.trades, tradeRows);
  writeCsv(OUT.pnl, pnlRows);
  writeCsv(OUT.shadowDiff, allShadowDiffs);

  const verdict = {
    BASELINE_ROUND_COMPLETED: baselineRounds.some((r) => r.terminal) ? "YES" : "NO",
    EXPERIMENTAL_ROUNDS_COMPLETED: experimentalRounds.filter((r) => r.terminal).length,
    SHADOW_DECISION_DIFFERENCES: allShadowDiffs.length,
    EXECUTION_READY_BASELINE: executionReadyBaseline,
    EXECUTION_READY_EXPERIMENTAL: executionReadyExperimental,
    LIVE_TRADES: liveTrades,
    CLOSED_TRADES: closedTrades,
    GROSS_PNL: Number(grossPnL.toFixed(4)),
    FEES: Number(fees.toFixed(4)),
    NET_PNL: Number(netPnL.toFixed(4)),
    EXPECTANCY: expectancy !== null ? Number(expectancy.toFixed(4)) : "N/A",
    PROFIT_FACTOR: profitFactor !== null ? Number(profitFactor.toFixed(4)) : "N/A",
    AI_VETO_BYPASS: aiVetoBypass,
    AI_STARTED_ORPHANS: aiStartedOrphans,
    ZOMBIES: zombieCount,
    PNL_MISMATCH: pnlMismatch,
    SHADOW_FALSE_RELEASES: shadowFalseReleases,
    ECONOMIC_SIGNAL: economicSignal,
    TECHNICAL_VALIDITY: technicalValidity,
    PRODUCTION_POLICY_CHANGED: "NO",
    NEXT_STEP:
      closedTrades === 0
        ? "Inspect next actual blocker after scanner shadow observe-only run (likely AI/consensus/EV); do not weaken another gate"
        : "Review closed trade sample before any gate change; compare shadow counterfactual per trade",
  };

  const summary = {
    validationId: VALIDATION_ID,
    startedAt,
    completedAt: new Date().toISOString(),
    sessionId,
    experimentalMode: "OBSERVE_ONLY",
    productionPolicyChanged: false,
    config: {
      mode: "PAPER",
      exchange: process.env.BINANCE_PLATFORM ?? "tr",
      aiGatePolicy: process.env.EXECUTION_AI_GATE_POLICY ?? "VETO",
      totalRounds: TOTAL_ROUNDS,
      baselineRounds: BASELINE_ROUNDS,
      experimentalRounds: EXPERIMENTAL_ROUNDS,
      variable: "spread+momentum shadow telemetry only",
    },
    preflight,
    job: finalJob
      ? {
          id: finalJob.id,
          status: finalJob.status,
          completedRounds: finalJob.completedRounds,
          failedRounds: finalJob.failedRounds,
        }
      : null,
    rounds: roundAnalyses,
    shadowDiffs: allShadowDiffs,
    profitability: {
      wins,
      losses,
      winRate: closedTrades ? wins / closedTrades : null,
      expectancy,
      profitFactor,
      classification: economicSignal,
    },
    safety: { zombieCount, aiVetoBypass, aiStartedOrphans, pnlMismatch, criticalFailures },
    verdict,
  };

  writeJson(OUT.summary, summary);
  writeJson(OUT.runtime, {
    validationId: VALIDATION_ID,
    sessionId,
    zombieCount,
    aiStartedOrphans,
    aiVetoBypass,
    pnlMismatch,
    criticalFailures,
    roundTerminalStates: roundAnalyses.map((r) => ({ roundNo: r.roundNo, state: r.terminalState, terminal: r.terminal })),
  });

  const md = [
    "# KRIPTO P2 — Single-Variable Spread+Momentum Shadow Paper Validation",
    "",
    `> Generated: ${summary.completedAt}`,
    `> Session: ${sessionId}`,
    "",
    "## Experiment Design",
    "",
    "- **Variable**: spread+momentum shadow evaluator (observe-only)",
    "- **Baseline**: current production scanner (round 1)",
    "- **Experimental**: rounds 2–6 with shadow telemetry, **no production decision change**",
    "- No `SCANNER_SHADOW` enable flag exists — live experimental branch did not alter decisions",
    "",
    "## Round Summary",
    "",
    "| Round | Phase | Terminal | Scanner reject | Shadow diffs | Exec ready | Closed | Net PnL |",
    "|-------|-------|----------|----------------|--------------|------------|--------|---------|",
    ...roundAnalyses.map(
      (r) =>
        `| ${r.roundNo} | ${r.phase} | ${r.terminalState} | ${r.scanner.scannerReject} | ${r.scanner.scannerShadowDifferent ?? 0} | ${r.execution.executionReady} | ${r.execution.closedTrades} | ${r.pnl.netPnL} |`,
    ),
    "",
    "## FINAL VERDICT",
    "",
    "```",
    ...Object.entries(verdict).map(([k, v]) => `${k} = ${v}`),
    "```",
    "",
  ].join("\n");

  fs.writeFileSync(OUT.report, md, "utf8");

  console.log(JSON.stringify({ ok: true, sessionId, verdict }));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
