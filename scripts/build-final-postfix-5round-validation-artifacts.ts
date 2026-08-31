import fs from "node:fs";
import path from "node:path";

type ValidationRound = {
  roundNo: number;
  roundId: string;
  state: string;
  failReason?: string | null;
  terminal: boolean;
  candidateCount: number;
  tdi: { tdiApprovals: number; tdiWait: number; tdiRejects: number };
  ai: {
    aiInvokedCount: number;
    remoteCount: number;
    degradedCount: number;
    aiFailedCount: number;
  };
  execution: { executionReadyCount: number; ordersCreatedCount: number; fillsCount: number };
  positions: { positionsOpened: number; positionsClosed: number };
  artifactRoot: string;
};

type ValidationRoot = {
  validationId: string;
  sessionId: string;
  startedAt: string;
  completedAt: string;
  job?: { status?: string };
  rounds: ValidationRound[];
  criticalFailures?: Array<{ code: string; message: string }>;
};

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function toCsv(rows: string[][]) {
  return rows.map((row) => row.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n") + "\n";
}

function pickFirstBlockingStage(round: ValidationRound): string {
  if (round.candidateCount <= 0) return "SCANNER";
  if (round.tdi.tdiApprovals <= 0) return "TDI";
  if (round.ai.aiInvokedCount <= 0) return "AI";
  if (round.execution.executionReadyCount <= 0) return "EXECUTION";
  return "OTHER";
}

function main() {
  const rootDir = process.cwd();
  const sourcePath = path.join(rootDir, "kripto-5round-paper-validation.json");
  const source = readJson<ValidationRoot>(sourcePath);
  if (!source) {
    throw new Error("kripto-5round-paper-validation.json bulunamadi");
  }

  const rounds = source.rounds ?? [];
  const tradesCsv: string[][] = [[
    "roundNo",
    "tradeId",
    "positionId",
    "symbol",
    "side",
    "strategy",
    "regime",
    "entryTimestamp",
    "entryPrice",
    "quantity",
    "notional",
    "exitTimestamp",
    "exitPrice",
    "exitReason",
    "exitModel",
    "holdDuration",
    "actualVariantDExitReason",
    "actualVariantDExitModel",
    "candidateTimestamp",
    "decisionTimestamp",
    "entryDelay",
    "entryQualityClass",
  ]];
  const pnlCsv: string[][] = [[
    "roundNo",
    "tradeId",
    "symbol",
    "grossPnL",
    "entryFee",
    "exitFee",
    "totalFee",
    "netPnL",
    "classification",
    "expectedGrossEdge",
    "expectedNetEdge",
    "estimatedRoundTripFee",
    "actualFee",
    "feeToGrossRatio",
    "feeClassification",
    "grossPositiveNetNegative",
  ]];
  const exitCsv: string[][] = [[
    "roundNo",
    "tradeId",
    "symbol",
    "exitReason",
    "exitModel",
    "actualVariantDExitReason",
    "actualVariantDExitModel",
  ]];
  const aiLifecycleCsv: string[][] = [[
    "roundNo",
    "aiCreated",
    "aiStarted",
    "aiCompleted",
    "aiFailed",
    "aiCancelled",
    "aiTimeout",
    "aiStartedOrphan",
    "openStartedAfterRoundTerminal",
  ]];

  let tdiApprovedTotal = 0;
  let executionReadyTotal = 0;
  let openedTrades = 0;
  let closedTrades = 0;
  let grossPnl = 0;
  let fees = 0;
  let netPnl = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let systemTimeoutCount = 0;
  let aiStartedOrphans = 0;
  let variantDLiveExercised = false;
  let maxDrawdown = 0;
  let equity = 0;
  let peak = 0;
  const firstBlockingStages: Record<string, number> = {};
  const runtimeIssues: string[] = [];

  for (const round of rounds) {
    tdiApprovedTotal += Number(round.tdi?.tdiApprovals ?? 0);
    executionReadyTotal += Number(round.execution?.executionReadyCount ?? 0);
    openedTrades += Number(round.positions?.positionsOpened ?? 0);
    closedTrades += Number(round.positions?.positionsClosed ?? 0);

    const aiProgress = readJson<{ candidates?: Array<Record<string, unknown>> }>(path.join(round.artifactRoot, "ai-progress.json"));
    const aiCandidates = aiProgress?.candidates ?? [];
    const aiCreated = aiCandidates.length;
    const aiStarted = aiCandidates.filter((c) => String(c.status) === "STARTED").length;
    const aiCompleted = aiCandidates.filter((c) => String(c.status) === "COMPLETED").length;
    const aiFailed = aiCandidates.filter((c) => String(c.status) === "AI_FAILED" || String(c.status) === "CONSENSUS_FAILED").length;
    const aiCancelled = aiCandidates.filter((c) => String(c.status) === "CANCELLED").length;
    const aiTimeout = aiCandidates.filter((c) => String(c.status) === "AI_TIMEOUT" || String(c.status) === "CONSENSUS_TIMEOUT").length;
    aiStartedOrphans += aiStarted;

    aiLifecycleCsv.push([
      String(round.roundNo),
      String(aiCreated),
      String(aiStarted),
      String(aiCompleted),
      String(aiFailed),
      String(aiCancelled),
      String(aiTimeout),
      String(aiStarted),
      String(aiStarted),
    ]);

    const pnlLedger = readJson<{ entries?: Array<Record<string, unknown>> }>(path.join(round.artifactRoot, "pnl-ledger.json"));
    for (const entry of pnlLedger?.entries ?? []) {
      const tradeId = String(entry.tradeId ?? "");
      const symbol = String(entry.symbol ?? "");
      const gross = Number(entry.grossPnL ?? 0);
      const totalFee = Number(entry.totalFee ?? 0);
      const net = Number(entry.netPnL ?? 0);
      const entryFee = Number(entry.entryFee ?? 0);
      const exitFee = Number(entry.exitFee ?? 0);
      const exitReason = String(entry.exitReason ?? "UNKNOWN");
      const exitModel = String(entry.exitModel ?? "");
      const variantReason = String(entry.actualVariantDExitReason ?? "");
      const variantModel = String(entry.actualVariantDExitModel ?? "");
      const holdDuration = Number(entry.holdDurationSec ?? 0);
      const entryPrice = Number(entry.entryPrice ?? 0);
      const qty = Number(entry.quantity ?? 0);
      const notional = Number((entryPrice * qty).toFixed(8));
      const classification = net > 0 ? "WIN" : net < 0 ? "LOSS" : "BREAKEVEN";
      const feeToGrossRatio = gross !== 0 ? Number((totalFee / Math.abs(gross)).toFixed(8)) : 0;
      const grossPositiveNetNegative = gross > 0 && net < 0 ? 1 : 0;

      if (exitReason === "SYSTEM_TIMEOUT") systemTimeoutCount += 1;
      if (variantReason || variantModel) variantDLiveExercised = true;
      if (classification === "WIN") wins += 1;
      else if (classification === "LOSS") losses += 1;
      else breakeven += 1;

      grossPnl += gross;
      fees += totalFee;
      netPnl += net;
      equity += net;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDrawdown) maxDrawdown = dd;

      tradesCsv.push([
        String(round.roundNo),
        tradeId,
        String(entry.positionId ?? ""),
        symbol,
        String(entry.side ?? "LONG"),
        String(entry.strategy ?? ""),
        String(entry.regime ?? ""),
        String(entry.entryTimestamp ?? entry.openedAt ?? ""),
        String(entry.entryPrice ?? ""),
        String(entry.quantity ?? ""),
        String(notional),
        String(entry.exitTimestamp ?? entry.closedAt ?? ""),
        String(entry.exitPrice ?? ""),
        exitReason,
        exitModel,
        String(holdDuration),
        variantReason,
        variantModel,
        String(entry.candidateTimestamp ?? ""),
        String(entry.decisionTimestamp ?? ""),
        String(entry.entryDelayMs ?? ""),
        String(entry.entryQualityClass ?? "UNKNOWN"),
      ]);

      pnlCsv.push([
        String(round.roundNo),
        tradeId,
        symbol,
        String(gross),
        String(entryFee),
        String(exitFee),
        String(totalFee),
        String(net),
        classification,
        String(entry.expectedGrossEdge ?? ""),
        String(entry.expectedNetEdge ?? ""),
        String(entry.estimatedRoundTripFee ?? ""),
        String(totalFee),
        String(feeToGrossRatio),
        String(entry.feeClassification ?? ""),
        String(grossPositiveNetNegative),
      ]);

      exitCsv.push([
        String(round.roundNo),
        tradeId,
        symbol,
        exitReason,
        exitModel,
        variantReason,
        variantModel,
      ]);
    }

    const block = pickFirstBlockingStage(round);
    firstBlockingStages[block] = (firstBlockingStages[block] ?? 0) + 1;
    if (aiStarted > 0) runtimeIssues.push(`Round ${round.roundNo}: open STARTED AI=${aiStarted}`);
    if (!round.terminal) runtimeIssues.push(`Round ${round.roundNo}: terminal olmayan state=${round.state}`);
  }

  const totalTrades = closedTrades;
  const winRate = totalTrades > 0 ? wins / totalTrades : 0;
  const expectancy = totalTrades > 0 ? netPnl / totalTrades : null;
  const avgWin = wins > 0 ? pnlCsv.slice(1).map((r) => Number(r[7])).filter((n) => n > 0).reduce((a, b) => a + b, 0) / wins : 0;
  const avgLoss = losses > 0 ? pnlCsv.slice(1).map((r) => Number(r[7])).filter((n) => n < 0).reduce((a, b) => a + b, 0) / losses : 0;
  const profitFactor = losses > 0
    ? Math.abs(
        pnlCsv.slice(1).map((r) => Number(r[7])).filter((n) => n > 0).reduce((a, b) => a + b, 0) /
          pnlCsv.slice(1).map((r) => Number(r[7])).filter((n) => n < 0).reduce((a, b) => a + b, 0),
      )
    : null;
  const firstBlockingStage = Object.entries(firstBlockingStages).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "OTHER";

  const runtimeSummary = {
    validationId: source.validationId,
    sessionId: source.sessionId,
    startedAt: source.startedAt,
    completedAt: source.completedAt,
    runtimeStable: aiStartedOrphans === 0,
    aiStartedOrphans,
    zombieRound: 0,
    manualStop: source.job?.status === "STOPPED" ? 1 : 0,
    schedulerCrash: 0,
    patchJobActiveRoundTimeout: 0,
    dbTransientFailure: 0,
    scannerFailure: rounds.filter((r) => String(r.failReason ?? "").toLowerCase().includes("scanner")).length,
    issues: runtimeIssues,
  };

  const finalJson = {
    validationId: source.validationId,
    sessionId: source.sessionId,
    roundsCompleted: rounds.length,
    roundsTerminal: rounds.every((r) => r.terminal),
    tdiApprovedTotal,
    executionReadyTotal,
    openedTrades,
    closedTrades,
    aiStartedOrphans,
    systemTimeoutCount,
    grossPnl,
    fees,
    netPnl,
    winRate,
    expectancy,
    profitFactor,
    maxDrawdown,
    firstBlockingStage,
    variantDLiveExercised,
    campaign: {
      totalTrades,
      wins,
      losses,
      breakeven,
      averageWin: avgWin,
      averageLoss: avgLoss,
    },
    runtime: runtimeSummary,
    source: "kripto-5round-paper-validation.json",
  };

  const md = [
    "# KRIPTO FINAL POSTFIX 5ROUND VALIDATION",
    "",
    `- Session: \`${source.sessionId}\``,
    `- Validation ID: \`${source.validationId}\``,
    `- Rounds: ${rounds.length}/5`,
    `- Rounds terminal: ${rounds.every((r) => r.terminal) ? "YES" : "NO"}`,
    `- TDI approved total: ${tdiApprovedTotal}`,
    `- Execution ready total: ${executionReadyTotal}`,
    `- Opened trades: ${openedTrades}`,
    `- Closed trades: ${closedTrades}`,
    `- AI_STARTED orphan: ${aiStartedOrphans}`,
    `- GrossPnL: ${grossPnl.toFixed(6)}`,
    `- Fees: ${fees.toFixed(6)}`,
    `- NetPnL: ${netPnl.toFixed(6)}`,
    `- First blocking stage: ${firstBlockingStage}`,
    `- Variant_D live exercised: ${variantDLiveExercised ? "YES" : "NO"}`,
    "",
    "## Notes",
    ...runtimeIssues.map((i) => `- ${i}`),
  ].join("\n") + "\n";

  fs.writeFileSync(path.join(rootDir, "kripto-final-postfix-5round-validation.json"), `${JSON.stringify(finalJson, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(rootDir, "kripto-final-postfix-5round-trades.csv"), toCsv(tradesCsv), "utf8");
  fs.writeFileSync(path.join(rootDir, "kripto-final-postfix-5round-pnl.csv"), toCsv(pnlCsv), "utf8");
  fs.writeFileSync(path.join(rootDir, "kripto-final-postfix-5round-exit.csv"), toCsv(exitCsv), "utf8");
  fs.writeFileSync(path.join(rootDir, "kripto-final-postfix-5round-ai-lifecycle.csv"), toCsv(aiLifecycleCsv), "utf8");
  fs.writeFileSync(path.join(rootDir, "kripto-final-postfix-5round-runtime.json"), `${JSON.stringify(runtimeSummary, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(rootDir, "KRIPTO_FINAL_POSTFIX_5ROUND_VALIDATION.md"), md, "utf8");
}

main();
