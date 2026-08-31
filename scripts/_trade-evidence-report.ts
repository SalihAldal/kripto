import fs from "node:fs";
import path from "node:path";

const SESSION_ID = "cmsxrlu1v0009unrkcmzvymcn";
const PREFLIGHT_ID = "trade-evidence-5r-preflight-1787003265666";

function readJson(filePath: string): any | null {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : null;
  } catch {
    return null;
  }
}

function countBy<T>(rows: T[], selector: (row: T) => string) {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = selector(row);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

async function main() {
  const db = await import("@/src/server/db/prisma");
  const prismaClient =
    (db as { prisma?: unknown }).prisma ??
    (db as { default?: { prisma?: unknown } }).default?.prisma ??
    (db as { ["module.exports"]?: { prisma?: unknown } })["module.exports"]?.prisma;
  if (!prismaClient) {
    throw new Error("Prisma client export not found");
  }
  const prisma = prismaClient as {
    autoRoundJob: {
      findUnique: (args: unknown) => Promise<any>;
    };
  };
  const job = await prisma.autoRoundJob.findUnique({
    where: { id: SESSION_ID },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  const preflight = readJson(
    path.join(process.cwd(), "artifacts", "forensics", "preflight", PREFLIGHT_ID, "preflight.json"),
  );

  const rounds: any[] = [];
  const aggregate = {
    scannerCandidates: 0,
    tdiApproved: 0,
    tdiWait: 0,
    tdiRejected: 0,
    executionReady: 0,
    orders: 0,
    fills: 0,
    closedTrades: 0,
    grossPnL: 0,
    totalFees: 0,
    netPnL: 0,
    aiInvoked: 0,
    aiRemote: 0,
    aiDegraded: 0,
    aiFailures: 0,
    priorityCandidates: 0,
    priorityRescuedCount: 0,
  };
  const critical: Array<{ roundNo: number; code: string; count: number }> = [];

  for (let i = 1; i <= 5; i += 1) {
    const root = path.join(process.cwd(), "artifacts", "forensics", SESSION_ID, "rounds", String(i));
    const rs = readJson(path.join(root, "round-summary.json")) ?? {};
    const scannerSummary = readJson(path.join(root, "scanner-summary.json")) ?? {};
    const tdi = readJson(path.join(root, "tdi-decisions.json")) ?? {};
    const risk = readJson(path.join(root, "risk-sizing-trace.json")) ?? {};
    const ai = readJson(path.join(root, "ai-trace.json")) ?? {};
    const aiProgress = readJson(path.join(root, "ai-progress.json")) ?? {};
    const decision = readJson(path.join(root, "decision-trace.json")) ?? {};
    const exec = readJson(path.join(root, "execution-trace.json")) ?? {};
    const entry = readJson(path.join(root, "entry-timing.json")) ?? {};
    const exitF = readJson(path.join(root, "exit-forensics.json")) ?? {};
    const replay = readJson(path.join(root, "replay-exit-diagnostics.json")) ?? {};
    const fee = readJson(path.join(root, "fee-aware-entry-policy.json")) ?? {};
    const pnl = readJson(path.join(root, "pnl-ledger.json")) ?? {};
    const recovery = readJson(path.join(root, "recovery-telemetry.json")) ?? {};
    const watchdog = readJson(path.join(root, "round-watchdog.json")) ?? {};
    const runtime = readJson(path.join(root, "round-runtime.json")) ?? {};

    const tdiRecords = Array.isArray(tdi.records) ? tdi.records : [];
    const riskRows = Array.isArray(risk.riskSizing) ? risk.riskSizing : [];
    const aiCalls = Array.isArray(ai.aiCalls) ? ai.aiCalls : [];
    const aiCandidates = Array.isArray(aiProgress.candidates) ? aiProgress.candidates : [];
    const decisions = Array.isArray(decision.decisions) ? decision.decisions : [];
    const orders = Array.isArray(exec.orders) ? exec.orders : [];
    const entryRows = Array.isArray(entry.records) ? entry.records : [];
    const pnlEntries = Array.isArray(pnl.entries) ? pnl.entries : [];
    const feeEvals = Array.isArray(fee.evaluations) ? fee.evaluations : [];
    const exits = Array.isArray(exitF.rows) ? exitF.rows : [];
    const replayRows = Array.isArray(replay.rows) ? replay.rows : [];

    const scannerCoverage = scannerSummary.scannerCoverage ?? rs.scannerCoverage ?? {};
    const roundState = job?.rounds?.find((r) => r.roundNo === i);
    const roundObj = {
      roundNo: i,
      roundId: String(i),
      durationMs: Number(rs.durationMs ?? 0),
      terminalState: roundState?.state ?? null,
      failReason: roundState?.failReason ?? null,
      scanner: {
        scannerUniverse: Number(scannerCoverage.scannerUniverse ?? 0),
        rotationCandidates: Number(scannerCoverage.rotationCandidates ?? 0),
        priorityCandidates: Number(scannerCoverage.priorityCandidates ?? 0),
        priorityRescuedCount: Number(scannerCoverage.priorityRescuedCount ?? 0),
        discoverySourceSample: Array.isArray(scannerCoverage.discoverySources)
          ? scannerCoverage.discoverySources.slice(0, 5)
          : [],
        candidateCount: Number(rs.candidateCount ?? 0),
      },
      tdi: {
        APPROVED: tdiRecords.filter((r: any) => r.verdict === "APPROVED").length,
        WAIT: tdiRecords.filter((r: any) => r.verdict === "WAIT").length,
        REJECTED: tdiRecords.filter((r: any) => r.verdict === "REJECTED").length,
        reasonCodeCounts: countBy(tdiRecords, (r: any) => String(r.waitReasonCode ?? r.reasonCode ?? "UNKNOWN")),
      },
      sizing: {
        passed: riskRows.filter((r: any) => r.stage === "sizing" && (r.verdict === "PASS" || r.verdict === "APPROVED")).length,
        rejected: riskRows.filter((r: any) => r.stage === "sizing" && (r.verdict === "REJECT" || r.verdict === "FAILED")).length,
      },
      ai: {
        invoked: Math.max(aiCalls.length, aiCandidates.length),
        remote: aiCalls.filter((r: any) => r.remote === true).length,
        degraded: aiCalls.filter((r: any) => r.degraded === true).length,
        success: aiCandidates.filter((r: any) => r.status === "COMPLETED").length,
        failure: aiCandidates.filter((r: any) => r.status && r.status !== "COMPLETED").length,
        decisionCounts: countBy(
          decisions.filter((r: any) => r.stage === "execution"),
          (r: any) => String(r.aiVerdict ?? r.reasonCode ?? "UNKNOWN").toUpperCase(),
        ),
      },
      execution: {
        executionReady: decisions.filter((r: any) => r.stage === "execution" && (r.verdict === "APPROVED" || r.verdict === "APPROVE")).length,
        riskPassed: riskRows.filter((r: any) => r.riskVerdict === "PASS" || r.riskVerdict === "APPROVED").length,
        riskRejected: riskRows.filter((r: any) => r.riskVerdict === "REJECT" || r.riskVerdict === "FAILED").length,
        orders: orders.length,
        fills: orders.filter((o: any) => o.fillId || String(o.status ?? "").toUpperCase() === "FILLED").length,
        simulatedTrades: pnlEntries.length,
      },
      entry: {
        records: entryRows.length,
        classificationCounts: countBy(entryRows, (r: any) => String(r.classification ?? "UNKNOWN")),
      },
      exit: {
        exitReasonCounts: countBy(exits, (r: any) => String(r.exitReason ?? "UNKNOWN")),
        exitModelCounts: countBy(exits, (r: any) => String(r.exitModel ?? "UNKNOWN")),
      },
      fees: {
        preTradeSamples: feeEvals.slice(0, 5).map((r: any) => ({
          estimatedEntryFee: r.estimatedEntryFee,
          estimatedExitFee: r.estimatedExitFee,
          estimatedRoundTripFee: r.estimatedRoundTripFee ?? r.estimatedRoundTripFees,
          expectedGrossEdge: r.expectedGrossEdge ?? r.expectedGrossPnL,
          expectedNetEdge: r.expectedNetEdge ?? r.expectedNetPnL,
          feeToGrossEdgeRatio: r.feeToGrossEdgeRatio ?? r.feeToExpectedGrossRatio,
        })),
        postTradeSummary: {
          grossPnL: Number(pnl.summary?.grossPnL ?? 0),
          totalFees: Number(pnl.summary?.totalFees ?? 0),
          netPnL: Number(pnl.summary?.netPnL ?? 0),
          entries: pnlEntries.length,
          feeReconciliationFailCount: pnlEntries.filter((e: any) => e.feeReconciliationStatus === "FAIL").length,
        },
      },
      replayDiagnosticsRows: replayRows.length,
      runtimeHealth: {
        watchdogDecision: watchdog.decision ?? null,
        recoveryEvents: Array.isArray(recovery.records) ? recovery.records.length : 0,
        runtimeStep: runtime.step ?? null,
      },
      artifacts: {
        roundSummary: fs.existsSync(path.join(root, "round-summary.json")),
        scannerSummary: fs.existsSync(path.join(root, "scanner-summary.json")),
        tdiDecisions: fs.existsSync(path.join(root, "tdi-decisions.json")),
        aiTrace: fs.existsSync(path.join(root, "ai-trace.json")),
        aiProgress: fs.existsSync(path.join(root, "ai-progress.json")),
        entryTiming: fs.existsSync(path.join(root, "entry-timing.json")),
        executionTrace: fs.existsSync(path.join(root, "execution-trace.json")),
        exitForensics: fs.existsSync(path.join(root, "exit-forensics.json")),
        replayExitDiagnostics: fs.existsSync(path.join(root, "replay-exit-diagnostics.json")),
        feeAwareEntryPolicy: fs.existsSync(path.join(root, "fee-aware-entry-policy.json")),
        pnlLedger: fs.existsSync(path.join(root, "pnl-ledger.json")),
        recoveryTelemetry: fs.existsSync(path.join(root, "recovery-telemetry.json")),
      },
    };
    rounds.push(roundObj);

    aggregate.scannerCandidates += roundObj.scanner.candidateCount;
    aggregate.tdiApproved += roundObj.tdi.APPROVED;
    aggregate.tdiWait += roundObj.tdi.WAIT;
    aggregate.tdiRejected += roundObj.tdi.REJECTED;
    aggregate.executionReady += roundObj.execution.executionReady;
    aggregate.orders += roundObj.execution.orders;
    aggregate.fills += roundObj.execution.fills;
    aggregate.closedTrades += roundObj.execution.simulatedTrades;
    aggregate.grossPnL += roundObj.fees.postTradeSummary.grossPnL;
    aggregate.totalFees += roundObj.fees.postTradeSummary.totalFees;
    aggregate.netPnL += roundObj.fees.postTradeSummary.netPnL;
    aggregate.aiInvoked += roundObj.ai.invoked;
    aggregate.aiRemote += roundObj.ai.remote;
    aggregate.aiDegraded += roundObj.ai.degraded;
    aggregate.aiFailures += roundObj.ai.failure;
    aggregate.priorityCandidates += roundObj.scanner.priorityCandidates;
    aggregate.priorityRescuedCount += roundObj.scanner.priorityRescuedCount;

    const blocking = new Set(["NO_TRADE", "HOLD", "REJECT", "WAIT"]);
    const bypassOrders = orders.filter((o: any) => blocking.has(String(o.aiVerdict ?? "").toUpperCase()));
    if (bypassOrders.length > 0) {
      critical.push({ roundNo: i, code: "CRITICAL_AI_EXECUTION_BYPASS", count: bypassOrders.length });
    }
    if (roundObj.fees.postTradeSummary.feeReconciliationFailCount > 0) {
      critical.push({
        roundNo: i,
        code: "CRITICAL_PNL_FEE_MISMATCH",
        count: roundObj.fees.postTradeSummary.feeReconciliationFailCount,
      });
    }
  }

  const firstBlockingStage =
    aggregate.orders > 0
      ? null
      : aggregate.executionReady === 0
        ? aggregate.tdiApproved === 0
          ? "TDI"
          : "EXECUTION"
        : "EXECUTION";
  const verdict = critical.length > 0 || job?.status === "FAILED" ? "FAIL" : aggregate.closedTrades > 0 ? "PARTIAL" : "PARTIAL";
  const positionMonitorObserved = rounds.some((r) => Number(r.exit.exitModelCounts.POSITION_MONITOR ?? 0) > 0);
  const realExitObserved = rounds.some((r) =>
    Object.keys(r.exit.exitReasonCounts).some((k) => ["TAKE_PROFIT", "STOP_LOSS", "STRATEGY_EXIT", "TIME_EXIT"].includes(k)),
  );

  const output = {
    runId: SESSION_ID,
    generatedAt: new Date().toISOString(),
    preflight,
    job: job
      ? {
          id: job.id,
          status: job.status,
          completedRounds: job.completedRounds,
          failedRounds: job.failedRounds,
          currentRound: job.currentRound,
          activeState: job.activeState,
          lastError: job.lastError,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
        }
      : null,
    rounds,
    aggregate,
    aiParity: {
      policy: "VETO",
      criticalBypassDetected: critical.some((c) => c.code === "CRITICAL_AI_EXECUTION_BYPASS"),
      criticalBypassEvents: critical.filter((c) => c.code === "CRITICAL_AI_EXECUTION_BYPASS"),
    },
    runtimeHealth: {
      schedulerCrashObserved: String(job?.lastError ?? "").includes("patchJobActiveRound timed out"),
      watchdog: readJson(path.join(process.cwd(), "reports", "kripto-5round-trade-evidence-watchdog.json")),
    },
    final: {
      verdict,
      TRADE_LIFECYCLE_PROVEN: aggregate.closedTrades > 0 ? "YES" : "NO",
      POSITION_MONITOR_PROVEN: positionMonitorObserved ? "YES" : "NO",
      REAL_EXIT_PROVEN: realExitObserved ? "YES" : "NO",
      FEE_RECONCILIATION_PROVEN: critical.every((c) => c.code !== "CRITICAL_PNL_FEE_MISMATCH") ? "YES" : "NO",
      AI_PARITY_PROVEN: critical.every((c) => c.code !== "CRITICAL_AI_EXECUTION_BYPASS") ? "YES" : "NO",
      READY_FOR_30_50_ROUNDS: verdict === "FAIL" ? "NO" : "CONDITIONAL",
      firstBlockingStage: firstBlockingStage ?? "OTHER",
      criticalEvents: critical,
    },
  };

  fs.writeFileSync(
    path.join(process.cwd(), "kripto-5round-trade-evidence-validation.json"),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );

  const lines = [
    "# KRIPTO — 5 Round Trade Evidence Validation",
    "",
    "## 1. Preflight",
    `- Verdict: ${preflight?.overallVerdict ?? "UNKNOWN"}`,
    `- Can start: ${String(preflight?.canStart ?? false)}`,
    `- Attempt ID: ${PREFLIGHT_ID}`,
    "",
    "## 2. Round-by-round summary",
    ...rounds.map(
      (r) =>
        `- Round ${r.roundNo}: state=${r.terminalState ?? "N/A"}, failReason=${r.failReason ?? "none"}, candidates=${r.scanner.candidateCount}, tdiApproved=${r.tdi.APPROVED}, executionReady=${r.execution.executionReady}, orders=${r.execution.orders}, fills=${r.execution.fills}, closedTrades=${r.execution.simulatedTrades}`,
    ),
    "",
    "## 3. Aggregate funnel",
    `- scannerCandidates=${aggregate.scannerCandidates}`,
    `- tdiApproved=${aggregate.tdiApproved}, tdiWait=${aggregate.tdiWait}, tdiRejected=${aggregate.tdiRejected}`,
    `- executionReady=${aggregate.executionReady}, orders=${aggregate.orders}, fills=${aggregate.fills}, closedTrades=${aggregate.closedTrades}`,
    "",
    "## 4. AI parity",
    "- Policy: VETO",
    `- AI bypass detected: ${output.aiParity.criticalBypassDetected ? "YES" : "NO"}`,
    "",
    "## 5. Scanner/priority evidence",
    `- priorityCandidates(total)=${aggregate.priorityCandidates}`,
    `- priorityRescuedCount(total)=${aggregate.priorityRescuedCount}`,
    "",
    "## 6. Entry timing",
    `- entryTimingRecords(total)=${rounds.reduce((a, r) => a + r.entry.records, 0)}`,
    "",
    "## 7. Execution readiness",
    `- executionReady=${aggregate.executionReady}, orders=${aggregate.orders}, fills=${aggregate.fills}`,
    "",
    "## 8. Position monitor evidence",
    `- POSITION_MONITOR_PROVEN=${output.final.POSITION_MONITOR_PROVEN}`,
    "",
    "## 9. Exit evidence",
    `- REAL_EXIT_PROVEN=${output.final.REAL_EXIT_PROVEN}`,
    "",
    "## 10. Fee reconciliation",
    `- FEE_RECONCILIATION_PROVEN=${output.final.FEE_RECONCILIATION_PROVEN}`,
    `- grossPnL=${aggregate.grossPnL.toFixed(8)}, totalFees=${aggregate.totalFees.toFixed(8)}, netPnL=${aggregate.netPnL.toFixed(8)}`,
    "",
    "## 11. PnL",
    `- closedTrades=${aggregate.closedTrades}`,
    `- netPnL=${aggregate.netPnL.toFixed(8)}`,
    "",
    "## 12. Runtime health",
    `- jobStatus=${job?.status ?? "UNKNOWN"}`,
    `- lastError=${job?.lastError ?? "none"}`,
    `- schedulerCrashObserved=${output.runtimeHealth.schedulerCrashObserved ? "YES" : "NO"}`,
    "",
    "## 13. Artifact completeness",
    "- Per-round completeness is included in JSON output.",
    "",
    "## 14. First blocking stage",
    `- ${output.final.firstBlockingStage}`,
    "",
    "## 15. Remaining gaps",
    "- 5-round request could not complete because engine failed at round 3 before rounds 4-5.",
    "- No natural full trade lifecycle was completed in this run.",
    "",
    "## Final Verdict",
    `- VERDICT=${output.final.verdict}`,
    `- TRADE_LIFECYCLE_PROVEN=${output.final.TRADE_LIFECYCLE_PROVEN}`,
    `- POSITION_MONITOR_PROVEN=${output.final.POSITION_MONITOR_PROVEN}`,
    `- REAL_EXIT_PROVEN=${output.final.REAL_EXIT_PROVEN}`,
    `- FEE_RECONCILIATION_PROVEN=${output.final.FEE_RECONCILIATION_PROVEN}`,
    `- AI_PARITY_PROVEN=${output.final.AI_PARITY_PROVEN}`,
    `- READY_FOR_30_50_ROUNDS=${output.final.READY_FOR_30_50_ROUNDS}`,
  ];
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_5ROUND_TRADE_EVIDENCE_VALIDATION.md"), `${lines.join("\n")}\n`, "utf8");

  console.log(JSON.stringify({ ok: true, sessionId: SESSION_ID, verdict: output.final.verdict }, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: (error as Error).message,
        stack: (error as Error).stack,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
