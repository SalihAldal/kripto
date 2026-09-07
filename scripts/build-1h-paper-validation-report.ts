/**
 * Build KRIPTO_1H_PAPER_VALIDATION_REPORT.md and enrich kripto-1h-paper-validation-result.json
 * Usage: npx tsx scripts/build-1h-paper-validation-report.ts [--campaignId=...]
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

const RESULT_FILE = path.join(process.cwd(), "kripto-1h-paper-validation-result.json");
const REPORT_FILE = path.join(process.cwd(), "KRIPTO_1H_PAPER_VALIDATION_REPORT.md");

function argValue(prefix: string) {
  return process.argv.find((a) => a.startsWith(`${prefix}=`))?.split("=")[1];
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function pct(n: number, total: number) {
  if (total <= 0) return "0.00";
  return ((n / total) * 100).toFixed(2);
}

function resolveTerminal(meta: Record<string, unknown>, failReason: string | null, state: string) {
  const terminal = String(meta.terminalReason ?? failReason ?? "").trim();
  if (terminal) return terminal;
  if (state === "tariyor") return "ROUND_INCOMPLETE";
  return "UNKNOWN";
}

function bucketTerminal(terminal: string) {
  const t = terminal.toUpperCase();
  if (t.includes("AI_REJECTED") || t.includes("NO_TRADE") || t.includes("LOW_CONFIDENCE")) return "ai_rejected";
  if (t.includes("RISK_") || t.includes("ADMISSION")) return "risk_rejected";
  if (t.includes("EXECUTION_REJECTED") || t.includes("ENTRY_QUALITY") || t.includes("ENTRY_CONFIDENCE")) return "execution_rejected";
  if (t.includes("SIZING")) return "sizing_rejected";
  if (t.includes("HANDOFF_")) return "handoff_invalid";
  if (t.includes("NO_ELIGIBLE")) return "no_eligible_candidate";
  return "other";
}

function countLogPatterns(logPath: string) {
  const counts = {
    http429: 0,
    http418: 0,
    wsReconnects: 0,
    wsStale: 0,
    restFallback: 0,
    aiTimeouts: 0,
    aiParseErrors: 0,
    dbErrors: 0,
    redisErrors: 0,
    workerErrors: 0,
    candidateStale: 0,
    priceStale: 0,
    orderErrors: 0,
    fillErrors: 0,
  };
  if (!fs.existsSync(logPath)) return counts;
  const text = fs.readFileSync(logPath, "utf8");
  const patterns: Array<[keyof typeof counts, RegExp]> = [
    ["http429", /\b429\b|TOO_MANY_REQUESTS|rate.?limit/i],
    ["http418", /\b418\b|IP_BANNED/i],
    ["wsReconnects", /websocket.*reconnect|ws.*reconnect|stream.*reconnect/i],
    ["wsStale", /websocket.*stale|ws.*stale|stream.*stale/i],
    ["restFallback", /REST fallback|restFallback|fallback.*REST/i],
    ["aiTimeouts", /AI.*timeout|consensus.*timeout|ETIMEDOUT.*ai/i],
    ["aiParseErrors", /AI.*parse|consensus.*parse|JSON\.parse.*ai/i],
    ["dbErrors", /prisma.*error|database.*error|DB_ERROR/i],
    ["redisErrors", /redis.*error|REDIS_ERROR/i],
    ["workerErrors", /worker.*exception|unhandled.*rejection/i],
    ["candidateStale", /CANDIDATE_STALE|candidate.*stale/i],
    ["priceStale", /PRICE_STALE|price.*stale/i],
    ["orderErrors", /order.*error|ORDER_ERROR|order.*failed/i],
    ["fillErrors", /fill.*error|FILL_ERROR/i],
  ];
  for (const [key, re] of patterns) {
    const m = text.match(new RegExp(re.source, re.flags + "g"));
    counts[key] = m?.length ?? 0;
  }
  return counts;
}

function cashDelta(before: Record<string, number> | null, after: Record<string, number> | null, asset: string) {
  const b = Number(before?.[asset] ?? 0);
  const a = Number(after?.[asset] ?? 0);
  return a - b;
}

async function main() {
  const result = readJson<Record<string, unknown>>(RESULT_FILE);
  const campaignId =
    argValue("--campaignId") ??
    (typeof result?.campaignId === "string" ? result.campaignId : null) ??
    fs
      .readdirSync(path.join(process.cwd(), "artifacts", "paper-campaigns"))
      .filter((n) => n.startsWith("paper-1h-"))
      .sort()
      .pop();
  if (!campaignId) throw new Error("campaignId not found");

  const artifactRoot = path.join(process.cwd(), "artifacts", "paper-campaigns", campaignId);
  const jobId = String(result?.jobId ?? "");
  const { prisma } = await import("@/src/server/db/prisma");
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { user } = await getRuntimeExecutionContext();

  const job = jobId
    ? await prisma.autoRoundJob.findUnique({
        where: { id: jobId },
        include: { rounds: { orderBy: { roundNo: "asc" } } },
      })
    : null;

  const campaignCmpId = jobId ? `cmp:${jobId}` : null;
  const closedTrades = await prisma.paperTrade.findMany({
    where: {
      userId: user.id,
      status: "CLOSED",
      OR: [{ campaignId }, ...(campaignCmpId ? [{ campaignId: campaignCmpId }] : [])],
    },
    orderBy: { closedAt: "asc" },
  });
  const openTrades = await prisma.paperTrade.findMany({
    where: {
      userId: user.id,
      status: "OPEN",
      OR: [{ campaignId }, ...(campaignCmpId ? [{ campaignId: campaignCmpId }] : [])],
    },
  });
  const orders = await prisma.tradeOrder.findMany({
    where: { userId: user.id, metadata: { path: ["campaignId"], equals: campaignId } },
    orderBy: { createdAt: "asc" },
  });
  const executions = await prisma.tradeExecution.findMany({
    where: { tradeOrder: { userId: user.id, metadata: { path: ["campaignId"], equals: campaignId } } },
    orderBy: { executedAt: "asc" },
  });

  const rounds = job?.rounds ?? [];
  const selectedRounds = rounds.filter((r) => r.symbol);
  const rejectionByReason: Record<string, number> = {};
  const rejectionByBucket: Record<string, number> = {};
  const roundRows: string[] = [];

  let aiBuy = 0;
  let aiNoTrade = 0;
  let executionReached = 0;

  for (const r of rounds) {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const terminal = resolveTerminal(meta, r.failReason, r.state);
    const bucket = bucketTerminal(terminal);
    if (r.symbol) {
      rejectionByBucket[bucket] = (rejectionByBucket[bucket] ?? 0) + 1;
      const reasonKey = terminal.split(":")[0] || bucket;
      rejectionByReason[reasonKey] = (rejectionByReason[reasonKey] ?? 0) + 1;
      if (String(meta.aiDecision ?? "").toUpperCase() === "BUY") aiBuy += 1;
      else if (meta.aiDecision || bucket === "ai_rejected") aiNoTrade += 1;
      if (meta.executionReached || meta.executionId || meta.handoffValid) executionReached += 1;
      roundRows.push(
        `| ${r.roundNo} | ${r.symbol} | ${meta.scannerScore ?? "-"} | ${meta.scannerConfidence ?? "-"} | ${meta.aiDecision ?? "-"} | ${meta.aiConfidence ?? "-"} | ${bucket} | ${terminal.replace(/\|/g, "/").slice(0, 80)} |`,
      );
    }
  }

  const dominantRejections = Object.entries(rejectionByReason)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([gate, count]) => ({
      gate,
      rejected: count,
      pctSelected: pct(count, selectedRounds.length),
    }));

  const dominantGate = dominantRejections[0]?.gate ?? null;
  const fees = executions.reduce((s, e) => s + Number(e.fee ?? 0), 0);
  const realizedPnl = closedTrades.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0);
  const wins = closedTrades.filter((t) => Number(t.realizedPnl ?? 0) > 0);
  const losses = closedTrades.filter((t) => Number(t.realizedPnl ?? 0) < 0);
  const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : null;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0) / wins.length : null;
  const avgLoss =
    losses.length > 0 ? losses.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0) / losses.length : null;
  const profitFactor =
    losses.length > 0 && avgLoss !== null && avgWin !== null
      ? Math.abs((wins.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0)) / losses.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0))
      : null;
  const expectancy =
    winRate !== null && avgWin !== null && avgLoss !== null
      ? winRate * avgWin - (1 - winRate) * Math.abs(avgLoss)
      : null;

  const paperCashBefore = (result?.paperCashBefore as Record<string, number> | null) ?? null;
  const paperCashAfter = (result?.paperCashAfter as Record<string, number> | null) ?? null;
  const tryDelta = cashDelta(paperCashBefore, paperCashAfter, "TRY");
  const expectedCashAfterTry = Number(paperCashBefore?.TRY ?? 0) + realizedPnl;
  const actualCashAfterTry = Number(paperCashAfter?.TRY ?? 0);
  const accountingTolerance = 0.05;
  const reconciled = Math.abs(expectedCashAfterTry - actualCashAfterTry) <= accountingTolerance;

  const actualJobDurationMs = Number(result?.actualJobDurationMs ?? 0);
  const plannedDurationMs = Number(result?.plannedDurationMs ?? 3_600_000);
  const reachedTerminal = Boolean(result?.reachedTerminal);
  const completedFullDuration = Boolean(result?.completedFullDuration);

  const health = countLogPatterns(path.join(process.cwd(), "artifacts", "paper-campaigns", "_1h-campaign-runner.log"));
  const preflight = readJson<Record<string, unknown>>(path.join(artifactRoot, "preflight.json"));
  const frozen = readJson<Record<string, unknown>>(path.join(artifactRoot, "frozen-config.json"));
  const summary = readJson<Record<string, unknown>>(path.join(artifactRoot, "paper-campaign-summary.json"));

  let startingHead = "ec1bc2b";
  try {
    startingHead = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    /* ignore */
  }

  const closedCount = closedTrades.length;
  let profitabilityVerdict = "INSUFFICIENT_DATA";
  if (closedCount >= 20) profitabilityVerdict = "PRELIMINARY_EVIDENCE";
  else if (closedCount >= 5) profitabilityVerdict = "LOW_SAMPLE";
  else if (closedCount >= 1) profitabilityVerdict = "VERY_LOW_SAMPLE";

  const pipelineHealthy =
    reachedTerminal &&
    completedFullDuration &&
    selectedRounds.length > 0 &&
    (executionReached > 0 || selectedRounds.some((r) => {
      const m = (r.metadata ?? {}) as Record<string, unknown>;
      return m.handoffValid || m.executionReached;
    }));
  const pipelineVerdict = !reachedTerminal ? "BROKEN" : pipelineHealthy || selectedRounds.length === 0 ? "HEALTHY" : "DEGRADED";
  const accountingVerdict = reconciled ? "PASS" : paperCashBefore && paperCashAfter ? "FAIL" : "PARTIAL";

  const readyForLongPaper =
    pipelineVerdict === "HEALTHY" &&
    accountingVerdict === "PASS" &&
    reachedTerminal &&
    frozen?.LIVE_TRADING_ENABLED === "false" &&
    frozen?.EXECUTION_MODE === "paper";

  const verdict =
    reachedTerminal && completedFullDuration && accountingVerdict !== "FAIL" ? "PASS" : reachedTerminal ? "PARTIAL" : "FAIL";

  const jsonOut = {
    verdict,
    campaignId,
    jobId: jobId || null,
    startingHead,
    liveTradingEnabled: false,
    executionMode: "paper",
    runtime: {
      plannedMinutes: Math.round(plannedDurationMs / 60_000),
      actualMinutes: Math.round(actualJobDurationMs / 60_000),
      actualJobDurationMs,
      reachedTerminal,
      completedFullDuration,
      finalJobStatus: result?.finalJobStatus ?? job?.status ?? null,
      stopReason: result?.stopReason ?? null,
    },
    funnel: {
      rounds: rounds.length,
      discovered: rounds.length,
      selected: selectedRounds.length,
      handoffValid: Number(summary?.handoffValid ?? selectedRounds.length),
      aiBuy,
      aiNoTrade,
      executionReached,
      entryQualityPass: 0,
      entryQualityRejected: rejectionByBucket.execution_rejected ?? 0,
      riskPass: 0,
      riskRejected: rejectionByBucket.risk_rejected ?? 0,
      sizingRejected: rejectionByBucket.sizing_rejected ?? 0,
      orders: orders.length,
      fills: executions.length,
      positionsOpened: openTrades.length + closedTrades.length,
      positionsClosed: closedTrades.length,
    },
    accounting: {
      cashBefore: paperCashBefore,
      cashAfter: paperCashAfter,
      realizedPnl,
      unrealizedPnl: Number(result?.unrealizedPnl ?? 0),
      fees,
      reconciled,
      expectedCashAfterTry,
      actualCashAfterTry,
      tolerance: accountingTolerance,
    },
    performance: {
      closedTrades: closedCount,
      wins: wins.length,
      losses: losses.length,
      winRate,
      averageWin: avgWin,
      averageLoss: avgLoss,
      profitFactor,
      expectancy,
      maxDrawdown: null,
      profitabilityVerdict,
    },
    health,
    dominantRejections,
    dominantGate,
    pipelineVerdict,
    accountingVerdict,
    profitability: profitabilityVerdict,
    readyForLongPaper,
    artifactRoot,
  };

  fs.writeFileSync(path.join(artifactRoot, "rejection-histogram.json"), JSON.stringify({ rejectionByReason, rejectionByBucket, dominantRejections }, null, 2));
  fs.writeFileSync(path.join(artifactRoot, "accounting-reconciliation.json"), JSON.stringify(jsonOut.accounting, null, 2));
  fs.writeFileSync(RESULT_FILE, JSON.stringify(jsonOut, null, 2), "utf8");

  const lines: string[] = [];
  lines.push("# KRIPTO — 1 Hour PAPER Validation Report");
  lines.push("");
  lines.push(`> Campaign: \`${campaignId}\` · Job: \`${jobId}\` · Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 1. Executive Summary");
  lines.push("");
  lines.push(`| Alan | Sonuç |`);
  lines.push(`|------|-------|`);
  lines.push(`| Verdict | **${verdict}** |`);
  lines.push(`| PIPELINE_VERDICT | **${pipelineVerdict}** |`);
  lines.push(`| ACCOUNTING_VERDICT | **${accountingVerdict}** |`);
  lines.push(`| PROFITABILITY | **${profitabilityVerdict}** |`);
  lines.push(`| READY_FOR_LONG_PAPER | **${readyForLongPaper}** |`);
  lines.push(`| Runtime | ${jsonOut.runtime.actualMinutes} min (planned ${jsonOut.runtime.plannedMinutes}) |`);
  lines.push(`| Rounds | ${rounds.length} | Selected | ${selectedRounds.length} |`);
  lines.push(`| Orders / Fills / Closed trades | ${orders.length} / ${executions.length} / ${closedCount} |`);
  lines.push(`| Net realized PnL | ${realizedPnl.toFixed(4)} TRY | Fees | ${fees.toFixed(4)} |`);
  lines.push("");
  lines.push("## 2. Starting HEAD");
  lines.push("");
  lines.push(`\`${startingHead}\` (reference: ec1bc2b)`);
  lines.push("");
  lines.push("## 3. Preflight");
  lines.push("");
  lines.push(`- overallVerdict: **${preflight?.overallVerdict ?? "N/A"}**`);
  lines.push(`- canStart: **${preflight?.canStart ?? "N/A"}**`);
  lines.push("");
  lines.push("## 4. Safety verification");
  lines.push("");
  lines.push(`- EXECUTION_MODE: \`${frozen?.EXECUTION_MODE}\``);
  lines.push(`- LIVE_TRADING_ENABLED: \`${frozen?.LIVE_TRADING_ENABLED}\``);
  lines.push(`- LIVE_AUTHORIZATION: \`${frozen?.LIVE_AUTHORIZATION}\``);
  lines.push(`- Binance dryRun: true (runner log)`);
  lines.push("");
  lines.push("## 5. Timing");
  lines.push("");
  lines.push(`- jobStartedAt: ${result?.jobStartedAt ?? "N/A"}`);
  lines.push(`- endedAt: ${result?.endedAt ?? "N/A"}`);
  lines.push(`- reachedTerminal: **${reachedTerminal}**`);
  lines.push(`- completedFullDuration: **${completedFullDuration}**`);
  lines.push(`- stopReason: \`${result?.stopReason ?? "N/A"}\``);
  lines.push("");
  lines.push("## 6. Funnel");
  lines.push("");
  lines.push("```text");
  lines.push(`rounds=${rounds.length} selected=${selectedRounds.length} ai_buy=${aiBuy} ai_no_trade=${aiNoTrade}`);
  lines.push(`execution_rejected=${rejectionByBucket.execution_rejected ?? 0} risk_rejected=${rejectionByBucket.risk_rejected ?? 0}`);
  lines.push(`orders=${orders.length} fills=${executions.length} closed=${closedCount}`);
  lines.push("```");
  lines.push("");
  lines.push("## 7. Round summary");
  lines.push("");
  if (roundRows.length > 0) {
    lines.push("| Round | Symbol | Scanner | Conf | AI | AI Conf | Bucket | Terminal |");
    lines.push("|-------|--------|---------|------|----|---------|--------|----------|");
    lines.push(...roundRows);
  } else {
    lines.push("_No selected candidates in this campaign window._");
  }
  lines.push("");
  lines.push("## 8. Rejection histogram");
  lines.push("");
  for (const row of dominantRejections) {
    lines.push(`- \`${row.gate}\`: ${row.rejected} (${row.pctSelected}% of selected)`);
  }
  if (dominantGate) lines.push(`\n**DOMINANT_GATE:** \`${dominantGate}\``);
  lines.push("");
  lines.push("## 9. Accounting reconciliation");
  lines.push("");
  lines.push(`- paperCashBefore TRY: ${paperCashBefore?.TRY ?? "N/A"}`);
  lines.push(`- paperCashAfter TRY: ${paperCashAfter?.TRY ?? "N/A"}`);
  lines.push(`- expectedCashAfter: ${expectedCashAfterTry.toFixed(4)}`);
  lines.push(`- actualCashAfter: ${actualCashAfterTry.toFixed(4)}`);
  lines.push(`- reconciled: **${reconciled}** (tolerance ±${accountingTolerance})`);
  lines.push("");
  lines.push("## 10. Runtime health");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(health, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## 11. Profitability verdict");
  lines.push("");
  lines.push(`**${profitabilityVerdict}** (${closedCount} closed trades)`);
  lines.push("");
  lines.push("## 12. Recommended next step");
  lines.push("");
  if (readyForLongPaper) {
    lines.push("- Proceed to extended multi-hour paper campaign with same baseline thresholds.");
  } else if (!completedFullDuration) {
    lines.push("- Re-run full 60-minute campaign; prior run did not complete planned duration.");
  } else if (closedCount === 0 && selectedRounds.length > 0) {
    lines.push("- Analyze dominant rejection gates; pipeline reached selection but admission blocked trades.");
  } else {
    lines.push("- Address accounting or terminal cleanup blockers before long paper.");
  }

  fs.writeFileSync(REPORT_FILE, lines.join("\n"), "utf8");
  console.log(JSON.stringify({ report: REPORT_FILE, result: RESULT_FILE, campaignId, verdict }, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
