/**
 * Build KRIPTO_4H_EXTENDED_PAPER_BASELINE_REPORT.md and machine result JSON.
 * Usage: npx tsx scripts/build-4h-extended-paper-baseline-report.ts [--campaignId=...]
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export type Build4hReportInput = { campaignId?: string };

function loadEnv() {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    const k = line.slice(0, i);
    const v = line.slice(i + 1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function argValue(prefix: string) {
  return process.argv.find((a) => a.startsWith(`${prefix}=`))?.split("=")[1];
}

function pct(n: number, total: number) {
  if (total <= 0) return "0.00";
  return ((n / total) * 100).toFixed(2);
}

function bucketConfidence(v: number) {
  if (v < 30) return "0-29";
  if (v < 45) return "30-44";
  if (v < 55) return "45-54";
  if (v < 70) return "55-69";
  if (v < 82) return "70-81";
  if (v < 90) return "82-89";
  return "90-100";
}

function bucketRisk(v: number) {
  if (v <= 25) return "0-25";
  if (v <= 50) return "26-50";
  if (v <= 75) return "51-75";
  if (v <= 90) return "76-90";
  return "91-100";
}

function sampleVerdict(closed: number) {
  if (closed === 0) return "INSUFFICIENT_DATA";
  if (closed <= 4) return "VERY_LOW_SAMPLE";
  if (closed <= 19) return "LOW_SAMPLE";
  if (closed <= 49) return "PRELIMINARY_EVIDENCE";
  return "MEANINGFUL_PAPER_SAMPLE";
}

function resolveFirstRejectionGate(failReason: string | null, metadata: Record<string, unknown>) {
  const terminal = String(metadata.terminalReason ?? failReason ?? "").trim();
  const upper = terminal.toUpperCase();
  if (!terminal || upper.includes("NO_ELIGIBLE")) return { gate: "NO_ELIGIBLE_CANDIDATE", reason: terminal };
  if (upper.includes("AI_NO_TRADE") || (upper.includes("NO_TRADE") && !upper.includes("ENTRY_QUALITY"))) {
    return { gate: "AI_NO_TRADE", reason: terminal };
  }
  if (upper.includes("ENTRY_QUALITY") || upper.includes("ELITE CONFIDENCE") || upper.includes("AI_RISK_ELEVATED")) {
    return { gate: "ENTRY_QUALITY", reason: terminal };
  }
  if (upper.includes("SPREAD")) return { gate: "ENTRY_SPREAD", reason: terminal };
  if (upper.includes("LIQUIDITY")) return { gate: "ENTRY_LIQUIDITY", reason: terminal };
  if (upper.includes("RISK_") || upper.includes("ADMISSION")) return { gate: "RISK_REJECT", reason: terminal };
  if (upper.includes("SIZING") || upper.includes("MIN_NOTIONAL")) return { gate: "SIZING_MIN_NOTIONAL", reason: terminal };
  if (upper.includes("HANDOFF_")) return { gate: "HANDOFF_INVALID", reason: terminal };
  if (upper.includes("EXECUTION")) return { gate: "EXECUTION_ROUTING", reason: terminal };
  return { gate: terminal.split(":")[0] || "OTHER", reason: terminal };
}

function countLogPatterns(logPath: string) {
  const counts = {
    http429: 0,
    http418: 0,
    wsReconnects: 0,
    wsStale: 0,
    restFallback: 0,
    restErrors: 0,
    aiTimeouts: 0,
    aiParseErrors: 0,
    aiProviderFailures: 0,
    dbErrors: 0,
    redisErrors: 0,
    workerErrors: 0,
    orderErrors: 0,
    fillErrors: 0,
    klineRefreshAttempts: 0,
  };
  if (!fs.existsSync(logPath)) return counts;
  const text = fs.readFileSync(logPath, "utf8");
  const patterns: Array<[keyof typeof counts, RegExp]> = [
    ["http429", /\b429\b|TOO_MANY_REQUESTS|rate.?limit/i],
    ["http418", /\b418\b|IP_BANNED/i],
    ["wsReconnects", /websocket.*reconnect|ws.*reconnect|stream.*reconnect/i],
    ["wsStale", /websocket.*stale|ws.*stale|stream.*stale/i],
    ["restFallback", /rest_recovery|REST fallback|recovery:\s*true/i],
    ["restErrors", /REST.*error|marketData.*failed/i],
    ["aiTimeouts", /AI.*timeout|consensus.*timeout|ETIMEDOUT.*ai/i],
    ["aiParseErrors", /AI.*parse|consensus.*parse|INVALID_RESPONSE/i],
    ["aiProviderFailures", /AI_PROVIDER_DEGRADED|provider.*failed|providerFailureCount/i],
    ["dbErrors", /prisma.*error|database.*error|DB_ERROR/i],
    ["redisErrors", /redis.*error|REDIS_ERROR/i],
    ["workerErrors", /worker.*exception|unhandled.*rejection/i],
    ["orderErrors", /order.*error|ORDER_ERROR|order.*failed/i],
    ["fillErrors", /fill.*error|FILL_ERROR/i],
    ["klineRefreshAttempts", /AI_KLINE_INPUT|refreshAttempted.*true|rest_recovery/i],
  ];
  for (const [key, re] of patterns) {
    counts[key] = text.match(new RegExp(re.source, re.flags + "g"))?.length ?? 0;
  }
  return counts;
}

function cashDelta(before: Record<string, number> | null, after: Record<string, number> | null, asset: string) {
  return Number(after?.[asset] ?? 0) - Number(before?.[asset] ?? 0);
}

export async function build4hExtendedPaperBaselineReport(input: Build4hReportInput = {}) {
  loadEnv();
  const RESULT_FILE = path.join(process.cwd(), "kripto-4h-extended-paper-baseline-result.json");
  const REPORT_FILE = path.join(process.cwd(), "KRIPTO_4H_EXTENDED_PAPER_BASELINE_REPORT.md");
  const startingHead = "fbf5c721f17cb903517fccc626b7ac7eb07984f4";
  let finalHead = startingHead;
  try {
    finalHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* ignore */
  }

  const interim = readJson<Record<string, unknown>>(RESULT_FILE);
  const campaignId =
    input.campaignId ??
    argValue("--campaignId") ??
    (typeof interim?.campaignId === "string" ? interim.campaignId : null) ??
    fs
      .readdirSync(path.join(process.cwd(), "artifacts", "paper-campaigns"))
      .filter((n) => n.startsWith("paper-4h-"))
      .sort()
      .pop();

  if (!campaignId) throw new Error("campaignId not found");
  const artifactRoot = path.join(process.cwd(), "artifacts", "paper-campaigns", campaignId);
  const result = readJson<Record<string, unknown>>(path.join(artifactRoot, "final-snapshot.json")) ?? interim;
  const jobId = String(result?.jobId ?? "");
  const campaignCmpId = jobId ? `cmp:${jobId}` : null;
  const startedAt = String(result?.jobStartedAt ?? "");
  const endedAt = String(result?.endedAt ?? new Date().toISOString());

  const { prisma } = await import("@/src/server/db/prisma");
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { buildPaperCampaignSummary } = await import("@/src/server/forensics/paper-campaign-summary.service");
  const { user } = await getRuntimeExecutionContext();

  const job = jobId
    ? await prisma.autoRoundJob.findUnique({
        where: { id: jobId },
        include: { rounds: { orderBy: { roundNo: "asc" } } },
      })
    : null;

  const rounds = job?.rounds ?? [];
  const selectedRounds = rounds.filter((r) => r.symbol);
  const noEligibleRounds = rounds.filter((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const fr = String(r.failReason ?? meta.terminalReason ?? "");
    return !r.symbol && fr.toUpperCase().includes("NO_ELIGIBLE");
  });

  const eventTypes = [
    "AI_KLINE_INPUT",
    "AI_KLINE_STALE",
    "AI_ANALYSIS_STARTED",
    "AI_ANALYSIS_RESULT",
    "RISK_GATE_BLOCKED",
    "BUY_DECISION",
    "BUY_ORDER_SENT",
    "BUY_COMPLETED",
    "SELL_COMPLETED",
  ];
  const started = new Date(startedAt);
  const ended = new Date(endedAt);
  const tradeLogs = await prisma.tradeEventLog.findMany({
    where: { createdAt: { gte: started, lte: ended }, eventType: { in: eventTypes } },
    orderBy: { createdAt: "asc" },
    take: 20_000,
  });

  const klineInputs = tradeLogs.filter((r) => r.eventType === "AI_KLINE_INPUT");
  const klineStale = tradeLogs.filter((r) => r.eventType === "AI_KLINE_STALE");
  const aiResults = tradeLogs.filter((r) => r.eventType === "AI_ANALYSIS_RESULT");

  const klineHealth = {
    freshInputs: klineInputs.filter((r) => (r.newValue as Record<string, unknown>)?.fresh === true).length,
    refreshAttempts: klineInputs.filter((r) => (r.newValue as Record<string, unknown>)?.refreshAttempted === true).length,
    refreshSuccesses: klineInputs.filter((r) => (r.newValue as Record<string, unknown>)?.refreshSucceeded === true).length,
    refreshFailures: klineInputs.filter((r) => {
      const nv = r.newValue as Record<string, unknown>;
      return nv?.refreshAttempted === true && nv?.refreshSucceeded !== true;
    }).length,
    staleRejects: klineStale.length,
    countInsufficient: klineStale.filter((r) => String(r.reason ?? "").includes("KLINE_COUNT_INSUFFICIENT")).length,
    tooOld: klineStale.filter((r) => String(r.reason ?? "").includes("KLINE_TOO_OLD")).length,
    timestampInvalid: klineStale.filter((r) => String(r.reason ?? "").includes("KLINE_TIMESTAMP_INVALID")).length,
    freshKlineRate: selectedRounds.length > 0
      ? Number((klineInputs.filter((r) => (r.newValue as Record<string, unknown>)?.fresh === true).length / Math.max(klineInputs.length, 1) * 100).toFixed(2))
      : null,
  };

  let providerAttempts = 0;
  let providerSuccesses = 0;
  let providerFailures = 0;
  let providerOutputs = 0;
  let realConsensusCount = 0;
  let aiBuy = 0;
  let aiSell = 0;
  let aiNoTrade = 0;
  let aiError = 0;
  const confidenceDist: Record<string, number> = {};
  const riskDist: Record<string, number> = {};
  const confidenceDistBuy: Record<string, number> = {};
  const confidenceDistNoTrade: Record<string, number> = {};
  const riskDistBuy: Record<string, number> = {};
  const riskDistNoTrade: Record<string, number> = {};

  for (const row of aiResults) {
    const nv = (row.newValue ?? {}) as Record<string, unknown>;
    providerAttempts += Number(nv.providerAttemptCount ?? 0);
    providerSuccesses += Number(nv.providerSuccessCount ?? 0);
    providerFailures += Number(nv.providerFailureCount ?? 0);
    providerOutputs += Number(nv.outputsCount ?? 0);
    if (Number(nv.outputsCount ?? 0) > 0 && Number(nv.providerSuccessCount ?? 0) > 0) realConsensusCount += 1;
    const decision = String(nv.consensusDecision ?? nv.decision ?? "").toUpperCase();
    const conf = Number(nv.consensusConfidence ?? nv.confidence ?? row.aiConfidence ?? 0);
    const risk = Number(nv.consensusRisk ?? nv.riskScore ?? 0);
    if (String(row.reason ?? "").includes("Kline data missing")) aiError += 1;
    else if (decision === "BUY") {
      aiBuy += 1;
      confidenceDistBuy[bucketConfidence(conf)] = (confidenceDistBuy[bucketConfidence(conf)] ?? 0) + 1;
      riskDistBuy[bucketRisk(risk)] = (riskDistBuy[bucketRisk(risk)] ?? 0) + 1;
    } else if (decision === "SELL") aiSell += 1;
    else aiNoTrade += 1;
    if (decision !== "BUY") {
      confidenceDistNoTrade[bucketConfidence(conf)] = (confidenceDistNoTrade[bucketConfidence(conf)] ?? 0) + 1;
      riskDistNoTrade[bucketRisk(risk)] = (riskDistNoTrade[bucketRisk(risk)] ?? 0) + 1;
    }
    confidenceDist[bucketConfidence(conf)] = (confidenceDist[bucketConfidence(conf)] ?? 0) + 1;
    riskDist[bucketRisk(risk)] = (riskDist[bucketRisk(risk)] ?? 0) + 1;
  }

  const rejectionHistogram: Record<string, number> = {};
  const selectedTraces: Array<Record<string, unknown>> = [];
  let entryQualityPass = 0;
  let entryQualityReject = 0;
  let riskPass = 0;
  let riskReject = 0;
  let sizingPass = 0;
  let sizingReject = 0;

  for (const r of selectedRounds) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const { gate, reason } = resolveFirstRejectionGate(r.failReason, meta);
    rejectionHistogram[gate] = (rejectionHistogram[gate] ?? 0) + 1;
    const aiDecision = String(meta.aiDecision ?? meta.aiFinalDecision ?? "").toUpperCase();
    if (gate === "ENTRY_QUALITY") entryQualityReject += 1;
    else if (aiDecision === "BUY" && !gate.includes("ENTRY")) entryQualityPass += 1;
    if (gate === "RISK_REJECT") riskReject += 1;
    else if (aiDecision === "BUY" && gate !== "ENTRY_QUALITY" && gate !== "AI_NO_TRADE") riskPass += 1;
    if (gate === "SIZING_MIN_NOTIONAL") sizingReject += 1;
    else if (meta.orderId || meta.executionId) sizingPass += 1;

    const symbol = String(r.symbol ?? "").toUpperCase();
    const klineEvent = klineInputs.find((e) => e.symbol === symbol);
    const klineNv = (klineEvent?.newValue ?? {}) as Record<string, unknown>;
    const aiEvent = aiResults.find((e) => e.symbol === symbol);
    const aiNv = (aiEvent?.newValue ?? {}) as Record<string, unknown>;

    selectedTraces.push({
      roundNo: r.roundNo,
      symbol,
      venue: meta.venue ?? meta.exchangeVenue ?? "UNKNOWN",
      candidateId: meta.opportunityCandidateId ?? meta.candidateId ?? null,
      scannerScore: meta.scannerScore ?? null,
      scannerConfidence: meta.scannerConfidence ?? null,
      microScore: meta.microScore ?? null,
      microState: meta.microState ?? null,
      klineCount: klineNv.count ?? null,
      klineAgeSec: klineNv.ageSec ?? null,
      klineSource: klineNv.source ?? null,
      klineRefreshed: klineNv.refreshed ?? false,
      providerAttemptCount: aiNv.providerAttemptCount ?? 0,
      providerSuccessCount: aiNv.providerSuccessCount ?? 0,
      providerOutputsCount: aiNv.outputsCount ?? 0,
      aiDecision,
      aiConfidence: meta.aiConfidence ?? aiNv.consensusConfidence ?? null,
      aiRisk: meta.aiRisk ?? aiNv.consensusRisk ?? null,
      entryQualityResult: gate === "ENTRY_QUALITY" ? "REJECT" : aiDecision === "BUY" ? "PASS" : "N/A",
      entryQualityReason: gate === "ENTRY_QUALITY" ? reason : null,
      riskResult: gate === "RISK_REJECT" ? "REJECT" : null,
      riskReason: gate === "RISK_REJECT" ? reason : null,
      sizingResult: gate === "SIZING_MIN_NOTIONAL" ? "REJECT" : null,
      sizingAmount: meta.sizingAmount ?? null,
      executionResult: meta.executionReached ? "REACHED" : "NOT_REACHED",
      terminalOutcome: gate,
      reasonCode: gate,
      orderId: meta.orderId ?? null,
      executionId: meta.executionId ?? null,
      positionId: meta.positionId ?? null,
    });
  }

  const dominantGates = Object.entries(rejectionHistogram)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([gate, count]) => ({
      gate,
      count,
      pctSelected: pct(count, selectedRounds.length),
      threshold: gate === "ENTRY_QUALITY" ? "82% elite confidence" : "production",
      medianObserved: null,
      p90: null,
    }));

  const tradeWhere = {
    userId: user.id,
    OR: [{ campaignId }, ...(campaignCmpId ? [{ campaignId: campaignCmpId }] : [])],
  };
  const [closedTrades, openTrades, orders, executions, foreignOrders, foreignTrades] = await Promise.all([
    prisma.paperTrade.findMany({ where: { ...tradeWhere, status: "CLOSED" }, orderBy: { closedAt: "asc" } }),
    prisma.paperTrade.findMany({ where: { ...tradeWhere, status: "OPEN" } }),
    prisma.tradeOrder.findMany({
      where: { userId: user.id, metadata: { path: ["campaignId"], equals: campaignId } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.tradeExecution.findMany({
      where: { tradeOrder: { userId: user.id, metadata: { path: ["campaignId"], equals: campaignId } } },
      orderBy: { executedAt: "asc" },
    }),
    prisma.tradeOrder.count({
      where: {
        userId: user.id,
        createdAt: { gte: started, lte: ended },
        NOT: { metadata: { path: ["campaignId"], equals: campaignId } },
      },
    }),
    prisma.paperTrade.count({
      where: {
        userId: user.id,
        createdAt: { gte: started, lte: ended },
        NOT: { OR: [{ campaignId }, ...(campaignCmpId ? [{ campaignId: campaignCmpId }] : [])] },
      },
    }),
  ]);

  const fees = executions.reduce((s, e) => s + Number(e.fee ?? 0), 0);
  const realizedPnl = closedTrades.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0);
  const unrealizedPnl = openTrades.reduce((s, t) => s + Number((t.metadata as Record<string, unknown> | null)?.unrealizedPnl ?? 0), 0);
  const wins = closedTrades.filter((t) => Number(t.realizedPnl ?? 0) > 0);
  const losses = closedTrades.filter((t) => Number(t.realizedPnl ?? 0) < 0);
  const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : null;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0) / wins.length : null;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0) / losses.length : null;
  const grossPnl = realizedPnl + fees;
  const profitFactor =
    losses.length > 0
      ? Math.abs(wins.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0) / losses.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0))
      : null;
  const expectancy =
    winRate !== null && avgWin !== null && avgLoss !== null
      ? winRate * avgWin - (1 - winRate) * Math.abs(avgLoss)
      : null;

  const paperCashBefore = (result?.paperCashBefore as Record<string, number> | null) ?? null;
  const paperCashAfter = (result?.paperCashAfter as Record<string, number> | null) ?? null;
  const accountingTolerance = 0.05;
  const expectedCashAfterTry = Number(paperCashBefore?.TRY ?? 0) + realizedPnl;
  const actualCashAfterTry = Number(paperCashAfter?.TRY ?? 0);
  const reconciled = Math.abs(expectedCashAfterTry - actualCashAfterTry) <= accountingTolerance;

  const summary = await buildPaperCampaignSummary({
    campaignId,
    jobId,
    userId: user.id,
    startedAt,
    endedAt,
    paperCashBefore,
  });

  const actualJobDurationMs = Number(result?.actualJobDurationMs ?? 0);
  const plannedDurationMs = Number(result?.plannedDurationMs ?? 14_400_000);
  const reachedTerminal = Boolean(result?.reachedTerminal);
  const completedFullDuration = Boolean(result?.completedFullDuration);
  const runtimeMinutes = Math.round(actualJobDurationMs / 60_000);

  const logPath = path.join(artifactRoot, "campaign-runner.log");
  const altLog = path.join(process.cwd(), "artifacts", "paper-campaigns", "_4h-campaign-runner.log");
  const health = countLogPatterns(fs.existsSync(logPath) ? logPath : altLog);

  const frozen = readJson<Record<string, unknown>>(path.join(artifactRoot, "frozen-config.json"));
  const preflight = readJson<Record<string, unknown>>(path.join(artifactRoot, "preflight.json"));
  const accountBefore = readJson<Record<string, unknown>>(path.join(artifactRoot, "account-snapshot-before.json"));

  const pipelineHealthy =
    reachedTerminal &&
    completedFullDuration &&
    klineHealth.staleRejects === 0 &&
    providerAttempts > 0 &&
    realConsensusCount > 0;
  const pipelineVerdict = !reachedTerminal ? "BROKEN" : pipelineHealthy ? "HEALTHY" : "DEGRADED";
  const accountingVerdict = reconciled ? "PASS" : paperCashBefore && paperCashAfter ? "FAIL" : "PARTIAL";
  const isolationPass = foreignOrders === 0 && foreignTrades === 0;
  const profitability = sampleVerdict(closedTrades.length);

  const readyFor8hPaper =
    runtimeMinutes >= 235 &&
    pipelineVerdict === "HEALTHY" &&
    accountingVerdict === "PASS" &&
    isolationPass &&
    reachedTerminal &&
    klineHealth.staleRejects === 0 &&
    providerAttempts > 0 &&
    frozen?.LIVE_TRADING_ENABLED === "false" &&
    frozen?.EXECUTION_MODE === "paper";

  const verdict =
    reachedTerminal && completedFullDuration && accountingVerdict !== "FAIL" && pipelineVerdict !== "BROKEN"
      ? "PASS"
      : reachedTerminal
        ? "PARTIAL"
        : "FAIL";

  const tradeForensic = closedTrades.map((t) => {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    return {
      symbol: t.symbol,
      side: "BUY",
      entryPrice: Number(t.entryPrice ?? 0),
      exitPrice: Number(t.exitPrice ?? 0),
      quantity: Number(t.quantity ?? 0),
      entryFee: Number(meta.entryFee ?? 0),
      exitFee: Number(meta.exitFee ?? 0),
      grossPnl: Number(t.realizedPnl ?? 0) + Number(meta.totalFees ?? 0),
      netPnl: Number(t.realizedPnl ?? 0),
      aiDecision: meta.aiDecision ?? null,
      aiConfidence: meta.aiConfidence ?? null,
      aiRisk: meta.aiRisk ?? null,
      holdingDurationSec: meta.holdingDurationSec ?? null,
      mfe: "NOT_AVAILABLE",
      mae: "NOT_AVAILABLE",
    };
  });

  const conversion = {
    opportunitySelectivity: rounds.length > 0 ? Number(pct(selectedRounds.length, rounds.length)) : "0.00",
    aiSelectivity: selectedRounds.length > 0 ? Number(pct(aiBuy, selectedRounds.length)) : "0.00",
    admissionConversion: selectedRounds.length > 0 ? Number(pct(entryQualityPass, selectedRounds.length)) : "0.00",
    executionConversion: selectedRounds.length > 0 ? Number(pct(orders.length, selectedRounds.length)) : "0.00",
    fillConversion: orders.length > 0 ? Number(pct(executions.length, orders.length)) : "0.00",
    tradeConversion: selectedRounds.length > 0 ? Number(pct(openTrades.length + closedTrades.length, selectedRounds.length)) : "0.00",
  };

  const machineResult = {
    verdict,
    pipelineVerdict,
    accountingVerdict,
    campaignId,
    jobId,
    runtimeMinutes,
    startingHead,
    finalHead,
    funnel: {
      rounds: rounds.length,
      selected: selectedRounds.length,
      handoffValid: summary.handoffValid,
      freshKline: klineHealth.freshInputs,
      noEligibleRounds: noEligibleRounds.length,
      aiBuy,
      aiSell,
      aiNoTrade,
      aiError,
      entryQualityPass,
      entryQualityReject,
      riskPass,
      riskReject,
      sizingPass,
      sizingReject,
      orders: orders.length,
      fills: executions.length,
      positionsOpened: openTrades.length + closedTrades.length,
      positionsClosed: closedTrades.length,
    },
    ai: {
      providerAttempts,
      providerSuccesses,
      providerFailures,
      outputs: providerOutputs,
      realConsensusCount,
    },
    kline: {
      freshInputs: klineHealth.freshInputs,
      refreshAttempts: klineHealth.refreshAttempts,
      refreshSuccesses: klineHealth.refreshSuccesses,
      refreshFailures: klineHealth.refreshFailures,
      staleRejects: klineHealth.staleRejects,
      freshKlineRate: klineHealth.freshKlineRate,
    },
    performance: {
      closedTrades: closedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      grossPnl,
      netPnl: realizedPnl,
      fees,
      profitFactor,
      expectancy,
      maxDrawdown: null,
      sampleVerdict: profitability,
    },
    health,
    conversion,
    dominantGate: dominantGates[0]?.gate ?? null,
    dominantRejections: dominantGates,
    campaignIsolation: { pass: isolationPass, foreignOrders, foreignTrades },
    liveTradingEnabled: false,
    readyFor8hPaper,
    artifactRoot,
  };

  writeJson(path.join(artifactRoot, "kline-health.json"), klineHealth);
  writeJson(path.join(artifactRoot, "ai-consensus-summary.json"), {
    aiBuy,
    aiSell,
    aiNoTrade,
    aiError,
    providerAttempts,
    providerSuccesses,
    providerFailures,
    providerOutputs,
    realConsensusCount,
    confidenceDist,
    riskDist,
    confidenceDistBuy,
    confidenceDistNoTrade,
    riskDistBuy,
    riskDistNoTrade,
  });
  writeJson(path.join(artifactRoot, "provider-health.json"), {
    providerAttempts,
    providerSuccesses,
    providerFailures,
    providerOutputs,
    realConsensusCount,
  });
  writeJson(path.join(artifactRoot, "selected-candidates.json"), { traces: selectedTraces });
  writeJson(path.join(artifactRoot, "rejection-histogram.json"), { rejectionHistogram, dominantGates });
  writeJson(path.join(artifactRoot, "dominant-gates.json"), { dominantGates, noEligibleRounds: noEligibleRounds.length });
  writeJson(path.join(artifactRoot, "trade-forensic.json"), tradeForensic);
  writeJson(path.join(artifactRoot, "accounting-reconciliation.json"), {
    cashBefore: paperCashBefore,
    cashAfter: paperCashAfter,
    realizedPnl,
    unrealizedPnl,
    fees,
    grossPnl,
    expectedCashAfterTry,
    actualCashAfterTry,
    reconciled,
    tolerance: accountingTolerance,
    isolationPass,
  });
  writeJson(path.join(artifactRoot, "runtime-health.json"), health);
  writeJson(RESULT_FILE, machineResult);
  writeJson(path.join(artifactRoot, "paper-campaign-summary.json"), summary);

  const lines: string[] = [];
  lines.push("# KRIPTO — 4 Hour Extended PAPER Strategy Baseline Report");
  lines.push("");
  lines.push(`> Campaign: \`${campaignId}\` · Job: \`${jobId}\` · Generated: ${new Date().toISOString()}`);
  lines.push(`> Baseline: CURRENT_STRATEGY_BASELINE (no threshold changes)`);
  lines.push("");
  lines.push("## 1. Executive Summary");
  lines.push("");
  lines.push("| Alan | Sonuç |");
  lines.push("|------|-------|");
  lines.push(`| Verdict | **${verdict}** |`);
  lines.push(`| PIPELINE_VERDICT | **${pipelineVerdict}** |`);
  lines.push(`| ACCOUNTING_VERDICT | **${accountingVerdict}** |`);
  lines.push(`| PROFITABILITY | **${profitability}** |`);
  lines.push(`| READY_FOR_8H_PAPER | **${readyFor8hPaper}** |`);
  lines.push(`| Runtime | ${runtimeMinutes} min (planned ${Math.round(plannedDurationMs / 60_000)}) |`);
  lines.push(`| Rounds / Selected | ${rounds.length} / ${selectedRounds.length} |`);
  lines.push(`| AI BUY / NO_TRADE | ${aiBuy} / ${aiNoTrade} |`);
  lines.push(`| Provider attempts / outputs | ${providerAttempts} / ${providerOutputs} |`);
  lines.push(`| Orders / Fills / Closed | ${orders.length} / ${executions.length} / ${closedTrades.length} |`);
  lines.push(`| Net PnL | ${realizedPnl.toFixed(4)} TRY | Fees | ${fees.toFixed(4)} |`);
  lines.push("");
  lines.push("## 2. Starting HEAD");
  lines.push(`\`${startingHead}\` → final \`${finalHead}\``);
  lines.push("");
  lines.push("## 3–4. Runtime config & Safety");
  lines.push(`- EXECUTION_MODE: \`${frozen?.EXECUTION_MODE}\``);
  lines.push(`- LIVE_TRADING_ENABLED: \`${frozen?.LIVE_TRADING_ENABLED}\``);
  lines.push(`- LIVE_AUTHORIZATION: \`${frozen?.LIVE_AUTHORIZATION}\``);
  lines.push("");
  lines.push("## 5. Preflight");
  lines.push(`- canStart: **${preflight?.canStart ?? "N/A"}**`);
  lines.push("");
  lines.push("## 6–7. Campaign & Timing");
  lines.push(`- started: ${startedAt}`);
  lines.push(`- ended: ${endedAt}`);
  lines.push(`- reachedTerminal: **${reachedTerminal}**`);
  lines.push(`- completedFullDuration: **${completedFullDuration}**`);
  lines.push("");
  lines.push("## 8–10. Pipeline / Kline / Provider health");
  lines.push("```json");
  lines.push(JSON.stringify({ klineHealth, ai: machineResult.ai, pipelineVerdict }, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## 11–13. AI consensus & distributions");
  lines.push(`- BUY: ${aiBuy} | SELL: ${aiSell} | NO_TRADE: ${aiNoTrade} | ERROR: ${aiError}`);
  lines.push("```json");
  lines.push(JSON.stringify({ confidenceDist, riskDist, confidenceDistBuy, confidenceDistNoTrade }, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## 14–17. Funnel & Rejections");
  lines.push(`- NO_ELIGIBLE rounds: **${noEligibleRounds.length}**`);
  lines.push(`- Dominant gate: **${dominantGates[0]?.gate ?? "N/A"}** (${dominantGates[0]?.count ?? 0})`);
  for (const g of dominantGates) lines.push(`  - \`${g.gate}\`: ${g.count} (${g.pctSelected}%)`);
  lines.push("");
  lines.push("## 18. Zero-trade analysis");
  if (closedTrades.length === 0) {
    lines.push(`Selected=${selectedRounds.length}, AI BUY=${aiBuy}, orders=${orders.length}`);
    lines.push(`Entry pass=${entryQualityPass}, reject=${entryQualityReject}`);
    lines.push(`Dominant: \`${dominantGates[0]?.gate ?? "N/A"}\``);
  } else {
    lines.push(`${closedTrades.length} closed trades — see trade-forensic.json`);
  }
  lines.push("");
  lines.push("## 28–29. Accounting & Isolation");
  lines.push(`- reconciled: **${reconciled}**`);
  lines.push(`- isolation: **${isolationPass ? "PASS" : "FAIL"}** (foreign orders=${foreignOrders}, trades=${foreignTrades})`);
  lines.push("");
  lines.push("## 30–31. Runtime / Rate-limit health");
  lines.push("```json");
  lines.push(JSON.stringify(health, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## 33–36. Profitability & Conversion");
  lines.push("```json");
  lines.push(JSON.stringify({ performance: machineResult.performance, conversion }, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## 38–39. Verdict & Next phase");
  lines.push(`**READY_FOR_8H_PAPER=${readyFor8hPaper}**`);
  if (readyFor8hPaper) lines.push("- Proceed to 8h paper with same baseline thresholds.");
  else if (closedTrades.length === 0) lines.push("- Zero trades: analyze dominant gate funnel; technical health may still pass.");
  lines.push("");
  lines.push("## Account snapshot (before)");
  lines.push("```json");
  lines.push(JSON.stringify(accountBefore ?? { paperCashBefore }, null, 2));
  lines.push("```");

  fs.writeFileSync(REPORT_FILE, lines.join("\n"), "utf8");
  await prisma.$disconnect();
  return { reportFile: REPORT_FILE, resultFile: RESULT_FILE, machineResult };
}

if (require.main === module) {
  build4hExtendedPaperBaselineReport()
    .then((out) => console.log(JSON.stringify(out.machineResult, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
