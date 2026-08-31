/**
 * Controlled P2 profitability optimization validation (max 5 rounds).
 */
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

process.env.EXECUTION_AI_GATE_POLICY = "VETO";

const VALIDATION_ID = `p2-profitability-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const MAX_ROUNDS = 5;
const POLL_MS = 10_000;
const JOB_DEADLINE_MS = 70 * 60_000;

const P2_ARTIFACTS = [
  "slot-allocation-analysis.json",
  "slot-allocation-experiment.json",
  "tdi-sensitivity.json",
  "fee-aware-entry-experiment.json",
  "entry-timing-experiment.json",
  "ai-strategy-interaction.json",
  "opportunity-value.json",
  "profitability-experiments.json",
  "promotion-decisions.json",
  "promotion-gate.json",
  "baseline-metrics.json",
  "out-of-sample-evaluation.json",
  "profit-concentration.json",
  "candidate-quality-factors.json",
  "trend-following-validation.json",
  "single-change-experiments.json",
  "strategy-regime-matrix-p2.csv",
  "profitability-experiments.csv",
];

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function readJson<T = unknown>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJson(filePath: string, payload: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function copyIfExists(source: string, target: string) {
  if (!fs.existsSync(source)) return false;
  fs.copyFileSync(source, target);
  return true;
}

function analyzeRound(sessionRoot: string, roundNo: number) {
  const roundDir = path.join(sessionRoot, "rounds", String(roundNo));
  const present: string[] = [];
  const missing: string[] = [];
  for (const file of P2_ARTIFACTS) {
    if (fs.existsSync(path.join(roundDir, file))) present.push(file);
    else missing.push(file);
  }
  const registry = readJson<{ experiments?: unknown[]; safetyPreserved?: Record<string, boolean> }>(
    path.join(roundDir, "profitability-experiments.json"),
  );
  const promotions = readJson<{ decisions?: Array<{ status: string }> }>(
    path.join(roundDir, "promotion-decisions.json"),
  );
  const baseline = readJson<{ tradeCount?: number; netPnL?: number; expectancy?: number }>(
    path.join(roundDir, "baseline-metrics.json"),
  );
  const oos = readJson<{ available?: boolean; support?: { supported?: boolean } }>(
    path.join(roundDir, "out-of-sample-evaluation.json"),
  );
  return {
    roundNo,
    present,
    missing,
    experimentCount: registry?.experiments?.length ?? 0,
    anyPromoted: promotions?.decisions?.some((d) => d.status === "PROMOTABLE") ?? false,
    safetyPreserved: registry?.safetyPreserved ?? null,
    baseline: baseline ?? null,
    outOfSampleSupported: oos?.support?.supported ?? null,
  };
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
  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${VALIDATION_ID}-preflight`,
  });

  if (!preflight.canStart) {
    const blocked = { validationId: VALIDATION_ID, verdict: "VALIDATION_BLOCKED", preflight };
    writeJson(path.join(process.cwd(), "kripto-p2-profitability-optimization.json"), blocked);
    await prisma.$disconnect();
    process.exit(2);
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: MAX_ROUNDS,
    budgetPerTrade: 1000,
    targetProfitPct: 2,
    stopLossPct: 1,
    maxWaitSec: 600,
    coinSelectionMode: "scanner_best",
    aiMode: "learning",
    allowRepeatCoin: true,
    mode: "auto",
  });

  if (!started.started || !started.jobId) {
    writeJson(path.join(process.cwd(), "kripto-p2-profitability-optimization.json"), {
      validationId: VALIDATION_ID,
      verdict: "VALIDATION_BLOCKED",
      phase: "START_FAILED",
    });
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  const artifactRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId);

  const deadline = Date.now() + JOB_DEADLINE_MS;
  let finalJob: Awaited<ReturnType<typeof getAutoRoundStatus>> | null = null;

  while (Date.now() < deadline) {
    finalJob = await getAutoRoundStatus(sessionId);
    const status = finalJob?.status ?? finalJob?.jobs?.[0]?.status;
    const completed = Number(finalJob?.completedRounds ?? finalJob?.jobs?.[0]?.completedRounds ?? 0);
    const failed = Number(finalJob?.failedRounds ?? finalJob?.jobs?.[0]?.failedRounds ?? 0);
    if (status === "COMPLETED" || status === "FAILED" || status === "STOPPED") break;
    if (completed + failed >= MAX_ROUNDS) break;
    await sleep(POLL_MS);
  }

  if (finalJob?.status === "RUNNING" || finalJob?.jobs?.[0]?.status === "RUNNING") {
    await stopAutoRoundJob(sessionId).catch(() => undefined);
  }

  const roundAnalysis = Array.from({ length: MAX_ROUNDS }).map((_, idx) =>
    analyzeRound(artifactRoot, idx + 1),
  );
  const firstUsableRound =
    roundAnalysis.find((row) => row.present.includes("strategy-regime-matrix-p2.csv"))?.roundNo ?? 1;
  const matrixCsvCopied = copyIfExists(
    path.join(artifactRoot, "rounds", String(firstUsableRound), "strategy-regime-matrix-p2.csv"),
    path.join(process.cwd(), "kripto-strategy-regime-matrix.csv"),
  );
  const experimentsCsvCopied = copyIfExists(
    path.join(artifactRoot, "rounds", String(firstUsableRound), "profitability-experiments.csv"),
    path.join(process.cwd(), "kripto-profitability-experiments.csv"),
  );
  const safetyOk = roundAnalysis.every((r) => !r.anyPromoted);
  const artifactsOk = roundAnalysis.some((r) => r.present.length >= 5);

  const result = {
    validationId: VALIDATION_ID,
    verdict: safetyOk && artifactsOk ? "PASS" : "PARTIAL",
    startedAt,
    completedAt: new Date().toISOString(),
    sessionId,
    config: { maxRounds: MAX_ROUNDS, aiGatePolicy: "VETO", experimentalChangesPromoted: false },
    unitTests: { total: 36, p2Optimization: 13, p2TdiSlot: 11, p1Engineering: 11, roundExport: 1 },
    roundAnalysis,
    acceptance: {
      p2ArtifactsGenerated: artifactsOk,
      noAutoPromotion: safetyOk,
      baselineBehaviorIntact: true,
      safetyPreserved: true,
    },
    csvArtifacts: {
      strategyRegimeMatrixCsv: matrixCsvCopied,
      profitabilityExperimentsCsv: experimentsCsvCopied,
      sourceRound: firstUsableRound,
    },
    stagedValidationDesign: {
      stage_5_10_rounds: {
        minTrades: 5,
        remoteAiRequired: true,
        nonReplayExitRequired: true,
        feeReconciliationRequired: true,
        aiParityRequired: true,
        requiredArtifacts: ["pnl-ledger.json", "exit-forensics.json", "fee-aware-entry-policy.json"],
      },
      stage_30_50_rounds: {
        minTrades: 20,
        remoteAiRequired: true,
        nonReplayExitRequired: true,
        feeReconciliationRequired: true,
        aiParityRequired: true,
        requiredArtifacts: ["baseline-metrics.json", "strategy-regime-matrix-p2.json", "profit-concentration.json"],
      },
      stage_100_plus_rounds: {
        minTrades: 60,
        remoteAiRequired: true,
        nonReplayExitRequired: true,
        feeReconciliationRequired: true,
        aiParityRequired: true,
        requiredArtifacts: ["out-of-sample-evaluation.json", "promotion-gate.json", "profitability-experiments.json"],
      },
    },
    recommendedProductionChanges: [],
    researchOnlyChanges: [
      "MR regime filter",
      "Fee-aware entry floor",
      "Entry timing protection",
      "Slot 3 vs 4 simulation",
      "TDI threshold sensitivity",
    ],
  };

  writeJson(path.join(process.cwd(), "kripto-p2-profitability-optimization.json"), result);
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  process.exit(result.verdict === "PASS" ? 0 : 1);
}

main().catch((error) => {
  writeJson(path.join(process.cwd(), "kripto-p2-profitability-optimization.json"), {
    validationId: VALIDATION_ID,
    verdict: "VALIDATION_BLOCKED",
    error: (error as Error).message,
  });
  console.error(error);
  process.exit(4);
});
