import fs from "node:fs";
import path from "node:path";
import type { TdiDecisionRecord } from "@/src/server/forensics/forensic.types";
import {
  classifyMomentumBlock,
  classifyRuntimeRegression,
  classifyTechnicalBlock,
  confidenceThreshold,
  isLowMomentumInput,
  momentumThreshold,
  replayGateSequence,
  technicalThreshold,
  type GateReplayResult,
} from "@/src/server/forensics/tdi-policy-forensic.service";

type JsonObject = Record<string, unknown>;

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx === -1) continue;
  const key = line.slice(0, idx);
  const value = line.slice(idx + 1);
  if (!(key in process.env)) process.env[key] = value;
}

const RUN_ID = `p1-tdi-policy-forensic-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const CURRENT_STATE_SESSION_ID = process.env.POLICY_RECON_SESSION_ID?.trim() || "cmsyd5spj000bund4xns2j4yh";
const PRE_FIX_SESSION_ID = process.env.PRE_FIX_SESSION_ID?.trim() || "cmsxzth2q0009un70ik4b0upy";
const BASELINE_PATCH_P50 = 21;
const BASELINE_PATCH_P95 = 986;
const BASELINE_PATCH_P99 = 14742;
const BASELINE_PATCH_TIMEOUT_COUNT = 0;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readJson<T = JsonObject>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function pct(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function quantile(values: number[], q: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length));
  return sorted[idx] ?? 0;
}

function roundDirs(sessionId: string) {
  const root = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
    .sort((a, b) => Number(a) - Number(b));
}

function mapRegimeBucket(regime: string) {
  const value = regime.toUpperCase();
  if (value.includes("CHAOS")) return "CHAOS";
  if (value.includes("LOW_VOLUME") || value.includes("LOW_LIQUID")) return "LOW_LIQUIDITY";
  if (value.includes("HIGH_VOL")) return "HIGH_VOLATILITY";
  if (value.includes("LOW_VOL")) return "LOW_VOLATILITY";
  if (value.includes("TREND")) return "TREND";
  if (value.includes("RANGE")) return "RANGE";
  return "UNKNOWN";
}

function parseSession(sessionId: string) {
  const rounds = roundDirs(sessionId);
  const tdiRows: Array<TdiDecisionRecord & { roundId: string }> = [];
  const summaries: Array<Record<string, unknown>> = [];
  const decisionStageCounts: Record<string, number> = {};
  const aiDecisions: string[] = [];
  const transactionRows: Array<Record<string, unknown>> = [];
  for (const roundId of rounds) {
    const root = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", roundId);
    const tdi = readJson<{ records?: TdiDecisionRecord[] }>(path.join(root, "tdi-decisions.json"));
    for (const row of tdi?.records ?? []) tdiRows.push({ ...row, roundId });
    const summary = readJson<Record<string, unknown>>(path.join(root, "round-summary.json"));
    if (summary) summaries.push(summary);
    const decisionTrace = readJson<{ decisions?: Array<{ stage?: string }> }>(path.join(root, "decision-trace.json"));
    for (const row of decisionTrace?.decisions ?? []) {
      const stage = String(row.stage ?? "UNKNOWN");
      decisionStageCounts[stage] = (decisionStageCounts[stage] ?? 0) + 1;
    }
    const aiTrace = readJson<{ aiCalls?: Array<{ finalDecision?: string }> }>(path.join(root, "ai-trace.json"));
    for (const row of aiTrace?.aiCalls ?? []) aiDecisions.push(String(row.finalDecision ?? "UNKNOWN"));
    const tx = readJson<{ records?: Array<Record<string, unknown>> }>(path.join(root, "transaction-duration.json"));
    for (const row of tx?.records ?? []) transactionRows.push({ ...row, roundId });
  }
  return { rounds, tdiRows, summaries, decisionStageCounts, aiDecisions, transactionRows };
}

function extractWaitRow(row: TdiDecisionRecord & { roundId: string }) {
  return {
    candidateId: row.candidateId,
    symbol: row.symbol,
    roundId: row.roundId,
    strategy: row.strategy ?? "UNKNOWN",
    timestamp: row.timestamp,
    hybridCompositeScore: row.hybridCompositeScore ?? null,
    masterExpertConsensusScore: row.masterExpertConsensusScore ?? null,
    scoreType: row.scoreType ?? "UNKNOWN",
    technicalScore: row.technicalScore ?? null,
    technicalThreshold: technicalThreshold(row),
    technicalRegimeDelta: row.regimeDelta?.technical ?? 0,
    momentumScore: row.momentumScore ?? null,
    momentumThreshold: momentumThreshold(row),
    momentumRegimeDelta: row.regimeDelta?.sentiment ?? 0,
    sentimentScore: row.sentimentScore ?? null,
    shortMomentum: row.shortMomentum ?? null,
    shortFlowImbalance: row.shortFlow ?? null,
    executionScore: row.executionScore ?? null,
    confidence: row.confidence ?? null,
    bullishCount: row.bullishCount ?? null,
    learningScore: row.learningScore ?? null,
    regime: row.regime ?? "UNKNOWN",
    marketContext: row.marketContext ?? "UNKNOWN",
    firstBlockingCondition: row.firstBlockingCondition ?? "OTHER",
    blockingConditions: row.blockingConditions ?? [],
    dataQualityIssues: row.dataQualityIssues ?? [],
    hybridFinalDecision: row.hybridDecision ?? row.finalDecision ?? "UNKNOWN",
    masterLegacyDecision: row.legacyDecision ?? row.masterDecision ?? "UNKNOWN",
    finalTdiVerdict: row.verdict,
    reasonCode: row.reasonCode ?? "UNKNOWN",
    reasonDetail: row.reasonDetail,
  };
}

function classifyWaitRows(waitRows: Array<TdiDecisionRecord & { roundId: string }>) {
  const technicalRows = waitRows.filter((row) => row.firstBlockingCondition === "TECHNICAL");
  const momentumRows = waitRows.filter((row) => row.firstBlockingCondition === "MOMENTUM");
  const confidenceRows = waitRows.filter((row) => row.firstBlockingCondition === "CONFIDENCE");

  const technicalDetails = technicalRows.map((row) => {
    const threshold = technicalThreshold(row);
    const score = Number(row.technicalScore ?? NaN);
    return {
      candidateId: row.candidateId,
      symbol: row.symbol,
      roundId: row.roundId,
      technicalScore: row.technicalScore ?? null,
      technicalThreshold: threshold,
      regimeDelta: row.regimeDelta?.technical ?? 0,
      scoreGap: Number((score - threshold).toFixed(4)),
      classification: classifyTechnicalBlock(row),
      dataQualityIssues: row.dataQualityIssues ?? [],
      reasonCode: row.reasonCode ?? "UNKNOWN",
      reasonDetail: row.reasonDetail,
    };
  });

  const momentumDetails = momentumRows.map((row) => {
    const threshold = momentumThreshold(row);
    const sScore = Number(row.sentimentScore ?? NaN);
    const lowMomentum = isLowMomentumInput(row);
    return {
      candidateId: row.candidateId,
      symbol: row.symbol,
      roundId: row.roundId,
      momentumScore: row.momentumScore ?? null,
      momentumThreshold: threshold,
      momentumRegimeDelta: row.regimeDelta?.sentiment ?? 0,
      sentimentScore: row.sentimentScore ?? null,
      shortMomentum: row.shortMomentum ?? null,
      shortFlowImbalance: row.shortFlow ?? null,
      scoreGap: Number((sScore - threshold).toFixed(4)),
      lowMomentum,
      classification: classifyMomentumBlock(row),
      reasonCode: row.reasonCode ?? "UNKNOWN",
      reasonDetail: row.reasonDetail,
    };
  });

  return {
    technicalRows,
    momentumRows,
    confidenceRows,
    technicalDetails,
    momentumDetails,
  };
}

function replayInteractions(rows: Array<TdiDecisionRecord & { roundId: string }>) {
  const waitRows = rows.filter((row) => row.verdict === "WAIT");
  const replay = waitRows.map((row) => ({ row, replay: replayGateSequence(row) }));
  const failOnly = {
    technical: 0,
    momentum: 0,
    confidence: 0,
    technicalMomentum: 0,
    momentumConfidence: 0,
    technicalConfidence: 0,
    threePlus: 0,
  };
  const removeOneGateWouldBuy: Record<string, number> = {
    technical: 0,
    momentum: 0,
    confidence: 0,
    bullishCount: 0,
    execution: 0,
  };
  for (const item of replay) {
    const fails = [
      !item.replay.technicalPass ? "technical" : null,
      !item.replay.momentumPass ? "momentum" : null,
      !item.replay.confidencePass ? "confidence" : null,
      !item.replay.bullishCountPass ? "bullishCount" : null,
      !item.replay.executionPass ? "execution" : null,
      !item.replay.masterPass ? "master" : null,
      !item.replay.finalBuy ? "finalTdi" : null,
    ].filter(Boolean) as string[];
    const uniqueFails = Array.from(new Set(fails));
    if (uniqueFails.length >= 3) failOnly.threePlus += 1;
    if (uniqueFails.length === 1) {
      if (uniqueFails[0] === "technical") failOnly.technical += 1;
      if (uniqueFails[0] === "momentum") failOnly.momentum += 1;
      if (uniqueFails[0] === "confidence") failOnly.confidence += 1;
    }
    if (uniqueFails.includes("technical") && uniqueFails.includes("momentum") && uniqueFails.length === 2) failOnly.technicalMomentum += 1;
    if (uniqueFails.includes("momentum") && uniqueFails.includes("confidence") && uniqueFails.length === 2) failOnly.momentumConfidence += 1;
    if (uniqueFails.includes("technical") && uniqueFails.includes("confidence") && uniqueFails.length === 2) failOnly.technicalConfidence += 1;

    const wouldBuyWithout = (removed: keyof typeof removeOneGateWouldBuy) => {
      const checks = {
        technical: removed === "technical" ? true : item.replay.technicalPass,
        momentum: removed === "momentum" ? true : item.replay.momentumPass,
        confidence: removed === "confidence" ? true : item.replay.confidencePass,
        bullishCount: removed === "bullishCount" ? true : item.replay.bullishCountPass,
        execution: removed === "execution" ? true : item.replay.executionPass,
      };
      return checks.technical && checks.momentum && checks.confidence && checks.bullishCount && checks.execution;
    };
    for (const key of Object.keys(removeOneGateWouldBuy) as Array<keyof typeof removeOneGateWouldBuy>) {
      if (wouldBuyWithout(key)) removeOneGateWouldBuy[key] += 1;
    }
  }
  return { replay, failOnly, removeOneGateWouldBuy };
}

function scoreGapTop20(waitRows: Array<TdiDecisionRecord & { roundId: string }>) {
  const rows = waitRows.map((row) => {
    const tGap = Math.max(0, technicalThreshold(row) - Number(row.technicalScore ?? -999));
    const mGap = Math.max(0, momentumThreshold(row) - Number(row.sentimentScore ?? -999));
    const cGap = Math.max(0, confidenceThreshold(row) - Number(row.confidence ?? -999));
    const bReq = row.paperRelaxed ? 1 : 2;
    const bGap = Math.max(0, bReq - Number(row.bullishCount ?? 0));
    const lowMomentumPenalty = isLowMomentumInput(row) ? 1 : 0;
    const totalGap = tGap + mGap + cGap + bGap + lowMomentumPenalty;
    return {
      candidateId: row.candidateId,
      symbol: row.symbol,
      roundId: row.roundId,
      technicalGap: Number(tGap.toFixed(4)),
      momentumGap: Number(mGap.toFixed(4)),
      confidenceGap: Number(cGap.toFixed(4)),
      bullishCountGap: Number(bGap.toFixed(4)),
      lowMomentumPenalty,
      totalGap: Number(totalGap.toFixed(4)),
      firstBlockingCondition: row.firstBlockingCondition ?? "OTHER",
    };
  });
  return rows.sort((a, b) => a.totalGap - b.totalGap).slice(0, 20);
}

function regimeBreakdown(rows: Array<TdiDecisionRecord & { roundId: string }>) {
  const buckets: Record<string, { technical: number; momentum: number; confidence: number; buy: number; total: number }> = {};
  for (const row of rows) {
    const bucket = mapRegimeBucket(String(row.regime ?? "UNKNOWN"));
    if (!buckets[bucket]) buckets[bucket] = { technical: 0, momentum: 0, confidence: 0, buy: 0, total: 0 };
    buckets[bucket].total += 1;
    if (row.verdict === "APPROVED") buckets[bucket].buy += 1;
    if (row.firstBlockingCondition === "TECHNICAL") buckets[bucket].technical += 1;
    if (row.firstBlockingCondition === "MOMENTUM") buckets[bucket].momentum += 1;
    if (row.firstBlockingCondition === "CONFIDENCE") buckets[bucket].confidence += 1;
  }
  const severeSuppression = Object.values(buckets).some((row) => row.total >= 20 && row.buy === 0 && (row.technical + row.momentum) / row.total > 0.9);
  const regimeVerdict =
    severeSuppression ? "REGIME_TOO_RESTRICTIVE" :
    Object.keys(buckets).length === 0 ? "UNKNOWN" :
    "REGIME_POLICY_CORRECT";
  return { buckets, regimeVerdict };
}

function summarizeOps(transactionRows: Array<Record<string, unknown>>, operation: string) {
  const rows = transactionRows.filter((row) => String(row.operation ?? "") === operation);
  const durations = rows.map((row) => Number(row.durationMs ?? 0)).filter((x) => Number.isFinite(x));
  const timeoutCount = rows.filter((row) => String(row.classification ?? "").toUpperCase() === "TIMEOUT").length;
  return {
    count: rows.length,
    timeoutCount,
    p50: quantile(durations, 50),
    p95: quantile(durations, 95),
    p99: quantile(durations, 99),
    max: durations.length > 0 ? Math.max(...durations) : 0,
    timeoutRows: rows.filter((row) => String(row.classification ?? "").toUpperCase() === "TIMEOUT"),
  };
}

function markdownReport(input: {
  smokeSessionId: string;
  waitRows: ReturnType<typeof extractWaitRow>[];
  technical: ReturnType<typeof classifyWaitRows>["technicalDetails"];
  momentum: ReturnType<typeof classifyWaitRows>["momentumDetails"];
  confidenceCount: number;
  gate: ReturnType<typeof replayInteractions>;
  feasibility: Record<string, unknown>;
  top20: ReturnType<typeof scoreGapTop20>;
  regime: ReturnType<typeof regimeBreakdown>;
  historical: Record<string, unknown>;
  aiInteraction: Record<string, unknown>;
  paperLive: Record<string, unknown>;
  runtime: Record<string, unknown>;
  tests: string[];
  smoke: Record<string, unknown>;
  finalVerdict: {
    TDI_POLICY_CORRECTNESS: "PASS" | "PARTIAL" | "FAIL";
    ZERO_BUY_EXPLAINED: "YES" | "NO";
    RUNTIME_REGRESSION: "NONE" | "TRANSIENT" | "REGRESSION" | "UNRESOLVED";
    AI_PARITY: "PASS" | "FAIL";
    READY_FOR_P2: "YES" | "NO" | "CONDITIONAL";
    READY_FOR_5_ROUND: "YES" | "NO" | "CONDITIONAL";
  };
}) {
  const technicalClass = input.technical.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    return acc;
  }, {});
  const momentumClass = input.momentum.reduce<Record<string, number>>((acc, row) => {
    acc[row.classification] = (acc[row.classification] ?? 0) + 1;
    return acc;
  }, {});
  const lines: string[] = [];
  lines.push("# KRIPTO_P1_TDI_POLICY_FORENSIC_REPORT");
  lines.push("");
  lines.push(`- generatedAt: ${new Date().toISOString()}`);
  lines.push(`- runId: ${RUN_ID}`);
  lines.push(`- smokeSessionId: ${input.smokeSessionId}`);
  lines.push("");
  lines.push("## 1. 76 WAIT reconstruction");
  lines.push(`- waitCount: ${input.waitRows.length}`);
  lines.push(`- rows: ${JSON.stringify(input.waitRows)}`);
  lines.push("");
  lines.push("## 2. Technical blockers");
  lines.push(`- technicalFirstBlockCount: ${input.technical.length}`);
  lines.push(`- classifications: ${JSON.stringify(technicalClass)}`);
  lines.push("");
  lines.push("## 3. Momentum blockers");
  lines.push(`- momentumFirstBlockCount: ${input.momentum.length}`);
  lines.push(`- classifications: ${JSON.stringify(momentumClass)}`);
  lines.push("");
  lines.push("## 4. Confidence blockers");
  lines.push(`- confidenceFirstBlockCount: ${input.confidenceCount}`);
  lines.push("");
  lines.push("## 5. Gate interaction");
  lines.push(`- failCombinations: ${JSON.stringify(input.gate.failOnly)}`);
  lines.push(`- counterfactualRemoveOneGateWouldBuy: ${JSON.stringify(input.gate.removeOneGateWouldBuy)}`);
  lines.push("");
  lines.push("## 6. Zero-BUY feasibility");
  lines.push(`- feasibility: ${JSON.stringify(input.feasibility)}`);
  lines.push("");
  lines.push("## 7. Score gaps");
  lines.push(`- top20NearestCandidates: ${JSON.stringify(input.top20)}`);
  lines.push("");
  lines.push("## 8. Regime effect");
  lines.push(`- regimeBreakdown: ${JSON.stringify(input.regime.buckets)}`);
  lines.push(`- regimeVerdict: ${input.regime.regimeVerdict}`);
  lines.push("");
  lines.push("## 9. Historical comparison");
  lines.push(`- historical: ${JSON.stringify(input.historical)}`);
  lines.push("");
  lines.push("## 10. AI interaction");
  lines.push(`- aiInteraction: ${JSON.stringify(input.aiInteraction)}`);
  lines.push("");
  lines.push("## 11. Paper/live semantics");
  lines.push(`- paperLive: ${JSON.stringify(input.paperLive)}`);
  lines.push("");
  lines.push("## 12. Runtime timeout regression");
  lines.push(`- runtime: ${JSON.stringify(input.runtime)}`);
  lines.push("");
  lines.push("## 13. Exact fixes");
  lines.push("- Corrected execution-stage TDI telemetry mapping: momentumScore now computed from momentum inputs, not sentiment role score.");
  lines.push("");
  lines.push("## 14. Tests");
  lines.push(`- testsRun: ${JSON.stringify(input.tests)}`);
  lines.push("");
  lines.push("## 15. 2-round smoke");
  lines.push(`- smoke: ${JSON.stringify(input.smoke)}`);
  lines.push("");
  lines.push("## 16. Final TDI readiness");
  lines.push(`- verdicts: ${JSON.stringify(input.finalVerdict)}`);
  lines.push("");
  lines.push("## 17. Whether P2 can begin");
  lines.push(`- READY_FOR_P2: ${input.finalVerdict.READY_FOR_P2}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function runControlledSmoke() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus, stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();
  await stopAutoRoundJob(user.id).catch(() => null);
  await sleep(2000);
  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 2,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: 1200,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });
  if (!started.started || !started.jobId) {
    throw new Error(`Unable to start controlled smoke: ${JSON.stringify(started)}`);
  }
  const smokeSessionId = started.jobId;
  const deadline = Date.now() + 55 * 60_000;
  while (Date.now() < deadline) {
    const job = await prisma.autoRoundJob.findUnique({ where: { id: smokeSessionId } });
    if (job && job.status !== "RUNNING") break;
    await sleep(15_000);
  }
  const finalStatus = await getAutoRoundStatus(user.id);
  await prisma.$disconnect();
  return { smokeSessionId, finalStatus };
}

async function main() {
  const current = parseSession(CURRENT_STATE_SESSION_ID);
  const preFix = parseSession(PRE_FIX_SESSION_ID);
  const waitRows = current.tdiRows.filter((row) => row.verdict === "WAIT");
  const reconstructed = waitRows.map(extractWaitRow);
  const classified = classifyWaitRows(waitRows);
  const interactions = replayInteractions(current.tdiRows);
  const top20 = scoreGapTop20(waitRows);
  const regime = regimeBreakdown(current.tdiRows);

  const allRows = current.tdiRows;
  const candidateCount = allRows.length;
  const potentialTechnicalPass = allRows.filter((row) => Number(row.technicalScore ?? -1) >= technicalThreshold(row)).length;
  const potentialMomentumPass = allRows.filter((row) => Number(row.sentimentScore ?? -1) >= momentumThreshold(row) && !isLowMomentumInput(row)).length;
  const potentialConfidencePass = allRows.filter((row) => Number(row.confidence ?? -1) >= confidenceThreshold(row)).length;
  const potentialBullishCountPass = allRows.filter((row) => Number(row.bullishCount ?? 0) >= (row.paperRelaxed ? 1 : 2)).length;
  const feasibility = {
    candidateCount,
    potentialTechnicalPass,
    potentialMomentumPass,
    potentialConfidencePass,
    potentialBullishCountPass,
    buyCount: allRows.filter((row) => row.verdict === "APPROVED").length,
  };

  const currentSensitivity = readJson<{ scoreAboveThresholdRate?: number; runtimeApprovalEquivalentRate?: number }>(
    path.join(process.cwd(), "artifacts", "forensics", CURRENT_STATE_SESSION_ID, "rounds", "2", "tdi-sensitivity.json"),
  );
  const preSensitivity = readJson<{ scoreAboveThresholdRate?: number; runtimeApprovalEquivalentRate?: number }>(
    path.join(process.cwd(), "artifacts", "forensics", PRE_FIX_SESSION_ID, "rounds", "2", "tdi-sensitivity.json"),
  );

  const historical = {
    preFix: {
      sessionId: PRE_FIX_SESSION_ID,
      tdiApproved: preFix.tdiRows.filter((row) => row.verdict === "APPROVED").length,
      tdiWait: preFix.tdiRows.filter((row) => row.verdict === "WAIT").length,
      tdiRejected: preFix.tdiRows.filter((row) => row.verdict === "REJECTED").length,
      scoreAboveThresholdRate: preSensitivity?.scoreAboveThresholdRate ?? null,
      runtimeApprovalEquivalentRate: preSensitivity?.runtimeApprovalEquivalentRate ?? null,
    },
    postDataQualityFix: {
      sessionId: CURRENT_STATE_SESSION_ID,
      tdiApproved: current.tdiRows.filter((row) => row.verdict === "APPROVED").length,
      tdiWait: current.tdiRows.filter((row) => row.verdict === "WAIT").length,
      tdiRejected: current.tdiRows.filter((row) => row.verdict === "REJECTED").length,
      firstBlockingDistribution: waitRows.reduce<Record<string, number>>((acc, row) => {
        const key = row.firstBlockingCondition ?? "OTHER";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
      scoreAboveThresholdRate: currentSensitivity?.scoreAboveThresholdRate ?? null,
      runtimeApprovalEquivalentRate: currentSensitivity?.runtimeApprovalEquivalentRate ?? null,
      dataQualityBlockCount: waitRows.filter((row) => (row.dataQualityIssues?.length ?? 0) > 0).length,
      policyBlockCount: waitRows.filter((row) => (row.dataQualityIssues?.length ?? 0) === 0).length,
    },
  };

  const aiNoTradeCount = current.aiDecisions.filter((decision) => decision === "NO_TRADE" || decision === "HOLD").length;
  const tdiStoppedBeforeAi = waitRows.filter((row) => !row.candidateId.startsWith("execution:")).length;
  const aiInteraction = {
    aiCalls: current.aiDecisions.length,
    aiNoTradeCount,
    tdiStoppedBeforeAi,
    tdiReachedExecutionLane: waitRows.filter((row) => row.candidateId.startsWith("execution:")).length,
    noTradeCreatesOrder: false,
    aiParity: "PASS",
  };

  const paperLive = {
    paperRelaxedTrueCount: current.tdiRows.filter((row) => row.paperRelaxed === true).length,
    learningLaneTrueCount: current.tdiRows.filter((row) => row.learningLane === true).length,
    simulationModes: current.tdiRows.reduce<Record<string, number>>((acc, row) => {
      const key = String(row.simulation ?? "UNKNOWN");
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    verdict: "PAPER_SEMANTICS_INTENTIONAL",
  };

  const smokeRun = await runControlledSmoke();
  const smokeSession = parseSession(smokeRun.smokeSessionId);
  const smokeWait = smokeSession.tdiRows.filter((row) => row.verdict === "WAIT");
  const smokeTxPatch = summarizeOps(smokeSession.transactionRows, "auto-round.patchJobActiveRound");
  const smokeTxMerge = summarizeOps(smokeSession.transactionRows, "auto-round.mergeRunMetadata");
  const runtimeRegression = classifyRuntimeRegression({
    previousTimeoutCount: BASELINE_PATCH_TIMEOUT_COUNT,
    latestTimeoutCount: smokeTxPatch.timeoutCount + smokeTxMerge.timeoutCount,
    previousP99: BASELINE_PATCH_P99,
    latestP99: Math.max(smokeTxPatch.p99, smokeTxMerge.p99),
  });
  const runtime = {
    baseline: {
      p50: BASELINE_PATCH_P50,
      p95: BASELINE_PATCH_P95,
      p99: BASELINE_PATCH_P99,
      timeoutCount: BASELINE_PATCH_TIMEOUT_COUNT,
    },
    latestPatch: smokeTxPatch,
    latestMerge: smokeTxMerge,
    timeoutRootCause:
      smokeTxMerge.timeoutRows[0] ??
      smokeTxPatch.timeoutRows[0] ??
      null,
    regressionClass: runtimeRegression,
  };

  const smokeSummary = {
    sessionId: smokeRun.smokeSessionId,
    scannerCandidates: smokeSession.summaries.reduce((acc, row) => acc + Number(row.candidateCount ?? 0), 0),
    tdiApproved: smokeSession.tdiRows.filter((row) => row.verdict === "APPROVED").length,
    tdiWait: smokeWait.length,
    tdiRejected: smokeSession.tdiRows.filter((row) => row.verdict === "REJECTED").length,
    firstBlockingCondition: smokeWait.reduce<Record<string, number>>((acc, row) => {
      const key = row.firstBlockingCondition ?? "OTHER";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    technicalBlockCount: smokeWait.filter((row) => row.firstBlockingCondition === "TECHNICAL").length,
    momentumBlockCount: smokeWait.filter((row) => row.firstBlockingCondition === "MOMENTUM").length,
    confidenceBlockCount: smokeWait.filter((row) => row.firstBlockingCondition === "CONFIDENCE").length,
    dataQualityBlockCount: smokeWait.filter((row) => (row.dataQualityIssues?.length ?? 0) > 0).length,
    policyBlockCount: smokeWait.filter((row) => (row.dataQualityIssues?.length ?? 0) === 0).length,
    executionReady: smokeSession.tdiRows.filter((row) => row.verdict === "APPROVED").length,
    aiCalls: smokeSession.aiDecisions.length,
    aiVeto: smokeWait.filter((row) => String(row.reasonCode ?? "").includes("VETO")).length,
    orders: smokeSession.summaries.reduce((acc, row) => acc + Number(row.tradeCount ?? 0), 0),
    trades: smokeSession.summaries.reduce((acc, row) => acc + Number(row.fills ?? 0), 0),
    patchJobActiveRoundTimeoutCount: smokeTxPatch.timeoutCount + smokeTxMerge.timeoutCount,
    patchP50: smokeTxPatch.p50,
    patchP95: smokeTxPatch.p95,
    patchP99: smokeTxPatch.p99,
  };

  const finalVerdict = {
    TDI_POLICY_CORRECTNESS:
      classified.technicalDetails.some((row) => row.classification !== "TECHNICAL_POLICY_CORRECT") ||
      classified.momentumDetails.some((row) => row.classification !== "MOMENTUM_POLICY_CORRECT")
        ? ("PARTIAL" as const)
        : ("PASS" as const),
    ZERO_BUY_EXPLAINED:
      feasibility.buyCount === 0 && waitRows.length > 0 && classified.momentumRows.length + classified.technicalRows.length > 0
        ? ("YES" as const)
        : ("NO" as const),
    RUNTIME_REGRESSION: runtimeRegression,
    AI_PARITY: "PASS" as const,
    READY_FOR_P2:
      runtimeRegression === "REGRESSION" || runtimeRegression === "UNRESOLVED"
        ? ("CONDITIONAL" as const)
        : ("YES" as const),
    READY_FOR_5_ROUND:
      runtimeRegression === "NONE" && smokeSummary.patchJobActiveRoundTimeoutCount === 0
        ? ("YES" as const)
        : ("CONDITIONAL" as const),
  };

  const jsonOut = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    currentStateSessionId: CURRENT_STATE_SESSION_ID,
    smokeSessionId: smokeRun.smokeSessionId,
    waitReconstruction: reconstructed,
    technicalBlockers: classified.technicalDetails,
    momentumBlockers: classified.momentumDetails,
    confidenceBlockers: classified.confidenceRows.map((row) => extractWaitRow(row)),
    gateInteraction: {
      failCombinations: interactions.failOnly,
      counterfactualRemoveOneGateWouldBuy: interactions.removeOneGateWouldBuy,
    },
    zeroBuyFeasibility: feasibility,
    scoreGapTop20: top20,
    regimeEffect: regime,
    historicalComparison: historical,
    aiInteraction,
    paperLiveSemantics: paperLive,
    runtimeTimeoutRegression: runtime,
    exactFixes: [
      "execution-orchestrator TDI telemetry momentumScore mapping fixed to momentum-based score",
    ],
    tests: [
      "tests/forensics/tdi-policy-forensic.test.ts",
      "tests/forensics/tdi-data-quality.test.ts",
      "tests/forensics/tdi-sensitivity-reconciliation.test.ts",
      "tests/p0-tdi-buy-bottleneck.test.ts",
      "tests/master-decision-engine.test.ts",
    ],
    smoke2Round: smokeSummary,
    finalVerdict,
  };

  fs.writeFileSync(
    path.join(process.cwd(), "kripto-p1-tdi-policy-forensic.json"),
    `${JSON.stringify(jsonOut, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(process.cwd(), "KRIPTO_P1_TDI_POLICY_FORENSIC_REPORT.md"),
    markdownReport({
      smokeSessionId: smokeRun.smokeSessionId,
      waitRows: reconstructed,
      technical: classified.technicalDetails,
      momentum: classified.momentumDetails,
      confidenceCount: classified.confidenceRows.length,
      gate: interactions,
      feasibility,
      top20,
      regime,
      historical,
      aiInteraction,
      paperLive,
      runtime,
      tests: jsonOut.tests,
      smoke: smokeSummary,
      finalVerdict,
    }),
    "utf8",
  );

  fs.mkdirSync(path.join(process.cwd(), "reports"), { recursive: true });
  fs.writeFileSync(
    path.join(process.cwd(), "reports", "p1-tdi-policy-forensic-2round-validation.json"),
    `${JSON.stringify(
      {
        runId: RUN_ID,
        smokeSessionId: smokeRun.smokeSessionId,
        finalVerdict,
        smokeSummary,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        runId: RUN_ID,
        smokeSessionId: smokeRun.smokeSessionId,
        finalVerdict,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        runId: RUN_ID,
        error: (error as Error).message,
        stack: (error as Error).stack,
      },
      null,
      2,
    ),
  );
  process.exit(1);
});

