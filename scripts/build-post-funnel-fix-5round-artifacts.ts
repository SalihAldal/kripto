import fs from "node:fs";
import path from "node:path";

type AnyRecord = Record<string, unknown>;

const ROOT = process.cwd();
const STRESS_JSON = path.join(ROOT, "kripto-5round-stress-validation-final.json");
const VALIDATION_JSON = path.join(ROOT, "kripto-5round-paper-validation.json");

const OUT = {
  md: path.join(ROOT, "KRIPTO_P2_POST_FUNNEL_FIX_5ROUND_REPORT.md"),
  json: path.join(ROOT, "kripto-p2-post-funnel-fix-5round.json"),
  tradesCsv: path.join(ROOT, "kripto-p2-post-funnel-fix-trades.csv"),
  pnlCsv: path.join(ROOT, "kripto-p2-post-funnel-fix-pnl.csv"),
  exitCsv: path.join(ROOT, "kripto-p2-post-funnel-fix-exit-analysis.csv"),
  runtimeJson: path.join(ROOT, "kripto-p2-post-funnel-fix-runtime.json"),
};

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function writeJson(p: string, payload: unknown) {
  fs.writeFileSync(p, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function csvEscape(v: unknown) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) return `"${s.replace(/"/g, "\"\"")}"`;
  return s;
}

function writeCsv(p: string, rows: AnyRecord[]) {
  if (rows.length === 0) {
    fs.writeFileSync(p, "no_data\n", "utf8");
    return;
  }
  const headers = Array.from(rows.reduce((acc, row) => {
    Object.keys(row).forEach((k) => acc.add(k));
    return acc;
  }, new Set<string>()));
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  fs.writeFileSync(p, `${lines.join("\n")}\n`, "utf8");
}

function n(v: unknown, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function s(v: unknown, fallback = "") {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function classifyEntryDelayMs(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "UNKNOWN";
  if (ms <= 10_000) return "GOOD_ENTRY";
  if (ms <= 30_000) return "NORMAL";
  if (ms <= 90_000) return "CHASING";
  return "EDGE_DECAY";
}

function findFirstBlockingStage(round: AnyRecord): string {
  const tdi = (round.tdi as AnyRecord | undefined) ?? {};
  const execution = (round.execution as AnyRecord | undefined) ?? {};
  const ai = (round.ai as AnyRecord | undefined) ?? {};
  if (n(tdi.tdiApprovals, 0) === 0) return "TDI";
  if (n(ai.aiInvokedCount, 0) === 0) return "AI_CALL";
  if (n(execution.executionReadyCount, 0) === 0) return "EXECUTION_READY";
  if (n(execution.ordersCreatedCount, 0) === 0) return "ORDER";
  if (n(execution.fillsCount, 0) === 0) return "FILL";
  return "CLOSE";
}

function main() {
  const stress = readJson<AnyRecord>(STRESS_JSON);
  const fallback = readJson<AnyRecord>(VALIDATION_JSON);
  const source = stress ?? fallback;
  if (!source) throw new Error("No validation JSON found.");

  const sessionId = s(source.sessionId);
  const rounds = Array.isArray(source.rounds) ? (source.rounds as AnyRecord[]) : [];
  const roundRows = rounds.map((round) => {
    const root = s(round.artifactRoot);
    const summary = root ? readJson<AnyRecord>(path.join(root, "round-summary.json")) : null;
    const scannerSummary = root ? readJson<AnyRecord>(path.join(root, "scanner-summary.json")) : null;
    const tdi = (round.tdi as AnyRecord | undefined) ?? {};
    const ai = (round.ai as AnyRecord | undefined) ?? {};
    const execution = (round.execution as AnyRecord | undefined) ?? {};
    const state = s(round.state);
    const terminal = Boolean(round.terminal ?? ["tur_tamamlandi", "tur_basarisiz", "sure_doldu"].includes(state));
    return {
      roundId: s(round.roundId),
      roundNumber: n(round.roundNo, 0),
      symbol: s(round.symbol),
      startedAt: s(summary?.startedAt ?? round.startedAt),
      endedAt: s(summary?.endedAt ?? round.endedAt),
      durationMs: n(round.durationMs, n(summary?.durationMs, 0)),
      terminalState: state || s(summary?.terminalState),
      failReason: s(round.failReason ?? summary?.failReason),
      scannerCandidates: n(round.candidateCount, n(summary?.candidateCount, 0)),
      priorityCandidates: n(scannerSummary?.priorityCandidates, 0),
      pumpCandidates: n(scannerSummary?.pumpCandidates, 0),
      fallbackCount: n(scannerSummary?.fallbackCount, 0),
      tdiApproved: n(tdi.tdiApprovals, 0),
      tdiWait: n(tdi.tdiWait, 0),
      tdiRejected: n(tdi.tdiRejects, 0),
      firstBlockingCondition: (() => {
        const dist = (tdi.waitReasonDistribution as AnyRecord | undefined) ?? {};
        const [k] = Object.entries(dist).sort((a, b) => Number(b[1]) - Number(a[1]))[0] ?? [];
        return k ? String(k) : "UNKNOWN";
      })(),
      aiCalls: n(ai.aiInvokedCount, 0),
      aiRemoteCalls: n(ai.remoteCount, 0),
      aiDegradedCalls: n(ai.degradedCount, 0),
      aiTimeouts: n(((round.runtime as AnyRecord | undefined) ?? {}).txTimeouts, 0),
      executionReady: n(execution.executionReadyCount, 0),
      orders: n(execution.ordersCreatedCount, 0),
      fills: n(execution.fillsCount, 0),
      openedTrades: n(((round.positions as AnyRecord | undefined) ?? {}).positionsOpened, 0),
      closedTrades: n(((round.positions as AnyRecord | undefined) ?? {}).positionsClosed, 0),
      terminal,
    };
  });

  const allTrades: AnyRecord[] = [];
  for (const round of rounds) {
    const root = s(round.artifactRoot);
    if (!root) continue;
    const pnl = readJson<{ entries?: AnyRecord[] }>(path.join(root, "pnl-ledger.json"));
    const decision = readJson<{ decisions?: AnyRecord[] }>(path.join(root, "decision-trace.json"));
    const decisionRows = decision?.decisions ?? [];
    for (const row of pnl?.entries ?? []) {
      const tradeId = s(row.tradeId, s(row.positionId, ""));
      const candidateId = s(row.candidateId);
      const decisionRow =
        decisionRows.find((d) => s(d.candidateId) === candidateId) ??
        decisionRows.find((d) => s(d.symbol).toUpperCase() === s(row.symbol).toUpperCase());
      const candidateTs = s(row.candidateTimestamp ?? decisionRow?.candidateTimestamp ?? decisionRow?.timestamp);
      const decisionTs = s(row.decisionTimestamp ?? decisionRow?.decisionTimestamp ?? decisionRow?.timestamp);
      const entryTs = s(row.entryTimestamp ?? row.openedAt ?? row.buyAt);
      const exitTs = s(row.exitTimestamp ?? row.closedAt ?? row.sellAt);
      const entryDelay = candidateTs && entryTs ? Math.max(0, Date.parse(entryTs) - Date.parse(candidateTs)) : NaN;
      const gross = n(row.grossPnL, 0);
      const entryFee = n(row.entryFee ?? row.buyFee ?? row.feeBuy, 0);
      const exitFee = n(row.exitFee ?? row.sellFee ?? row.feeSell, 0);
      const totalFee = n(row.totalFee, entryFee + exitFee);
      const net = n(row.netPnL, gross - totalFee);
      allTrades.push({
        tradeId,
        positionId: s(row.positionId),
        symbol: s(row.symbol),
        side: s(row.side, "BUY"),
        strategy: s(row.strategy),
        regime: s(row.regime),
        candidateTimestamp: candidateTs,
        decisionTimestamp: decisionTs,
        entryTimestamp: entryTs,
        entryPrice: n(row.entryPrice ?? row.buyPrice),
        quantity: n(row.quantity),
        notional: n(row.notional, n(row.entryPrice ?? row.buyPrice) * n(row.quantity)),
        exitTimestamp: exitTs,
        exitPrice: n(row.exitPrice ?? row.sellPrice),
        exitReason: s(row.exitReason),
        exitModel: s((row.exitForensics as AnyRecord | undefined)?.exitModel ?? row.exitModel),
        actualVariantDExitReason: s(row.actualVariantDExitReason ?? (row.metadata as AnyRecord | undefined)?.actualVariantDExitReason),
        actualVariantDExitModel: s((row.metadata as AnyRecord | undefined)?.actualVariantDExitModel ?? (row.metadata as AnyRecord | undefined)?.actualVariantDExitReason),
        holdDuration: n(row.holdSec ?? row.holdDurationSec),
        entryDelayMs: Number.isFinite(entryDelay) ? entryDelay : null,
        entryQuality: Number.isFinite(entryDelay) ? classifyEntryDelayMs(entryDelay) : "UNKNOWN",
        grossPnL: gross,
        entryFee,
        exitFee,
        totalFee,
        netPnL: net,
        expectedGrossEdge: n(row.expectedGrossEdge),
        expectedNetEdge: n(row.expectedNetEdge),
        estimatedRoundTripFee: n(row.estimatedRoundTripFee),
        actualTotalFee: totalFee,
        feeToGrossRatio: Math.abs(gross) > 1e-9 ? Number((Math.abs(totalFee / gross)).toFixed(6)) : 0,
        feeClassification: Math.abs(gross) > 1e-9 ? (Math.abs(totalFee / gross) >= 1 ? "FEE_DOMINANT" : Math.abs(totalFee / gross) >= 0.5 ? "FEE_HEAVY" : "FEE_LIGHT") : "UNKNOWN",
        grossPositiveNetNegative: gross > 0 && net < 0 ? "YES" : "NO",
      });
    }
  }

  const totalTrades = allTrades.length;
  const wins = allTrades.filter((t) => n(t.netPnL) > 0).length;
  const losses = allTrades.filter((t) => n(t.netPnL) < 0).length;
  const breakeven = allTrades.filter((t) => n(t.netPnL) === 0).length;
  const grossPnl = Number(allTrades.reduce((a, t) => a + n(t.grossPnL), 0).toFixed(8));
  const fees = Number(allTrades.reduce((a, t) => a + n(t.totalFee), 0).toFixed(8));
  const netPnl = Number(allTrades.reduce((a, t) => a + n(t.netPnL), 0).toFixed(8));
  const expectancy = totalTrades > 0 ? Number((netPnl / totalTrades).toFixed(8)) : null;
  const grossWins = allTrades.filter((t) => n(t.netPnL) > 0).reduce((a, t) => a + n(t.netPnL), 0);
  const grossLossAbs = Math.abs(allTrades.filter((t) => n(t.netPnL) < 0).reduce((a, t) => a + n(t.netPnL), 0));
  const profitFactor = grossLossAbs > 0 ? Number((grossWins / grossLossAbs).toFixed(8)) : null;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const t of allTrades) {
    equity += n(t.netPnL);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity - peak);
  }
  const maxDrawdownAbs = Number(maxDrawdown.toFixed(8));
  const maxDrawdownPct = peak > 0 ? Number(((Math.abs(maxDrawdownAbs) / peak) * 100).toFixed(4)) : 0;

  const timeoutCount = allTrades.filter((t) => s(t.exitReason).includes("TIMEOUT") || s(t.actualVariantDExitReason).includes("TIMEOUT")).length;
  const strategyExitCount = allTrades.filter((t) => s(t.exitReason).includes("STRATEGY")).length;
  const stopLossCount = allTrades.filter((t) => s(t.exitReason).includes("STOP_LOSS")).length;
  const takeProfitCount = allTrades.filter((t) => s(t.exitReason).includes("TAKE_PROFIT")).length;
  const executionReadyTotal = roundRows.reduce((a, r) => a + n(r.executionReady), 0);
  const tdiApprovedTotal = roundRows.reduce((a, r) => a + n(r.tdiApproved), 0);
  const closedTrades = roundRows.reduce((a, r) => a + n(r.closedTrades), 0);
  const firstZeroRound = roundRows.find((r) => n(r.openedTrades) === 0);
  const firstBlockingStage = firstZeroRound ? findFirstBlockingStage(firstZeroRound) : "N/A";

  const aiParity = rounds.some((r) => {
    const p0 = (r.p0 as AnyRecord | undefined) ?? {};
    const fails = Array.isArray(p0.aiGateFailures) ? (p0.aiGateFailures as AnyRecord[]) : [];
    return fails.length > 0;
  })
    ? "FAIL"
    : "PASS";
  const runtimeStable =
    (source.job as AnyRecord | undefined)?.status === "COMPLETED" &&
    roundRows.length === 5 &&
    !roundRows.some((r) => !Boolean(r.terminal))
      ? "YES"
      : "NO";
  const pnlReconciliation = allTrades.every((t) => Math.abs(n(t.netPnL) - (n(t.grossPnL) - n(t.totalFee))) <= 0.0001)
    ? "PASS"
    : "FAIL";

  const final = {
    generatedAt: new Date().toISOString(),
    sourceSessionId: sessionId,
    validationId: s(source.validationId),
    preflight: source.preflight ?? null,
    rounds: roundRows,
    trades: allTrades,
    campaign: {
      totalTrades,
      wins,
      losses,
      breakeven,
      grossPnL: grossPnl,
      fees,
      netPnL: netPnl,
      winRate: totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(4)) : 0,
      expectancy,
      profitFactor,
      maxDrawdown: maxDrawdownAbs,
      maxDrawdownPct,
      averageWin: wins > 0 ? Number((grossWins / wins).toFixed(8)) : 0,
      averageLoss: losses > 0 ? Number(((-grossLossAbs) / losses).toFixed(8)) : 0,
      averageHold: totalTrades > 0 ? Number((allTrades.reduce((a, t) => a + n(t.holdDuration), 0) / totalTrades).toFixed(2)) : 0,
      medianHold: (() => {
        const v = allTrades.map((t) => n(t.holdDuration)).sort((a, b) => a - b);
        if (v.length === 0) return 0;
        return v[Math.floor((v.length - 1) / 2)];
      })(),
      systemTimeoutCount: timeoutCount,
      strategyExitCount,
      stopLossCount,
      takeProfitCount,
    },
    verdict: {
      FIVE_ROUNDS_COMPLETED: roundRows.length === 5 && runtimeStable === "YES" ? "YES" : roundRows.length > 0 ? "PARTIAL" : "NO",
      TDI_APPROVED_TOTAL: tdiApprovedTotal,
      EXECUTION_READY_TOTAL: executionReadyTotal,
      LIVE_TRADES: totalTrades,
      CLOSED_TRADES: closedTrades,
      SYSTEM_TIMEOUT_COUNT: timeoutCount,
      GROSS_PNL: grossPnl,
      FEES: fees,
      NET_PNL: netPnl,
      EXPECTANCY: expectancy ?? "N/A",
      PROFIT_FACTOR: profitFactor ?? "N/A",
      MAX_DRAWDOWN: maxDrawdownAbs,
      AI_PARITY: aiParity,
      RUNTIME_STABLE: runtimeStable,
      PNL_RECONCILIATION: pnlReconciliation,
      TRADE_GENERATION: totalTrades > 0 ? "PROVEN" : "NOT_PROVEN",
      PROFITABILITY_SIGNAL:
        totalTrades === 0 ? "NOT_PROVEN" : netPnl > 0 ? "POSITIVE" : netPnl < 0 ? "NEGATIVE" : "MIXED",
      FIRST_BLOCKING_STAGE: firstBlockingStage,
      NEXT_STEP:
        roundRows.length < 5
          ? "AI_STARTED_ORPHAN ve stopRequested root-cause fixi tamamlanmadan yeni 5-round denemesi yapılmamalı."
          : totalTrades === 0
            ? "Trade generation not proven; first blocking stage odaklı düzeltme sonrası yeni bounded window çalıştır."
            : "Trade lifecycle doğrulandı; daha uzun pencere ile (30/50 round) yalnızca ayrı onayla devam et.",
      PRODUCTION_DEFAULT: "BASELINE",
    },
  };

  writeJson(OUT.json, final);
  writeJson(OUT.runtimeJson, {
    generatedAt: final.generatedAt,
    sessionId,
    preflight: final.preflight,
    rounds: roundRows.map((r) => ({
      roundId: r.roundId,
      roundNumber: r.roundNumber,
      terminalState: r.terminalState,
      failReason: r.failReason,
      durationMs: r.durationMs,
      aiCalls: r.aiCalls,
      aiTimeouts: r.aiTimeouts,
      executionReady: r.executionReady,
    })),
    criticalFailures: source.criticalFailures ?? [],
    stopValidationReason: source.stopValidationReason ?? null,
  });

  writeCsv(
    OUT.tradesCsv,
    allTrades.map((t) => ({
      tradeId: t.tradeId,
      positionId: t.positionId,
      symbol: t.symbol,
      side: t.side,
      strategy: t.strategy,
      regime: t.regime,
      entryTimestamp: t.entryTimestamp,
      entryPrice: t.entryPrice,
      quantity: t.quantity,
      notional: t.notional,
      exitTimestamp: t.exitTimestamp,
      exitPrice: t.exitPrice,
      exitReason: t.exitReason,
      exitModel: t.exitModel,
      holdDuration: t.holdDuration,
      actualVariantDExitReason: t.actualVariantDExitReason,
      actualVariantDExitModel: t.actualVariantDExitModel,
      entryQuality: t.entryQuality,
    })),
  );
  writeCsv(
    OUT.pnlCsv,
    allTrades.map((t) => ({
      tradeId: t.tradeId,
      symbol: t.symbol,
      grossPnL: t.grossPnL,
      entryFee: t.entryFee,
      exitFee: t.exitFee,
      totalFee: t.totalFee,
      netPnL: t.netPnL,
      reconciliation: Math.abs(n(t.netPnL) - (n(t.grossPnL) - n(t.totalFee))) <= 0.0001 ? "PASS" : "FAIL",
      resultClass: n(t.netPnL) > 0 ? "WIN" : n(t.netPnL) < 0 ? "LOSS" : "BREAKEVEN",
      expectedGrossEdge: t.expectedGrossEdge,
      expectedNetEdge: t.expectedNetEdge,
      estimatedRoundTripFee: t.estimatedRoundTripFee,
      actualTotalFee: t.actualTotalFee,
      feeToGrossRatio: t.feeToGrossRatio,
      feeClassification: t.feeClassification,
      grossPositiveNetNegative: t.grossPositiveNetNegative,
    })),
  );
  writeCsv(
    OUT.exitCsv,
    allTrades.map((t) => ({
      tradeId: t.tradeId,
      symbol: t.symbol,
      exitReason: t.exitReason,
      exitModel: t.exitModel,
      actualVariantDExitReason: t.actualVariantDExitReason,
      actualVariantDExitModel: t.actualVariantDExitModel,
      holdDuration: t.holdDuration,
    })),
  );

  const v = final.verdict;
  const md = [
    "# KRIPTO P2 — POST ENTRY-FUNNEL FIX FINAL 5-ROUND PAPER VALIDATION",
    "",
    `Session: \`${sessionId}\``,
    `Validation: \`${s(source.validationId)}\``,
    "",
    `FIVE_ROUNDS_COMPLETED = ${v.FIVE_ROUNDS_COMPLETED}`,
    `TDI_APPROVED_TOTAL = ${v.TDI_APPROVED_TOTAL}`,
    `EXECUTION_READY_TOTAL = ${v.EXECUTION_READY_TOTAL}`,
    `LIVE_TRADES = ${v.LIVE_TRADES}`,
    `CLOSED_TRADES = ${v.CLOSED_TRADES}`,
    `SYSTEM_TIMEOUT_COUNT = ${v.SYSTEM_TIMEOUT_COUNT}`,
    `GROSS_PNL = ${v.GROSS_PNL}`,
    `FEES = ${v.FEES}`,
    `NET_PNL = ${v.NET_PNL}`,
    `EXPECTANCY = ${v.EXPECTANCY}`,
    `PROFIT_FACTOR = ${v.PROFIT_FACTOR}`,
    `MAX_DRAWDOWN = ${v.MAX_DRAWDOWN}`,
    `AI_PARITY = ${v.AI_PARITY}`,
    `RUNTIME_STABLE = ${v.RUNTIME_STABLE}`,
    `PNL_RECONCILIATION = ${v.PNL_RECONCILIATION}`,
    `TRADE_GENERATION = ${v.TRADE_GENERATION}`,
    `PROFITABILITY_SIGNAL = ${v.PROFITABILITY_SIGNAL}`,
    `FIRST_BLOCKING_STAGE = ${v.FIRST_BLOCKING_STAGE}`,
    `NEXT_STEP = ${v.NEXT_STEP}`,
    `PRODUCTION_DEFAULT = BASELINE`,
    "",
    "## Round Telemetry",
    ...roundRows.map((r) =>
      `- R${r.roundNumber} ${r.symbol}: state=${r.terminalState}, durationMs=${r.durationMs}, scanner=${r.scannerCandidates}, TDI=${r.tdiApproved}/${r.tdiWait}/${r.tdiRejected}, AI=${r.aiCalls}, execReady=${r.executionReady}, orders=${r.orders}, fills=${r.fills}, closed=${r.closedTrades}, failReason=${r.failReason || "N/A"}`,
    ),
  ].join("\n");
  fs.writeFileSync(OUT.md, `${md}\n`, "utf8");
}

main();
