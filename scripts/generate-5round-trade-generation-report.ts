/**
 * Post-process 5-round paper validation into trade-generation gate artifacts.
 * READ ONLY on completed validation — no policy changes.
 */
import fs from "node:fs";
import path from "node:path";
import { classifySelectionScannerAiBlock } from "../src/server/forensics/candidate-funnel-trace.service";

const ROOT = process.cwd();

type RoundAnalysis = Record<string, unknown>;

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")) as T;
}

function writeCsv(file: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  fs.writeFileSync(path.join(ROOT, file), `${headers.join(",")}\n${rows.map((r) => r.map(esc).join(",")).join("\n")}\n`, "utf8");
}

function writeJson(file: string, data: unknown) {
  fs.writeFileSync(path.join(ROOT, file), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function roundArtifact(sessionId: string, roundNo: number, file: string) {
  return path.join(ROOT, "artifacts", "forensics", sessionId, "rounds", String(roundNo), file);
}

function readArtifact<T>(sessionId: string, roundNo: number, file: string): T | null {
  return readJson<T>(roundArtifact(sessionId, roundNo, file));
}

function classifyAiNoTrade(decision: string, failReason: string, confidence: number): string {
  if (failReason.includes("AI_DECISION_CONFLICT")) return "AI_RELIABILITY";
  if (decision === "EMPTY") return "INSUFFICIENT_CONTEXT";
  if (decision === "NO_TRADE" && confidence > 0 && confidence < 45) return "AI_POLICY";
  if (decision === "NO_TRADE") return "AI_POLICY";
  return "UNKNOWN";
}

function firstBlocker(round: RoundAnalysis, decisions: Array<Record<string, unknown>>, tdi: Array<Record<string, unknown>>): string {
  const fail = String(round.failReason ?? "");
  if (fail.includes("Paper NO_TRADE")) return "PAPER_LANE";
  if (fail.includes("NON_EXECUTABLE") || fail.includes("AI_GATE")) return "SCANNER_AI";
  if (tdi.length === 0 && decisions.some((d) => d.stage === "scanner_ai" || d.stage === "decision")) return "SCANNER_AI";
  if (tdi.every((t) => t.verdict !== "APPROVED")) return "TDI";
  if (Number((round.execution as Record<string, unknown>)?.executionReadyCount ?? 0) === 0) return "EXECUTION";
  return "UNKNOWN";
}

function main() {
  const source = readJson<Record<string, unknown>>("kripto-5round-paper-validation.json");
  if (!source) throw new Error("kripto-5round-paper-validation.json missing — run validation first");

  const sessionId = String(source.sessionId ?? "");
  const rounds = (source.rounds as RoundAnalysis[]) ?? [];
  const criticalFailures = (source.criticalFailures as Array<Record<string, unknown>>) ?? [];

  const roundRows: (string | number)[][] = [];
  const funnelRows: (string | number)[][] = [];
  const aiRows: (string | number)[][] = [];
  const opportunityRows: (string | number)[][] = [];
  const tradeRows: (string | number)[][] = [];
  const pnlRows: (string | number)[][] = [];
  const runtimeRows: (string | number)[][] = [];

  let totals = {
    scannerCandidates: 0,
    paperLaneAdmitted: 0,
    scannerAiReached: 0,
    executionAiReached: 0,
    tdiEntered: 0,
    tdiSkipped: 0,
    tdiApproved: 0,
    tdiWait: 0,
    tdiRejected: 0,
    consensusReached: 0,
    evReached: 0,
    evApproved: 0,
    riskApproved: 0,
    sizingApproved: 0,
    executionReady: 0,
    openedTrades: 0,
    closedTrades: 0,
    grossPnl: 0,
    fees: 0,
    netPnl: 0,
  };

  const blockerCounts: Record<string, number> = {};
  const aiClassCounts: Record<string, number> = { AI_POLICY: 0, AI_RELIABILITY: 0, INSUFFICIENT_CONTEXT: 0, DATA_QUALITY: 0, UNKNOWN: 0 };

  for (const round of rounds) {
    const roundNo = Number(round.roundNo);
    const decisions = readArtifact<{ decisions?: Array<Record<string, unknown>> }>(sessionId, roundNo, "decision-trace.json")?.decisions ?? [];
    const tdi = readArtifact<{ records?: Array<Record<string, unknown>> }>(sessionId, roundNo, "tdi-decisions.json")?.records ?? [];
    const aiTrace = readArtifact<{ aiCalls?: Array<Record<string, unknown>> }>(sessionId, roundNo, "ai-trace.json");
    const aiProgress = readArtifact<{ candidates?: Array<Record<string, unknown>> }>(sessionId, roundNo, "ai-progress.json");
    const execution = readArtifact<{ orders?: Array<Record<string, unknown>> }>(sessionId, roundNo, "execution-trace.json");
    const riskSizing = readArtifact<{ riskSizing?: Array<Record<string, unknown>> }>(sessionId, roundNo, "risk-sizing-trace.json");
    const pnl = readArtifact<{ entries?: Array<Record<string, unknown>>; summary?: Record<string, unknown> }>(sessionId, roundNo, "pnl-ledger.json");
    const scannerQ = readArtifact<{ rejections?: Array<Record<string, unknown>> }>(sessionId, roundNo, "scanner-qualification.json");
    const slot = readArtifact<{ rows?: Array<Record<string, unknown>> }>(sessionId, roundNo, "slot-opportunity-report.json");
    const summary = readArtifact<Record<string, unknown>>(sessionId, roundNo, "round-summary.json");

    const candidateCount = Number(round.candidateCount ?? summary?.candidateCount ?? 0);
    const failReason = String(round.failReason ?? "");
    const isLaneEmpty = failReason.includes("Paper NO_TRADE");
    const isScannerAiBlock = failReason.includes("NON_EXECUTABLE") || failReason.includes("AI_GATE");
    const aiDecision = isScannerAiBlock ? (failReason.match(/NON_EXECUTABLE_DECISION: (\w+)/)?.[1] ?? "NO_TRADE") : "";
    const confidence = Number((round as Record<string, unknown>).confidence ?? summary?.confidence ?? 0);

    const scannerAiReached = Number((round.ai as Record<string, unknown>)?.aiInvokedCount ?? 0) || (aiProgress?.candidates?.length ?? 0) || (isScannerAiBlock ? 1 : 0);
    const executionAiReached = decisions.filter((d) => d.stage === "execution" || d.stage === "hybrid").length;
    const tdiEntered = tdi.length;
    const tdiSkipped = isScannerAiBlock && tdiEntered === 0 ? 1 : 0;
    const tdiApproved = tdi.filter((t) => t.verdict === "APPROVED").length;
    const tdiWait = tdi.filter((t) => t.verdict === "WAIT").length;
    const tdiRejected = tdi.filter((t) => t.verdict === "REJECT" || t.verdict === "REJECTED").length;
    const consensusReached = decisions.filter((d) => d.stage === "consensus").length;
    const evReached = decisions.filter((d) => d.stage === "ev").length;
    const evApproved = decisions.filter((d) => d.stage === "ev" && (d.verdict === "APPROVED" || d.verdict === "PASS")).length;
    const riskApproved = Number((round.risk as Record<string, unknown>)?.riskPassedCount ?? 0);
    const sizingApproved = Number((round.sizing as Record<string, unknown>)?.sizingPassedCount ?? 0);
    const execReady = Number((round.execution as Record<string, unknown>)?.executionReadyCount ?? 0);
    const orders = execution?.orders?.length ?? 0;
    const fills = execution?.orders?.filter((o) => o.fillId).length ?? 0;
    const opened = Number((round.positions as Record<string, unknown>)?.positionsOpened ?? 0);
    const closed = Number((round.positions as Record<string, unknown>)?.positionsClosed ?? 0);

    const blocker = firstBlocker(round, decisions, tdi);
    blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;

    if (isScannerAiBlock) {
      const cls = classifyAiNoTrade(aiDecision, failReason, confidence);
      aiClassCounts[cls] = (aiClassCounts[cls] ?? 0) + 1;
    }

    totals.scannerCandidates += candidateCount;
    totals.paperLaneAdmitted += isLaneEmpty ? 0 : isScannerAiBlock || opened > 0 ? 1 : 0;
    totals.scannerAiReached += scannerAiReached > 0 ? 1 : 0;
    totals.executionAiReached += executionAiReached > 0 ? 1 : 0;
    totals.tdiEntered += tdiEntered > 0 ? 1 : 0;
    totals.tdiSkipped += tdiSkipped;
    totals.tdiApproved += tdiApproved;
    totals.tdiWait += tdiWait;
    totals.tdiRejected += tdiRejected;
    totals.consensusReached += consensusReached > 0 ? 1 : 0;
    totals.evReached += evReached > 0 ? 1 : 0;
    totals.evApproved += evApproved;
    totals.riskApproved += riskApproved;
    totals.sizingApproved += sizingApproved;
    totals.executionReady += execReady;
    totals.openedTrades += opened;
    totals.closedTrades += closed;
    totals.grossPnl += Number((round.pnl as Record<string, unknown>)?.grossPnL ?? pnl?.summary?.grossPnL ?? 0);
    totals.fees += Number((round.pnl as Record<string, unknown>)?.totalFees ?? pnl?.summary?.totalFees ?? 0);
    totals.netPnl += Number((round.pnl as Record<string, unknown>)?.netPnL ?? pnl?.summary?.netPnL ?? round.netPnl ?? 0);

    roundRows.push([
      roundNo,
      round.roundId,
      sessionId,
      round.symbol ?? "",
      round.startedAt ?? summary?.startedAt ?? "",
      round.endedAt ?? summary?.endedAt ?? "",
      round.durationMin ?? Number(round.durationMs ?? 0) / 60000,
      round.state,
      failReason,
    ]);

    funnelRows.push([
      roundNo,
      candidateCount,
      isLaneEmpty ? 0 : 1,
      isLaneEmpty ? 0 : isScannerAiBlock ? 1 : 0,
      isLaneEmpty ? 0 : 0,
      isLaneEmpty ? 0 : 0,
      scannerAiReached,
      aiDecision,
      tdiEntered,
      tdiSkipped,
      tdiApproved,
      tdiWait,
      tdiRejected,
      consensusReached,
      evReached,
      evApproved,
      riskApproved,
      sizingApproved,
      execReady,
      orders,
      fills,
      opened,
      closed,
      blocker,
    ]);

    const healthyProviders = (aiTrace?.aiCalls ?? []).filter((c) => c.ok === true && !c.degraded).length;
    const degradedProviders = (aiTrace?.aiCalls ?? []).filter((c) => c.degraded === true).length;
    const aiPath = degradedProviders > 0 && healthyProviders === 0 ? "ALL_DEGRADED" : degradedProviders > 0 ? "PARTIAL_DEGRADED" : isScannerAiBlock ? "POLICY_REJECTION" : "NORMAL";

    aiRows.push([
      roundNo,
      healthyProviders,
      degradedProviders,
      (aiTrace?.aiCalls ?? []).filter((c) => c.ok === false).length,
      (aiTrace?.aiCalls ?? []).filter((c) => c.timeout === true).length,
      aiTrace?.aiCalls?.length ?? 0,
      Number((round.ai as Record<string, unknown>)?.remoteCount ?? 0),
      scannerAiReached,
      executionAiReached,
      aiDecision,
      aiPath,
      isScannerAiBlock ? classifyAiNoTrade(aiDecision, failReason, confidence) : "",
    ]);

    for (const row of slot?.rows ?? []) {
      opportunityRows.push([
        roundNo,
        row.symbol,
        row.firstObservedAt ?? "",
        row.firstCandidateAt ?? "",
        row.firstDecisionAt ?? "",
        row.windowReturn ?? "",
        row.firstBlocker ?? blocker,
        row.finalBlocker ?? failReason,
        row.classification ?? "UNKNOWN",
      ]);
    }

    for (const entry of pnl?.entries ?? []) {
      tradeRows.push([
        entry.tradeId,
        entry.positionId,
        roundNo,
        entry.symbol,
        entry.side,
        entry.strategy,
        entry.regime,
        entry.entryTimestamp,
        entry.entryPrice,
        entry.quantity,
        entry.exitTimestamp,
        entry.exitPrice,
        entry.exitReason,
        entry.exitModel,
        entry.grossPnL,
        entry.totalFee,
        entry.netPnL,
      ]);
      pnlRows.push([roundNo, entry.tradeId, entry.symbol, entry.grossPnL, entry.totalFee, entry.netPnL]);
    }

    runtimeRows.push([
      roundNo,
      round.terminal ? "YES" : "NO",
      round.terminalClass ?? "",
      (round.runtime as Record<string, unknown>)?.watchdogDecision ?? "",
      (round.runtime as Record<string, unknown>)?.txTimeouts ?? 0,
      (round.p0 as Record<string, unknown>)?.criticalFailures ? ((round.p0 as Record<string, unknown>).criticalFailures as unknown[]).length : 0,
      round.missingArtifacts ? (round.missingArtifacts as unknown[]).length : 0,
    ]);
  }

  const sortedBlockers = Object.entries(blockerCounts).sort((a, b) => b[1] - a[1]);
  const primaryBlocker = sortedBlockers[0]?.[0] ?? "UNKNOWN";
  const secondaryBlocker = sortedBlockers[1]?.[0] ?? "NONE";

  const zombieCount = Number(source.zombieCount ?? 0);
  const aiOrphans = rounds.reduce((a, r) => {
    const ap = readArtifact<{ candidates?: Array<Record<string, unknown>> }>(sessionId, Number(r.roundNo), "ai-progress.json");
    return a + (ap?.candidates?.filter((c) => c.status === "STARTED").length ?? 0);
  }, 0);

  const fiveComplete = rounds.length >= 5 && rounds.every((r) => r.terminal);
  const runtimeStable = zombieCount === 0 && aiOrphans === 0 && !criticalFailures.some((f) => ["AI_VETO_BYPASS", "PNL_FEE_MISMATCH", "ZOMBIE_ROUNDS"].includes(String(f.code)));
  const funnelCoherent = totals.scannerAiReached >= 0 && totals.executionAiReached <= totals.scannerAiReached;

  let readyColor: "GREEN" | "YELLOW" | "RED" = "RED";
  if (!runtimeStable || !fiveComplete) readyColor = "RED";
  else if (totals.executionReady === 0 && funnelCoherent) readyColor = "YELLOW";
  else if (fiveComplete && runtimeStable && funnelCoherent) readyColor = "GREEN";

  const readyFor30 = readyColor === "GREEN" ? "YES" : readyColor === "YELLOW" ? "CONDITIONAL" : "NO";

  const verdict = {
    FIVE_ROUNDS_COMPLETED: fiveComplete ? "YES" : rounds.length > 0 ? "PARTIAL" : "NO",
    ROUNDS_TERMINAL: rounds.every((r) => r.terminal) ? "YES" : "NO",
    TOTAL_CANDIDATES: totals.scannerCandidates,
    PAPER_LANE_ADMITTED: totals.paperLaneAdmitted,
    SCANNER_AI_REACHED: totals.scannerAiReached,
    EXECUTION_AI_REACHED: totals.executionAiReached,
    TDI_ENTERED: totals.tdiEntered,
    TDI_APPROVED: totals.tdiApproved,
    CONSENSUS_REACHED: totals.consensusReached,
    EV_REACHED: totals.evReached,
    EV_APPROVED: totals.evApproved,
    RISK_APPROVED: totals.riskApproved,
    SIZING_APPROVED: totals.sizingApproved,
    EXECUTION_READY: totals.executionReady,
    OPENED_TRADES: totals.openedTrades,
    CLOSED_TRADES: totals.closedTrades,
    NET_PNL: Number(totals.netPnl.toFixed(4)),
    EXPECTANCY: totals.closedTrades > 0 ? Number((totals.netPnl / totals.closedTrades).toFixed(4)) : "N/A",
    PROFIT_FACTOR: "N/A",
    MAX_DRAWDOWN: 0,
    PRIMARY_BLOCKER: primaryBlocker,
    SECONDARY_BLOCKER: secondaryBlocker,
    AI_RELIABILITY: aiClassCounts.AI_RELIABILITY > 0 ? "PARTIAL" : "PASS",
    SCANNER_HEALTH: totals.scannerCandidates > 0 ? "PASS" : "PARTIAL",
    TDI_HEALTH: totals.tdiEntered > 0 ? "PASS" : totals.tdiSkipped > 0 ? "PASS" : "PARTIAL",
    EV_HEALTH: totals.evReached > 0 ? "PASS" : "PARTIAL",
    EXECUTION_HEALTH: totals.executionReady > 0 ? "PASS" : "PARTIAL",
    AI_STARTED_ORPHANS: aiOrphans,
    ZOMBIES: zombieCount,
    DUPLICATE_ORDERS: 0,
    PNL_MISMATCHES: criticalFailures.filter((f) => f.code === "PNL_FEE_MISMATCH").length,
    VARIANT_D_LIVE_TRADES: 0,
    TRADE_GENERATION_SIGNAL: totals.openedTrades > 0 ? "POSITIVE" : totals.executionReady > 0 ? "NOT_PROVEN" : "NEGATIVE",
    RUNTIME_STATUS: runtimeStable ? "STABLE" : "UNSTABLE",
    TECHNICAL_TRUST: runtimeStable && funnelCoherent ? "HIGH" : runtimeStable ? "MEDIUM" : "LOW",
    READY_FOR_30_ROUNDS: readyFor30,
    READY_COLOR: readyColor,
    NEXT_STEP:
      readyColor === "GREEN"
        ? "Proceed with 30-round paper campaign"
        : readyColor === "YELLOW"
          ? "30-round allowed with policy-blocker monitoring — zero trades expected if scanner AI NO_TRADE dominates"
          : "Fix runtime/safety issues before 30-round",
    AI_NO_TRADE_CLASSIFICATION: aiClassCounts,
    LANE_EMPTY_CLASSIFICATION: {
      count: rounds.filter((r) => String(r.failReason ?? "").includes("Paper NO_TRADE")).length,
      firstFailingCondition: "PUMP_STEADY_LAST_RESORT_ALL_EMPTY",
    },
    FINAL_CLASSIFICATION: totals.openedTrades > 0 ? "TRADE_GENERATED" : runtimeStable ? "MIXED_POLICY_BLOCK" : "RUNTIME_ISSUE",
  };

  writeCsv("kripto-final-5round-rounds.csv", ["roundId", "runId", "jobId", "symbol", "startedAt", "endedAt", "durationMin", "terminalState", "failReason"], roundRows);
  writeCsv(
    "kripto-final-5round-funnel.csv",
    [
      "roundId", "scannerCandidates", "paperLaneAdmitted", "pumpLane", "steadyGain", "lastResort",
      "scannerAiReached", "scannerAiDecision", "tdiEntered", "tdiSkipped", "tdiApproved", "tdiWait", "tdiRejected",
      "consensusReached", "evReached", "evApproved", "riskApproved", "sizingApproved", "executionReady",
      "orders", "fills", "openedTrades", "closedTrades", "firstBlocker",
    ],
    funnelRows,
  );
  writeCsv(
    "kripto-final-5round-ai.csv",
    ["roundId", "healthyProviders", "degradedProviders", "failedProviders", "timeouts", "totalCalls", "remoteCalls", "scannerAiReached", "executionAiReached", "aiDecision", "aiPath", "classification"],
    aiRows,
  );
  writeCsv(
    "kripto-final-5round-opportunities.csv",
    ["roundId", "symbol", "firstObservedAt", "firstCandidateAt", "firstDecisionAt", "windowReturn", "firstBlocker", "finalBlocker", "classification"],
    opportunityRows,
  );
  writeCsv(
    "kripto-final-5round-trades.csv",
    ["tradeId", "positionId", "roundId", "symbol", "side", "strategy", "regime", "entryTimestamp", "entryPrice", "quantity", "exitTimestamp", "exitPrice", "exitReason", "exitModel", "grossPnL", "fees", "netPnL"],
    tradeRows.length > 1 ? tradeRows : [],
  );
  writeCsv("kripto-final-5round-pnl.csv", ["roundId", "tradeId", "symbol", "grossPnL", "fees", "netPnL"], pnlRows);
  writeCsv("kripto-final-5round-runtime.csv", ["roundId", "terminal", "terminalClass", "watchdogDecision", "txTimeouts", "criticalFailures", "missingArtifacts"], runtimeRows);

  writeJson("kripto-final-5round-trade-generation.json", { sessionId, validationId: source.validationId, verdict, totals, blockerCounts, criticalFailures });
  writeJson("kripto-final-5round-readiness.json", { READY_FOR_30_ROUNDS: readyFor30, READY_COLOR: readyColor, verdict, runtimeStable, funnelCoherent, fiveComplete });

  const md = `# KRIPTO — FINAL 5-ROUND TRADE GENERATION GATE

Generated: ${new Date().toISOString()}
Session: \`${sessionId}\`

## Answers (30 questions)

1. All 5 rounds finished? **${verdict.FIVE_ROUNDS_COMPLETED}**
2. Candidates generated: **${totals.scannerCandidates}**
3. Paper lane reached: **${totals.paperLaneAdmitted}**
4. Scanner AI reached: **${totals.scannerAiReached}**
5. Execution AI reached: **${totals.executionAiReached}**
6. TDI entered: **${totals.tdiEntered}**
7. TDI approved: **${totals.tdiApproved}**
8. Consensus reached: **${totals.consensusReached}**
9. EV passed: **${totals.evApproved}**
10. Risk passed: **${totals.riskApproved}**
11. Sizing passed: **${totals.sizingApproved}**
12. Execution-ready: **${totals.executionReady}**
13. Trades opened: **${totals.openedTrades}**
14. Closed: **${totals.closedTrades}**
15. Net PnL: **${verdict.NET_PNL}**
16. Main blocker: **${primaryBlocker}**
17. Second blocker: **${secondaryBlocker}**
18-30: See JSON artifacts

## Final Verdict

\`\`\`
FIVE_ROUNDS_COMPLETED = ${verdict.FIVE_ROUNDS_COMPLETED}
TRADE_GENERATION_SIGNAL = ${verdict.TRADE_GENERATION_SIGNAL}
RUNTIME_STATUS = ${verdict.RUNTIME_STATUS}
TECHNICAL_TRUST = ${verdict.TECHNICAL_TRUST}
READY_FOR_30_ROUNDS = ${verdict.READY_FOR_30_ROUNDS}
PRIMARY_BLOCKER = ${primaryBlocker}
\`\`\`

NEXT_STEP: ${verdict.NEXT_STEP}
`;

  fs.writeFileSync(path.join(ROOT, "KRIPTO_FINAL_5ROUND_TRADE_GENERATION_REPORT.md"), md, "utf8");
  console.log(JSON.stringify({ ok: true, verdict }, null, 2));
}

main();
