import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

function readJsonIfExists(filePath: string): JsonRecord | null {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as JsonRecord;
  } catch {
    return null;
  }
}

function resolveRoundDir(runId: string) {
  const root = path.join(process.cwd(), "artifacts", "forensics");
  if (!existsSync(root)) return null;
  const sessions = readdirSync(root, { withFileTypes: true }).filter((row) => row.isDirectory());
  for (const session of sessions) {
    const roundsDir = path.join(root, session.name, "rounds");
    if (!existsSync(roundsDir)) continue;
    const rounds = readdirSync(roundsDir, { withFileTypes: true }).filter((row) => row.isDirectory());
    for (const round of rounds) {
      const summary = readJsonIfExists(path.join(roundsDir, round.name, "round-summary.json"));
      if (summary && String(summary.runId ?? "") === runId) {
        return path.join(roundsDir, round.name);
      }
    }
  }
  return null;
}

function row(label: string, value: unknown) {
  return `- ${label}: ${value == null ? "NOT_RECORDED" : String(value)}`;
}

function section(title: string, lines: string[]) {
  return [`## ${title}`, ...lines, ""].join("\n");
}

export function generateValidationReport(runId: string, outputPath?: string) {
  const roundDir = resolveRoundDir(runId);
  if (!roundDir) {
    return {
      runId,
      found: false,
      report: `# Validation Report\n\n- runId: ${runId}\n- status: NOT_RECORDED\n- reason: round artifacts not found\n`,
      outputPath: null,
    };
  }
  const summary = readJsonIfExists(path.join(roundDir, "round-summary.json")) ?? {};
  const identity = readJsonIfExists(path.join(roundDir, "run-identity.json")) ?? {};
  const drift = readJsonIfExists(path.join(roundDir, "config-drift.json")) ?? {};
  const runtime = readJsonIfExists(path.join(roundDir, "runtime-telemetry.json")) ?? {};
  const edge = readJsonIfExists(path.join(roundDir, "edge-analytics.json")) ?? {};
  const edgeAccounting = readJsonIfExists(path.join(roundDir, "edge-accounting.json")) ?? {};
  const scanner = readJsonIfExists(path.join(roundDir, "scanner-summary.json")) ?? {};
  const pnl = readJsonIfExists(path.join(roundDir, "pnl-ledger.json")) ?? {};
  const mfeConversion = (edgeAccounting.mfeConversion as Array<Record<string, unknown>> | undefined) ?? [];
  const profitableHist = (edgeAccounting.profitableRejectionHistogram as Array<Record<string, unknown>> | undefined) ?? [];
  const rankCal = (edgeAccounting.rankCalibration as Array<Record<string, unknown>> | undefined) ?? [];
  const report = [
    "# Validation Report",
    "",
    section("RUN INFO", [
      row("runId", runId),
      row("result", summary.result),
      row("exportStatus", summary.exportStatus),
      row("sessionId", identity.sessionId),
      row("mode", identity.mode),
      row("venue", identity.venue),
      row("startedAt", identity.startedAt),
      row("endedAt", identity.endedAt),
    ]),
    section("CONFIG HASH", [
      row("configHash", identity.configHash),
      row("configDrift", drift.status),
    ]),
    section("MARKET COVERAGE", [
      row("universeSize", (runtime.marketData as JsonRecord | undefined)?.universeSize),
      row("liveSymbols", (runtime.marketData as JsonRecord | undefined)?.liveSymbols),
      row("staleSymbols", (runtime.marketData as JsonRecord | undefined)?.staleSymbols),
      row("coveragePct", (runtime.marketData as JsonRecord | undefined)?.coveragePct),
    ]),
    section("PIPELINE FUNNEL", [
      row("candidateCount", summary.candidateCount),
      row("tradeCount", summary.tradeCount),
      row("failureCount", summary.failureCount),
      row("scannerCycles", (scanner.cycles as unknown[] | undefined)?.length ?? null),
    ]),
    section("GROUND TRUTH MOVERS", [
      row("trackedCandidates", (edge.summary as JsonRecord | undefined)?.candidateCount),
      row("uniqueMoves", (edge.summary as JsonRecord | undefined)?.uniqueMoveCount),
      row("move1", ((edge.summary as JsonRecord | undefined)?.groundTruth as JsonRecord | undefined)?.move1),
      row("move2", ((edge.summary as JsonRecord | undefined)?.groundTruth as JsonRecord | undefined)?.move2),
      row("move3", ((edge.summary as JsonRecord | undefined)?.groundTruth as JsonRecord | undefined)?.move3),
      row("move5", ((edge.summary as JsonRecord | undefined)?.groundTruth as JsonRecord | undefined)?.move5),
      row("move10", ((edge.summary as JsonRecord | undefined)?.groundTruth as JsonRecord | undefined)?.move10),
      row("moverRecall", (((edge.summary as JsonRecord | undefined)?.recall as JsonRecord | undefined)?.recall)),
      row("earlyRecallBefore3", ((((edge.summary as JsonRecord | undefined)?.earlyRecall as JsonRecord | undefined)?.before3 as JsonRecord | undefined)?.recall)),
    ]),
    section("MFE FUNNELS", mfeConversion.length
      ? mfeConversion.flatMap((rowObj) => [
          row(`MFE>=${rowObj.threshold} total`, rowObj.totalCandidates),
          row(`MFE>=${rowObj.threshold} traded`, rowObj.paperTraded),
          row(`MFE>=${rowObj.threshold} conversionPercent`, rowObj.conversionPercent),
        ])
      : [row("status", "NOT_RECORDED")]),
    section("PROFITABLE OPPORTUNITY TO TRADE", [
      row("MFE>=2 conversion", ((edgeAccounting.profitableTradeConversion as JsonRecord | undefined)?.mfe2 as JsonRecord | undefined)?.conversionPercent),
      row("MFE>=3 conversion", ((edgeAccounting.profitableTradeConversion as JsonRecord | undefined)?.mfe3 as JsonRecord | undefined)?.conversionPercent),
      row("MFE>=5 conversion", ((edgeAccounting.profitableTradeConversion as JsonRecord | undefined)?.mfe5 as JsonRecord | undefined)?.conversionPercent),
      row("missedProfitableCount", (edgeAccounting.missedProfitableOpportunities as unknown[] | undefined)?.length ?? null),
    ]),
    section(
      "PROFITABLE REJECTION HISTOGRAM",
      profitableHist.length
        ? profitableHist.map((rowObj) => `- MFE>=${rowObj.threshold}: ${JSON.stringify(rowObj.histogram ?? {})}`)
        : [row("status", "NOT_RECORDED")],
    ),
    section("HOT MICRO RISK VALUE", [
      row("hotMedianMFE", ((edgeAccounting.hotGateValue as JsonRecord | undefined)?.hot as JsonRecord | undefined)?.medianMFE),
      row("notHotMedianMFE", ((edgeAccounting.hotGateValue as JsonRecord | undefined)?.notHot as JsonRecord | undefined)?.medianMFE),
      row("microConfirmedMedianMFE", ((edgeAccounting.microValue as JsonRecord | undefined)?.microConfirmed as JsonRecord | undefined)?.medianMFE),
      row("microRejectedMedianMFE", ((edgeAccounting.microValue as JsonRecord | undefined)?.microRejected as JsonRecord | undefined)?.medianMFE),
      row("riskRejectedMissedProfit", ((edgeAccounting.riskValue as JsonRecord | undefined)?.missedProfit)),
      row("riskRejectedAvoidedLoss", ((edgeAccounting.riskValue as JsonRecord | undefined)?.avoidedLoss)),
    ]),
    section(
      "SCORE AND RANK CALIBRATION",
      [
        row("scoreBucketCount", ((edge.scoreCalibration as unknown[] | undefined)?.length ?? null)),
        ...rankCal.map((rowObj) => `- rank ${rowObj.bucket}: N=${rowObj.N} hit2=${rowObj.hit2Rate}% tradeRate=${rowObj.tradeRate}%`),
      ],
    ),
    section("CAPTURE RATIO", [
      row("formula", ((edgeAccounting.captureRatio as JsonRecord | undefined)?.formula)),
      row("sampleN", (((edgeAccounting.captureRatio as JsonRecord | undefined)?.summary as JsonRecord | undefined)?.N)),
      row("medianRatio", (((edgeAccounting.captureRatio as JsonRecord | undefined)?.summary as JsonRecord | undefined)?.medianRatio)),
      row("p95Ratio", (((edgeAccounting.captureRatio as JsonRecord | undefined)?.summary as JsonRecord | undefined)?.p95Ratio)),
    ]),
    section("PIPELINE LATENCY", [
      row("Discovery->HOT p50", ((((edgeAccounting.pipelineLatency as JsonRecord | undefined)?.DiscoveryToHotMs as JsonRecord | undefined)?.p50))),
      row("ExecutionReady->RiskAllowed p95", ((((edgeAccounting.pipelineLatency as JsonRecord | undefined)?.ExecutionReadyToRiskAllowedMs as JsonRecord | undefined)?.p95))),
      row("PaperAttempt->PaperOpened p95", ((((edgeAccounting.pipelineLatency as JsonRecord | undefined)?.PaperAttemptToPaperOpenedMs as JsonRecord | undefined)?.p95))),
      row("Detection->PaperOpened total p95", ((((edgeAccounting.pipelineLatency as JsonRecord | undefined)?.DetectionToPaperOpenedTotalMs as JsonRecord | undefined)?.p95))),
    ]),
    section("DEEP LATENCY", [
      row("subscribeRequested->active p95", ((((edgeAccounting.deepLatency as JsonRecord | undefined)?.subscribeRequestedToActive as JsonRecord | undefined)?.p95))),
      row("active->firstAggTrade p95", ((((edgeAccounting.deepLatency as JsonRecord | undefined)?.activeToFirstAggTrade as JsonRecord | undefined)?.p95))),
      row("active->firstBookTicker p95", ((((edgeAccounting.deepLatency as JsonRecord | undefined)?.activeToFirstBookTicker as JsonRecord | undefined)?.p95))),
      row("active->microReady p95", ((((edgeAccounting.deepLatency as JsonRecord | undefined)?.activeToMicroReady as JsonRecord | undefined)?.p95))),
    ]),
    section("PAPER ECONOMICS", [
      row("netPnL", ((pnl.summary as JsonRecord | undefined)?.netPnL)),
      row("grossPnL", ((pnl.summary as JsonRecord | undefined)?.grossPnL)),
      row("fees", ((pnl.summary as JsonRecord | undefined)?.totalFees)),
      row("profitFactor", ((pnl.summary as JsonRecord | undefined)?.profitFactor)),
      row("expectancy", ((pnl.summary as JsonRecord | undefined)?.expectancy)),
      row("maxDrawdown", ((pnl.summary as JsonRecord | undefined)?.maxDrawdown)),
    ]),
    section("WEBSOCKET BREAKER REST", [
      row("ws1008Count", (runtime.marketData as JsonRecord | undefined)?.count1008),
      row("wsReconnectAttempt", (runtime.marketData as JsonRecord | undefined)?.reconnectAttempt),
      row("wsReconnectSuccess", (runtime.marketData as JsonRecord | undefined)?.reconnectSuccess),
      row("breakerOpenCount", ((runtime.breaker as JsonRecord | undefined)?.summary as JsonRecord | undefined)?.open),
      row("rest429", (runtime.marketData as JsonRecord | undefined)?.rateLimited429),
      row("rest418", (runtime.marketData as JsonRecord | undefined)?.banned418),
    ]),
    section("CPU MEMORY EVENT LOOP REDIS", [
      row("cpuPercent", ((runtime.resources as JsonRecord | undefined)?.cpuPercent)),
      row("eventLoopLagP95Ms", ((runtime.resources as JsonRecord | undefined)?.eventLoopLagP95Ms)),
      row("redisLatencyMs", ((runtime.resources as JsonRecord | undefined)?.redisLatencyMs)),
      row("rssMB", (((runtime.resources as JsonRecord | undefined)?.memory as JsonRecord | undefined)?.rssMB)),
      row("heapUsedMB", (((runtime.resources as JsonRecord | undefined)?.memory as JsonRecord | undefined)?.heapUsedMB)),
      row("heapTotalMB", (((runtime.resources as JsonRecord | undefined)?.memory as JsonRecord | undefined)?.heapTotalMB)),
    ]),
    section("AUTHORITY COUNTERS", [
      row("aiHardVetoCount", ((runtime.authority as JsonRecord | undefined)?.aiHardVetoCount)),
      row("tdiHardVetoCount", ((runtime.authority as JsonRecord | undefined)?.tdiHardVetoCount)),
      row("learningHardVetoCount", ((runtime.authority as JsonRecord | undefined)?.learningHardVetoCount)),
      row("legacyScannerInvocationCount", ((runtime.authority as JsonRecord | undefined)?.legacyScannerInvocationCount)),
      row("legacyScannerPersistCount", ((runtime.authority as JsonRecord | undefined)?.legacyScannerPersistCount)),
    ]),
  ].join("\n");

  const target = outputPath ?? path.join(roundDir, "validation-report.md");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${report}\n`, "utf8");
  return { runId, found: true, report, outputPath: target };
}
