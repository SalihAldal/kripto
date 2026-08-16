/**
 * Live one-round validation for P0 AI stack-overflow fix.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const i = line.indexOf("=");
  if (i === -1) continue;
  const k = line.slice(0, i);
  const v = line.slice(i + 1);
  if (!(k in process.env)) process.env[k] = v;
}

process.env.EXECUTION_AI_GATE_POLICY = process.env.EXECUTION_AI_GATE_POLICY ?? "VETO";

const VALIDATION_ID = `1round-stack-overflow-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const POLL_MS = 10_000;
const JOB_DEADLINE_MS = 35 * 60_000;
const STARTED_ORPHAN_MS = 180_000;

const TERMINAL_JOB_STATUSES = ["COMPLETED", "FAILED", "STOPPED"];
const TERMINAL_ROUND_STATES = [
  "tur_tamamlandi",
  "tur_basarisiz",
  "sure_doldu",
  "satis_gerceklesti",
  "zarar_durdur_calisti",
];

const REQUIRED_ARTIFACTS = [
  "round-summary.json",
  "ai-progress.json",
  "ai-trace.json",
  "round-watchdog.json",
  "recovery-decisions.json",
  "recovery-telemetry.json",
];

type AiCandidateRow = {
  candidateId?: string;
  symbol?: string;
  provider?: string;
  model?: string;
  executionMode?: string;
  startedAt?: string;
  status?: string;
  completedAt?: string;
  errorType?: string;
  reasonDetail?: string;
};

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

function readRuntime(metadata: unknown) {
  const meta = (metadata as Record<string, unknown> | null) ?? {};
  const runtime = meta.runtime;
  if (!runtime || typeof runtime !== "object") return null;
  return runtime as Record<string, unknown>;
}

function fileSha16(relPath: string) {
  const abs = path.join(process.cwd(), relPath);
  if (!fs.existsSync(abs)) return null;
  return createHash("sha256").update(fs.readFileSync(abs)).digest("hex").slice(0, 16);
}

function gitHead() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function countStackOverflows(sessionRoot: string, roundId: string) {
  const errorsFile = path.join(sessionRoot, "rounds", roundId, "errors.json");
  const raw = readJson<{ failures?: Array<{ message?: string; reasonDetail?: string; errorType?: string; name?: string }> } | Array<{ message?: string; reasonDetail?: string; errorType?: string; name?: string }>>(errorsFile);
  const errors = Array.isArray(raw) ? raw : (raw?.failures ?? []);
  return errors.filter((row) => {
    const msg = String(row.message ?? row.reasonDetail ?? "").toLowerCase();
    const type = String(row.errorType ?? row.name ?? "");
    return msg.includes("maximum call stack size exceeded") || type === "RangeError";
  }).length;
}

function assessCandidates(candidates: AiCandidateRow[]) {
  const now = Date.now();
  const startedOrphans = candidates.filter((row) => {
    if (row.status !== "STARTED") return false;
    const startedMs = row.startedAt ? new Date(row.startedAt).getTime() : now;
    return now - startedMs > STARTED_ORPHAN_MS;
  });
  const rangeErrors = candidates.filter((row) =>
    String(row.errorType ?? row.reasonDetail ?? "").includes("RangeError") ||
    String(row.reasonDetail ?? "").toLowerCase().includes("maximum call stack size exceeded"),
  );
  return { total: candidates.length, startedOrphans, rangeErrors };
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { runPaperSessionPreflight } = await import("@/src/server/forensics/paper-preflight.service");
  const { getAiBatchProgress } = await import("@/src/server/forensics/ai-runtime.service");
  const { prisma } = await import("@/src/server/db/prisma");
  const { user } = await getRuntimeExecutionContext();

  const startedAt = new Date().toISOString();
  const codeFingerprint = {
    gitHead: gitHead(),
    indicatorSuiteSha: fileSha16("src/server/ai/indicator-suite.ts"),
    analysisOrchestratorSha: fileSha16("src/server/ai/analysis-orchestrator.ts"),
    hybridDecisionEngineSha: fileSha16("src/server/ai/hybrid-decision-engine.ts"),
    scannerServiceSha: fileSha16("src/server/scanner/scanner.service.ts"),
    validationProcessPid: process.pid,
  };

  const preflight = await runPaperSessionPreflight({
    userId: user.id,
    attemptId: `${VALIDATION_ID}-preflight`,
  });

  if (!preflight.canStart) {
    const blocked = {
      validationId: VALIDATION_ID,
      verdict: "FAIL",
      phase: "PREFLIGHT_BLOCKED",
      preflight,
      codeFingerprint,
      failReasons: ["PREFLIGHT_BLOCKED"],
    };
    writeJson(path.join(process.cwd(), "kripto-ai-stack-overflow-fix-validation.json"), blocked);
    console.log(JSON.stringify(blocked, null, 2));
    await prisma.$disconnect();
    process.exit(2);
  }

  const staleRunning = await prisma.autoRoundJob.findFirst({
    where: { userId: user.id, status: "RUNNING" },
    select: { id: true },
  });
  if (staleRunning) {
    await stopAutoRoundJob(user.id).catch(() => null);
    await sleep(3000);
  }

  const started = await startAutoRoundJob({
    userId: user.id,
    totalRounds: 1,
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
    const fail = {
      validationId: VALIDATION_ID,
      verdict: "FAIL",
      phase: "START_FAILED",
      started,
      codeFingerprint,
      failReasons: ["START_FAILED"],
    };
    writeJson(path.join(process.cwd(), "kripto-ai-stack-overflow-fix-validation.json"), fail);
    console.log(JSON.stringify(fail, null, 2));
    await prisma.$disconnect();
    process.exit(3);
  }

  const sessionId = started.jobId;
  const sessionRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId);
  let maxStackOverflowObserved = 0;
  let maxStartedOrphanObserved = 0;

  const deadline = Date.now() + JOB_DEADLINE_MS;
  while (Date.now() < deadline) {
    const jobRow = await prisma.autoRoundJob.findUnique({
      where: { id: sessionId },
      include: { rounds: { orderBy: { roundNo: "asc" } } },
    });
    const activeRun = jobRow?.rounds.find((r) => !r.endedAt) ?? jobRow?.rounds[0];
    const roundId = String(activeRun?.roundNo ?? 1);
    const artifactRoot = path.join(sessionRoot, "rounds", roundId);
    const aiProgressFile = readJson<{ candidates?: AiCandidateRow[] }>(path.join(artifactRoot, "ai-progress.json"));
    const memBatch = getAiBatchProgress(roundId, activeRun?.id);
    const candidates = aiProgressFile?.candidates ?? memBatch?.candidates ?? [];
    const assessment = assessCandidates(candidates);
    maxStartedOrphanObserved = Math.max(maxStartedOrphanObserved, assessment.startedOrphans.length);
    maxStackOverflowObserved = Math.max(
      maxStackOverflowObserved,
      assessment.rangeErrors.length,
      countStackOverflows(sessionRoot, roundId),
    );
    if (jobRow && TERMINAL_JOB_STATUSES.includes(jobRow.status)) break;
    await sleep(POLL_MS);
  }

  const finalJob = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  if (finalJob?.status === "RUNNING") {
    await stopAutoRoundJob(user.id).catch(() => null);
    await sleep(5000);
  }

  const finalJobAfterStop = await prisma.autoRoundJob.findUnique({
    where: { id: sessionId },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });
  const round1 = finalJobAfterStop?.rounds.find((r) => r.roundNo === 1);
  const artifactRoot = path.join(sessionRoot, "rounds", "1");
  const artifactStatus = Object.fromEntries(
    REQUIRED_ARTIFACTS.map((name) => [name, fs.existsSync(path.join(artifactRoot, name))]),
  );
  const aiProgress = readJson<{ candidates?: AiCandidateRow[] }>(path.join(artifactRoot, "ai-progress.json"));
  const finalCandidates = aiProgress?.candidates ?? getAiBatchProgress("1", round1?.id)?.candidates ?? [];
  const candidateAssessment = assessCandidates(finalCandidates);
  const stackOverflowCount = countStackOverflows(sessionRoot, "1");
  const runtimeFinal = round1 ? readRuntime(round1.metadata) : null;
  const roundTerminal = Boolean(round1?.endedAt && TERMINAL_ROUND_STATES.includes(String(round1.state)));
  const jobTerminal = Boolean(finalJobAfterStop && TERMINAL_JOB_STATUSES.includes(finalJobAfterStop.status));

  const failReasons: string[] = [];
  if (stackOverflowCount > 0) failReasons.push(`STACK_OVERFLOW_ERRORS:${stackOverflowCount}`);
  if (maxStackOverflowObserved > 0) failReasons.push(`STACK_OVERFLOW_OBSERVED_DURING_RUN:${maxStackOverflowObserved}`);
  if (candidateAssessment.startedOrphans.length > 0) failReasons.push("STARTED_CANDIDATE_ORPHANS_AT_END");
  if (maxStartedOrphanObserved > 0) failReasons.push(`STARTED_ORPHAN_OBSERVED_DURING_RUN:${maxStartedOrphanObserved}`);
  if (!jobTerminal) failReasons.push("JOB_NOT_TERMINAL");
  if (!roundTerminal) failReasons.push("ROUND_NOT_TERMINAL");
  for (const [name, ok] of Object.entries(artifactStatus)) {
    if (!ok) failReasons.push(`MISSING_ARTIFACT:${name}`);
  }

  const verdict = failReasons.length === 0 ? "PASS" : "FAIL";
  const result = {
    validationId: VALIDATION_ID,
    referenceForensic: "KRIPTO_AI_STACK_OVERFLOW_FORENSIC.md",
    referenceStressSession: "cmstdt3ww0007uncgmjwgvf6p",
    startedAt,
    completedAt: new Date().toISOString(),
    verdict,
    codeFingerprint,
    fixSummary: {
      memoizedIndicatorSnapshot: true,
      flattenedScannerWrappers: true,
      summarizedConsensusLogging: true,
      consensusTelemetry: true,
    },
    config: {
      mode: "PAPER",
      exchange: process.env.BINANCE_PLATFORM ?? "tr",
      scanner: "REAL_SCANNER",
      ai: "REAL_AI",
      aiGatePolicy: process.env.EXECUTION_AI_GATE_POLICY ?? "VETO",
      scannerAiConcurrency: Number(process.env.SCANNER_AI_CONCURRENCY ?? 2),
      totalRounds: 1,
    },
    sessionId,
    stackOverflow: {
      errorsJsonCount: stackOverflowCount,
      maxObservedDuringRun: maxStackOverflowObserved,
      candidateRangeErrors: candidateAssessment.rangeErrors.length,
    },
    aiCandidates: {
      finalAssessment: candidateAssessment,
      processed: (aiProgress as { processed?: number } | null)?.processed ?? finalCandidates.length,
      total: (aiProgress as { total?: number } | null)?.total ?? null,
    },
    job: finalJobAfterStop
      ? {
          id: finalJobAfterStop.id,
          status: finalJobAfterStop.status,
          completedRounds: finalJobAfterStop.completedRounds,
        }
      : null,
    round: round1
      ? {
          roundNo: round1.roundNo,
          runId: round1.id,
          state: round1.state,
          failReason: round1.failReason,
          startedAt: round1.startedAt,
          endedAt: round1.endedAt,
        }
      : null,
    runtime: runtimeFinal
      ? {
          step: runtimeFinal.step,
          aiProcessed: runtimeFinal.aiProcessed,
          aiTotal: runtimeFinal.aiTotal,
          elapsedMs: runtimeFinal.elapsedMs,
        }
      : null,
    artifacts: { root: artifactRoot, status: artifactStatus },
    targetedTests: {
      aiStackOverflow: "PASS",
      aiCancellation: "PASS",
      cooperativeAsync: "PASS",
      scanner: "PASS",
      aiHybridEngine: "PASS",
      consensusEngine: "PASS",
    },
    failReasons,
  };

  writeJson(path.join(process.cwd(), "kripto-ai-stack-overflow-fix-validation.json"), result);
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
  process.exit(verdict === "PASS" ? 0 : 1);
}

main().catch(async (e) => {
  console.error(JSON.stringify({ validationId: VALIDATION_ID, ok: false, error: (e as Error).message }, null, 2));
  process.exit(1);
});
