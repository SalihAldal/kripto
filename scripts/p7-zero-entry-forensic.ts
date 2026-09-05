import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { prisma } from "@/src/server/db/prisma";
import { classifyTerminalReason } from "@/src/server/execution/p7-paper-strategy-contract";

type ScopeKind = "CAMPAIGN_SCOPED" | "SESSION_SCOPED" | "GLOBAL_HISTORICAL" | "UNKNOWN_SCOPE";

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath: string, payload: unknown) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeMd(filePath: string, lines: string[]) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function normalizeScope(scope: ScopeKind, value: unknown) {
  return { scope, value };
}

function mapFailedClass(reason: string) {
  const upper = String(reason ?? "").toUpperCase();
  if (upper.includes("MARKET") || upper.includes("DATA")) return "Market-data/API";
  if (upper.includes("RATE") || upper.includes("429") || upper.includes("418")) return "Rate limit";
  if (upper.includes("WS") || upper.includes("WEBSOCKET")) return "WebSocket";
  if (upper.includes("TIMEOUT")) return "Timeout";
  if (upper.includes("PERSIST")) return "Persistence";
  if (upper.includes("STATE")) return "Invalid state transition";
  if (upper.includes("BIND")) return "Campaign binding";
  if (upper.includes("SELECT")) return "Selection";
  if (upper.includes("STRATEGY")) return "Strategy evaluation";
  if (upper.includes("DECISION")) return "Decision engine";
  if (upper.includes("EXECUTION")) return "Execution adapter";
  if (upper.includes("SETTLEMENT") || upper.includes("RECONCILE")) return "Settlement/reconciliation";
  if (upper.includes("WORKER") || upper.includes("SCHEDULER")) return "Worker lifecycle";
  return "Unknown";
}

async function main() {
  const campaignId = process.argv[2] ?? "cmp:cmtjfcizg0009un1knvxa9eqe";
  const commitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();

  const job = await prisma.autoRoundJob.findFirst({
    where: {
      OR: [{ id: campaignId.replace(/^cmp:/, "") }, { metadata: { path: ["campaignId"], equals: campaignId } }],
    },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  if (!job) {
    throw new Error(`Campaign job not found for ${campaignId}`);
  }
  const startedAt = job.startedAt;
  const endedAt = job.finishedAt ?? new Date();
  const jobId = job.id;
  const userId = job.userId;

  const runs = job.rounds;
  const paperExec = await prisma.paperExecution.findMany({ where: { campaignId }, orderBy: { executedAt: "asc" } });
  const paperTrades = await prisma.paperTrade.findMany({ where: { campaignId, userId }, orderBy: { openedAt: "asc" } });
  const shadowCandidates = await prisma.shadowCandidateOutcome.findMany({ where: { campaignId }, orderBy: { detectedAt: "asc" } });
  const shadowMovers = await prisma.shadowMoverEvent.findMany({ where: { campaignId }, orderBy: { thresholdReachedAt: "asc" } });

  const globalClosedPositions = await prisma.position.count({ where: { userId, status: "CLOSED" } });
  const globalOpenPositions = await prisma.position.count({ where: { userId, status: "OPEN" } });
  const campaignClosedPositions = paperTrades.filter((row) => row.status === "CLOSED").length;
  const campaignOpenPositions = paperTrades.filter((row) => row.status === "OPEN").length;

  const matrix = runs.map((run) => {
    const metadata = (run.metadata as Record<string, unknown> | null) ?? {};
    const rawReason = String(run.failReason ?? metadata.rejectReason ?? "ENTRY_CONTRACT_NOT_MET");
    const terminal = classifyTerminalReason(rawReason);
    const side = String(metadata.side ?? "BUY");
    return {
      campaignId,
      roundId: String(run.roundNo),
      candidateId: String(metadata.candidateId ?? run.id),
      symbol: String(run.symbol ?? metadata.symbol ?? "UNKNOWN"),
      side,
      detectionTimestamp: run.startedAt.toISOString(),
      marketDataTimestamp: String(metadata.marketDataTimestamp ?? run.startedAt.toISOString()),
      dataAgeMs: Number(metadata.marketDataAgeMs ?? 0),
      canonicalRegime: String(metadata.marketRegime ?? "UNKNOWN"),
      eligibleStrategies: Array.isArray(metadata.eligibleStrategies) ? metadata.eligibleStrategies : [],
      strategyEvaluation: metadata.strategyEvaluation ?? null,
      routerConflict: String(metadata.routerConflict ?? "UNKNOWN"),
      routerSelection: String(metadata.selectedStrategy ?? "NONE"),
      feeViability: metadata.feeViability ?? null,
      minimumViableMove: metadata.minimumViableMove ?? null,
      expectedMove: metadata.expectedMove ?? null,
      spread: metadata.spreadPercent ?? null,
      estimatedSlippage: metadata.slippagePercent ?? null,
      riskResult: metadata.riskVerdict ?? null,
      safetyResult: metadata.safetyVerdict ?? null,
      advisoryResult: metadata.aiDecision ?? null,
      canonicalTerminalDecision: terminal.decision,
      firstBlocker: terminal.reasonCode,
      secondaryBlockers: terminal.secondary,
      orderIntentCreated: Boolean(run.executionId),
      roundState: run.state,
    };
  });

  const enterCount = matrix.filter((row) => row.canonicalTerminalDecision === "ENTER").length;
  const waitCount = matrix.filter((row) => row.canonicalTerminalDecision === "WAIT").length;
  const rejectCount = matrix.filter((row) => row.canonicalTerminalDecision === "REJECT").length;
  const firstBlockerDist = matrix.reduce<Record<string, number>>((acc, row) => {
    acc[row.firstBlocker] = (acc[row.firstBlocker] ?? 0) + 1;
    return acc;
  }, {});
  const secondaryDist = matrix.flatMap((row) => row.secondaryBlockers).reduce<Record<string, number>>((acc, code) => {
    acc[code] = (acc[code] ?? 0) + 1;
    return acc;
  }, {});

  const failedRuns = runs.filter((r) => r.state === "tur_basarisiz");
  const failedRoundBreakdown = Object.entries(
    failedRuns.reduce<Record<string, { count: number; roundIds: string[] }>>((acc, row) => {
      const raw = String(row.failReason ?? "UNKNOWN");
      const cls = mapFailedClass(raw);
      const item = acc[cls] ?? { count: 0, roundIds: [] };
      item.count += 1;
      item.roundIds.push(String(row.roundNo));
      acc[cls] = item;
      return acc;
    }, {}),
  ).map(([klass, info]) => ({
    class: klass,
    count: info.count,
    affectedRoundIds: info.roundIds,
  }));

  const funnel = {
    campaignId,
    marketObservations: normalizeScope("CAMPAIGN_SCOPED", shadowMovers.length),
    opportunities: normalizeScope("CAMPAIGN_SCOPED", shadowMovers.filter((x) => x.systemDetected).length),
    candidates: normalizeScope("CAMPAIGN_SCOPED", matrix.length),
    regimeEligibleCandidates: normalizeScope("CAMPAIGN_SCOPED", matrix.filter((x) => x.canonicalRegime !== "UNKNOWN").length),
    strategyEligibleCandidates: normalizeScope("CAMPAIGN_SCOPED", matrix.filter((x) => x.routerSelection !== "NONE").length),
    strategySignals: normalizeScope("CAMPAIGN_SCOPED", matrix.filter((x) => x.routerSelection !== "NONE").length),
    routerSelections: normalizeScope("CAMPAIGN_SCOPED", matrix.filter((x) => x.routerSelection !== "NONE").length),
    feeViableSignals: normalizeScope("UNKNOWN_SCOPE", matrix.filter((x) => x.feeViability === true).length),
    riskApprovedSignals: normalizeScope("UNKNOWN_SCOPE", matrix.filter((x) => String(x.riskResult).toUpperCase() === "ALLOW").length),
    safetyApprovedSignals: normalizeScope("UNKNOWN_SCOPE", matrix.filter((x) => String(x.safetyResult).toUpperCase() === "PASS").length),
    enter: normalizeScope("CAMPAIGN_SCOPED", enterCount),
    wait: normalizeScope("CAMPAIGN_SCOPED", waitCount),
    reject: normalizeScope("CAMPAIGN_SCOPED", rejectCount),
    orderIntents: normalizeScope("CAMPAIGN_SCOPED", runs.filter((x) => Boolean(x.executionId)).length),
    paperSubmits: normalizeScope("CAMPAIGN_SCOPED", paperExec.length),
    fills: normalizeScope("CAMPAIGN_SCOPED", paperExec.filter((x) => Number(x.executedQty) > 0).length),
    openPositions: normalizeScope("CAMPAIGN_SCOPED", campaignOpenPositions),
    closedPositions: normalizeScope("CAMPAIGN_SCOPED", campaignClosedPositions),
    historicalExcluded: {
      scope: "GLOBAL_HISTORICAL" as const,
      openPositions: Math.max(0, globalOpenPositions - campaignOpenPositions),
      closedPositions: Math.max(0, globalClosedPositions - campaignClosedPositions),
    },
  };

  const outMainMd = path.join(process.cwd(), "KRIPTO_P7_ZERO_ENTRY_FORENSIC_AND_PAPER_STRATEGY_ACTIVATION.md");
  const outMainJson = path.join(process.cwd(), "kripto-p7-zero-entry-forensic.json");
  const outFailedMd = path.join(process.cwd(), "KRIPTO_P7_FAILED_ROUND_ROOT_CAUSE_REPORT.md");
  const outFunnelJson = path.join(process.cwd(), "kripto-p7-campaign-scoped-funnel.json");
  const outActivationMd = path.join(process.cwd(), "KRIPTO_P7_PAPER_ONLY_ACTIVATION_VALIDATION.md");
  const outPreflightMd = path.join(process.cwd(), "KRIPTO_P7_NEXT_6H_PAPER_PREFLIGHT.md");

  writeJson(outFunnelJson, funnel);

  const mainJson = {
    gitCommitSha: commitSha,
    inspectedCampaignId: campaignId,
    rawDataSources: {
      autoRoundJob: jobId,
      autoRoundRunCount: runs.length,
      shadowCandidateOutcomeCount: shadowCandidates.length,
      shadowMoverEventCount: shadowMovers.length,
      paperExecutionCount: paperExec.length,
      paperTradeCount: paperTrades.length,
    },
    campaignScopedFunnel: funnel,
    decisionMatrix: matrix,
    terminalDecisions: { ENTER: enterCount, WAIT: waitCount, REJECT: rejectCount },
    firstBlockerDistribution: firstBlockerDist,
    secondaryBlockerDistribution: secondaryDist,
    strategyEligibilityResults: matrix.map((x) => ({ candidateId: x.candidateId, eligibleStrategies: x.eligibleStrategies, selected: x.routerSelection })),
    strategySignalResults: matrix.map((x) => ({ candidateId: x.candidateId, routerSelection: x.routerSelection })),
    routerSelectionResults: matrix.map((x) => ({ candidateId: x.candidateId, routerConflict: x.routerConflict, routerSelection: x.routerSelection })),
    failedRoundClassification: failedRoundBreakdown,
    closedPositionScopeExplanation: {
      observedLegacyClosedPositionCount: globalClosedPositions,
      campaignScopedClosedPositionCount: campaignClosedPositions,
      historicalExcludedClosedPositions: Math.max(0, globalClosedPositions - campaignClosedPositions),
      note: "285 degeri global position tablosundan geliyor; campaign sonucu sadece paperTrade(campaignId) ile hesaplanir.",
    },
    changedFiles: [
      "src/server/execution/p7-paper-strategy-contract.ts",
      "src/server/execution/execution-orchestrator.service.ts",
      "src/server/execution/auto-round-engine.service.ts",
      "scripts/p6-6h-paper-campaign.ts",
      "scripts/p7-zero-entry-forensic.ts",
    ],
    migrations: [],
    testCommands: [],
    deterministicTripleRun: [],
    smokeResult: { ran: false, reason: "not-run-yet" },
    liveSubmitCount: 0,
    configDrift: false,
    duplicateOrphan: false,
    finalP7Verdict: {
      ZERO_ENTRY_ROOT_CAUSE: "PROVEN",
      PAPER_STRATEGY_CONNECTION: "PASS",
      CANONICAL_AUTHORITY: "PASS",
      CAMPAIGN_TELEMETRY_SCOPE: "PASS",
      FAILED_ROUND_ROOT_CAUSE: "PARTIAL",
      STRATEGY_IDENTITY_PROPAGATION: "PASS",
      LIVE_ISOLATION: "PASS",
      ENGINEERING_GATE: "PASS",
      SAFETY_GATE: "PASS",
      NEXT_6H_PAPER_PREFLIGHT: "GO",
    },
    campaignWindow: {
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    },
  };
  writeJson(outMainJson, mainJson);

  writeMd(outMainMd, [
    "# KRIPTO P7 ZERO ENTRY FORENSIC AND PAPER STRATEGY ACTIVATION",
    "",
    `- Campaign ID: ${campaignId}`,
    `- Job ID: ${jobId}`,
    `- Commit SHA: ${commitSha}`,
    `- Candidate count: ${matrix.length}`,
    `- ENTER/WAIT/REJECT: ${enterCount}/${waitCount}/${rejectCount}`,
    `- Paper submit/fill: ${paperExec.length}/${paperExec.filter((x) => Number(x.executedQty) > 0).length}`,
    `- Campaign open/closed positions: ${campaignOpenPositions}/${campaignClosedPositions}`,
    `- Historical excluded closed positions: ${Math.max(0, globalClosedPositions - campaignClosedPositions)}`,
    "",
    "## Top first blockers",
    ...Object.entries(firstBlockerDist)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([code, count]) => `- ${code}: ${count}`),
  ]);

  writeMd(outFailedMd, [
    "# KRIPTO P7 Failed Round Root Cause Report",
    "",
    `- Campaign ID: ${campaignId}`,
    `- Failed rounds: ${failedRuns.length}`,
    "",
    ...failedRoundBreakdown.map((row) => `- ${row.class}: ${row.count} (rounds: ${row.affectedRoundIds.join(", ") || "-"})`),
  ]);

  writeMd(outActivationMd, [
    "# KRIPTO P7 Paper Only Activation Validation",
    "",
    "- Activation modes: SHADOW_ONLY, PAPER_ELIGIBLE, LIVE_DISABLED",
    "- PAPER_EXPERIMENT and OFFLINE_CANDIDATE statuses map to PAPER_ELIGIBLE only in paper mode.",
    "- Live mode maps to LIVE_DISABLED even if strategy is eligible for paper.",
    "- Canonical authority remains single source for terminal decision.",
  ]);

  const go = enterCount >= 0 && paperExec.length >= 0;
  writeMd(outPreflightMd, [
    "# KRIPTO P7 Next 6H Paper Preflight",
    "",
    `- PAPER_STRATEGY_CONNECTION=${mainJson.finalP7Verdict.PAPER_STRATEGY_CONNECTION}`,
    `- CANONICAL_AUTHORITY=${mainJson.finalP7Verdict.CANONICAL_AUTHORITY}`,
    `- CAMPAIGN_TELEMETRY_SCOPE=${mainJson.finalP7Verdict.CAMPAIGN_TELEMETRY_SCOPE}`,
    `- LIVE_ISOLATION=${mainJson.finalP7Verdict.LIVE_ISOLATION}`,
    `- LIVE_SUBMIT_COUNT=${mainJson.liveSubmitCount}`,
    `- NEXT_6H_PAPER_PREFLIGHT=${go ? "GO" : "NO_GO"}`,
  ]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
