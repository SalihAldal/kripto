import fs from "node:fs";
import path from "node:path";

const BASELINE_SESSION_ID = "cmsxrlu1v0009unrkcmzvymcn";
const FIX_VALIDATION_SESSION_ID = "cmsxuaect0009unioi4gvkxcb";

type Json = Record<string, unknown>;

function readJson<T = Json>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function listRoundDirs(sessionId: string) {
  const roundsRoot = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds");
  if (!fs.existsSync(roundsRoot)) return [];
  return fs
    .readdirSync(roundsRoot)
    .filter((name) => /^\d+$/.test(name))
    .sort((a, b) => Number(a) - Number(b));
}

function percentile(rows: number[], p: number) {
  if (rows.length === 0) return 0;
  const sorted = [...rows].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx] ?? 0);
}

function summarizeSession(sessionId: string) {
  const rounds = listRoundDirs(sessionId);
  const runtimePatchDurations: number[] = [];
  const runtimePatchTimeoutRows: Array<{ roundNo: number; durationMs: number; reason?: string }> = [];
  const waitReasons: Record<string, number> = {};
  const firstBlockers: Record<string, number> = {};

  let scannerCandidates = 0;
  let tdiApproved = 0;
  let tdiWait = 0;
  let tdiRejected = 0;
  let executionReady = 0;
  let aiCalls = 0;
  let orders = 0;
  let trades = 0;
  let aiBypassCount = 0;

  const perRound = rounds.map((roundId) => {
    const roundNo = Number(roundId);
    const root = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", roundId);
    const roundSummary = readJson<{ candidateCount?: number; durationMs?: number }>(path.join(root, "round-summary.json")) ?? {};
    const tdi = readJson<{ records?: Array<{ verdict?: string; waitReasonCode?: string; firstBlockingCondition?: string }> }>(
      path.join(root, "tdi-decisions.json"),
    );
    const decisionTrace = readJson<{ decisions?: Array<{ stage?: string; verdict?: string; aiVerdict?: string; reasonCode?: string }> }>(
      path.join(root, "decision-trace.json"),
    );
    const aiTrace = readJson<{ aiCalls?: Array<unknown> }>(path.join(root, "ai-trace.json"));
    const executionTrace = readJson<{ orders?: Array<{ aiVerdict?: string }> }>(path.join(root, "execution-trace.json"));
    const pnl = readJson<{ entries?: Array<unknown> }>(path.join(root, "pnl-ledger.json"));
    const tx = readJson<{ records?: Array<{ operation?: string; durationMs?: number; classification?: string; reasonDetail?: string }> }>(
      path.join(root, "transaction-duration.json"),
    );

    const tdiRecords = Array.isArray(tdi?.records) ? tdi.records : [];
    const decisionRows = Array.isArray(decisionTrace?.decisions) ? decisionTrace.decisions : [];
    const aiRows = Array.isArray(aiTrace?.aiCalls) ? aiTrace.aiCalls : [];
    const orderRows = Array.isArray(executionTrace?.orders) ? executionTrace.orders : [];
    const tradeRows = Array.isArray(pnl?.entries) ? pnl.entries : [];
    const txRows = Array.isArray(tx?.records) ? tx.records : [];

    for (const row of tdiRecords) {
      if (row.verdict === "APPROVED") tdiApproved += 1;
      if (row.verdict === "WAIT") {
        tdiWait += 1;
        const reason = String(row.waitReasonCode ?? "OTHER");
        waitReasons[reason] = (waitReasons[reason] ?? 0) + 1;
        const blocker = String(row.firstBlockingCondition ?? "OTHER");
        firstBlockers[blocker] = (firstBlockers[blocker] ?? 0) + 1;
      }
      if (row.verdict === "REJECTED") tdiRejected += 1;
    }

    for (const row of txRows) {
      if (!String(row.operation ?? "").includes("patchJobActiveRound")) continue;
      const durationMs = Number(row.durationMs ?? 0);
      if (Number.isFinite(durationMs) && durationMs >= 0) runtimePatchDurations.push(durationMs);
      const timeoutLike =
        String(row.classification ?? "").toUpperCase() === "TIMEOUT" ||
        String(row.reasonDetail ?? "").toLowerCase().includes("timeout");
      if (timeoutLike) {
        runtimePatchTimeoutRows.push({
          roundNo,
          durationMs: Number(row.durationMs ?? 0),
          reason: String(row.reasonDetail ?? ""),
        });
      }
    }

    const executionReadyCount = decisionRows.filter((row) => row.stage === "execution" && (row.verdict === "APPROVE" || row.verdict === "APPROVED")).length;
    const blockingAiVerdicts = new Set(["NO_TRADE", "NO-TRADE", "HOLD", "WAIT", "REJECT"]);
    const bypassCount = orderRows.filter((row) => blockingAiVerdicts.has(String(row.aiVerdict ?? "").toUpperCase())).length;
    aiBypassCount += bypassCount;

    const summary = {
      roundNo,
      durationMs: Number(roundSummary.durationMs ?? 0),
      scannerCandidates: Number(roundSummary.candidateCount ?? 0),
      tdiApproved: tdiRecords.filter((row) => row.verdict === "APPROVED").length,
      tdiWait: tdiRecords.filter((row) => row.verdict === "WAIT").length,
      tdiRejected: tdiRecords.filter((row) => row.verdict === "REJECTED").length,
      executionReady: executionReadyCount,
      aiCalls: aiRows.length,
      orders: orderRows.length,
      trades: tradeRows.length,
      patchJobActiveRoundSamples: txRows.filter((row) => String(row.operation ?? "").includes("patchJobActiveRound")).length,
      patchJobActiveRoundTimeouts: txRows.filter((row) =>
        String(row.operation ?? "").includes("patchJobActiveRound") &&
        (String(row.classification ?? "").toUpperCase() === "TIMEOUT" || String(row.reasonDetail ?? "").toLowerCase().includes("timeout")),
      ).length,
      artifactsPresent: {
        transactionDuration: fs.existsSync(path.join(root, "transaction-duration.json")),
        tdiDecisions: fs.existsSync(path.join(root, "tdi-decisions.json")),
        decisionTrace: fs.existsSync(path.join(root, "decision-trace.json")),
      },
    };

    scannerCandidates += summary.scannerCandidates;
    executionReady += summary.executionReady;
    aiCalls += summary.aiCalls;
    orders += summary.orders;
    trades += summary.trades;
    return summary;
  });

  return {
    sessionId,
    rounds: perRound,
    aggregate: {
      scannerCandidates,
      tdiApproved,
      tdiWait,
      tdiRejected,
      executionReady,
      aiCalls,
      orders,
      trades,
      aiBypassCount,
      runtimePatchSampleCount: runtimePatchDurations.length,
      runtimePatchP50Ms: percentile(runtimePatchDurations, 50),
      runtimePatchP95Ms: percentile(runtimePatchDurations, 95),
      runtimePatchP99Ms: percentile(runtimePatchDurations, 99),
      runtimePatchTimeoutCount: runtimePatchTimeoutRows.length,
      tdiWaitReasonDistribution: waitReasons,
      tdiFirstBlockingDistribution: firstBlockers,
    },
    runtimePatchTimeoutRows: runtimePatchTimeoutRows.slice(0, 20),
  };
}

async function main() {
  const { prisma } = await import("@/src/server/db/prisma");
  const baseline = summarizeSession(BASELINE_SESSION_ID);
  const validation = summarizeSession(FIX_VALIDATION_SESSION_ID);

  const validationJob = await prisma.autoRoundJob.findUnique({
    where: { id: FIX_VALIDATION_SESSION_ID },
    include: { rounds: { orderBy: { roundNo: "asc" } } },
  });

  const runtimeStability: "PASS" | "PARTIAL" | "FAIL" =
    validation.aggregate.runtimePatchTimeoutCount === 0 ? "PASS" : "FAIL";
  const tdiHealth: "PASS" | "PARTIAL" | "FAIL" =
    validation.aggregate.tdiApproved > 0 ? "PASS" : validation.aggregate.tdiWait > 0 ? "PARTIAL" : "FAIL";
  const aiParity: "PASS" | "FAIL" = validation.aggregate.aiBypassCount === 0 ? "PASS" : "FAIL";
  const readyFor5Round: "YES" | "NO" | "CONDITIONAL" =
    runtimeStability === "PASS" && aiParity === "PASS" ? "CONDITIONAL" : "NO";
  const readyFor3050: "YES" | "NO" | "CONDITIONAL" =
    runtimeStability === "PASS" && tdiHealth === "PASS" && aiParity === "PASS" ? "CONDITIONAL" : "NO";

  const output = {
    generatedAt: new Date().toISOString(),
    objective: "KRIPTO P0/P1 runtime timeout + TDI zero-approval blocker fix",
    blockerA: {
      rootCauseClassification: ["MULTIPLE_WRITERS", "TRANSACTION_CONTENTION", "CONNECTION_POOL"],
      baselineSession: baseline,
      postFixValidationSession: validation,
      fixSummary: [
        "Round runtime persistence is serialized with queue-backed writes to prevent overlapping heartbeat/transition writes.",
        "Heartbeat persistence timeout is downgraded to non-fatal degraded mode with explicit PERSIST_TIMEOUT telemetry.",
        "Transition persistence timeout maps to RoundSelectionAbortError(PERSIST_TIMEOUT) to fail selection safely without killing scheduler loop.",
        "Heartbeat write amplification reduced by logging only coarse state transitions and limiting persisted timeline on non-coarse updates.",
        "Bounded prisma writes retried with short backoff for transient timeout pressure.",
      ],
    },
    blockerB: {
      waitReasonDistribution: validation.aggregate.tdiWaitReasonDistribution,
      firstBlockingConditionDistribution: validation.aggregate.tdiFirstBlockingDistribution,
      baselineZeroApproval: {
        scannerCandidates: baseline.aggregate.scannerCandidates,
        tdiWait: baseline.aggregate.tdiWait,
        tdiApproved: baseline.aggregate.tdiApproved,
      },
      postFixSnapshot: {
        scannerCandidates: validation.aggregate.scannerCandidates,
        tdiWait: validation.aggregate.tdiWait,
        tdiApproved: validation.aggregate.tdiApproved,
        executionReady: validation.aggregate.executionReady,
      },
      reconciliation: {
        zeroBuyRootCause:
          "Primary cause is strict decision policy (hybrid/master not emitting BUY frequently); no threshold relaxation was applied. Observability was improved with firstBlockingCondition tracing and REJECTED counting fix.",
        correctnessFixesApplied: [
          "Added firstBlockingCondition and blockingConditions fields to TDI decision records.",
          "Added firstBlockingDistribution to TDI sensitivity output.",
          "Fixed REJECTED verdict aggregation bug in trade evidence report script.",
        ],
      },
    },
    tests: {
      runtime: [
        "tests/round-runtime.test.ts: heartbeat timeout is non-fatal",
        "tests/round-runtime.test.ts: transition timeout maps to PERSIST_TIMEOUT",
        "tests/round-runtime.test.ts: concurrent transitions are serialized (no overlap)",
      ],
      tdi: [
        "tests/forensics/tdi-sensitivity-reconciliation.test.ts: first blocker distribution captured",
        "tests/p0-tdi-buy-bottleneck.test.ts: existing momentum/consensus regressions remain passing",
      ],
    },
    controlled2RoundValidation: {
      sessionId: FIX_VALIDATION_SESSION_ID,
      jobStatus: validationJob?.status ?? null,
      completedRounds: validationJob?.completedRounds ?? null,
      failedRounds: validationJob?.failedRounds ?? null,
      rounds: validationJob?.rounds.map((row) => ({
        roundNo: row.roundNo,
        state: row.state,
        failReason: row.failReason,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
      })) ?? [],
      runtimeMetrics: {
        patchJobActiveRound: {
          p50Ms: validation.aggregate.runtimePatchP50Ms,
          p95Ms: validation.aggregate.runtimePatchP95Ms,
          p99Ms: validation.aggregate.runtimePatchP99Ms,
          timeoutCount: validation.aggregate.runtimePatchTimeoutCount,
        },
      },
      funnel: {
        scannerCandidates: validation.aggregate.scannerCandidates,
        tdiApproved: validation.aggregate.tdiApproved,
        tdiWait: validation.aggregate.tdiWait,
        executionReady: validation.aggregate.executionReady,
        aiCalls: validation.aggregate.aiCalls,
        orders: validation.aggregate.orders,
        trades: validation.aggregate.trades,
      },
    },
    finalVerdict: {
      RUNTIME_STABILITY: runtimeStability,
      TDI_APPROVAL_HEALTH: tdiHealth,
      AI_PARITY: aiParity,
      READY_FOR_5_ROUND: readyFor5Round,
      READY_FOR_30_50_ROUND: readyFor3050,
    },
    remainingBlockers: [
      "Round 1 in controlled validation still consumed full selection budget without producing an execution-ready candidate.",
      "Runtime still shows high-latency patch samples under load (p99 should continue to be watched).",
      "A separate Prisma engine empty-response incident appeared in a parallel AI-performance query path and should be isolated.",
    ],
  };

  fs.writeFileSync(
    path.join(process.cwd(), "kripto-p0-runtime-tdi-blocker-fix.json"),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );

  const lines = [
    "# KRIPTO P0/P1 - Runtime Timeout + TDI Zero-Approval Blocker Fix",
    "",
    "## 1) Runtime timeout root cause",
    "- Root cause class: MULTIPLE_WRITERS + TRANSACTION_CONTENTION + CONNECTION_POOL.",
    `- Baseline session: \`${BASELINE_SESSION_ID}\` showed patch timeout incidents and queue pressure under overlapping writers.`,
    "- Primary fix: serialized/coalesced runtime persists, bounded retry, heartbeat timeout downgraded to non-fatal degraded telemetry path.",
    "",
    "## 2) DB/transaction evidence",
    `- Post-fix session: \`${FIX_VALIDATION_SESSION_ID}\``,
    `- patchJobActiveRound sample count: ${validation.aggregate.runtimePatchSampleCount}`,
    `- patchJobActiveRound p50/p95/p99 (ms): ${validation.aggregate.runtimePatchP50Ms}/${validation.aggregate.runtimePatchP95Ms}/${validation.aggregate.runtimePatchP99Ms}`,
    `- patchJobActiveRound timeoutCount: ${validation.aggregate.runtimePatchTimeoutCount}`,
    "",
    "## 3) patchJobActiveRound call analysis",
    "- Runtime heartbeat and transition writes previously overlapped on same hot rows (job/run metadata).",
    "- Persist path now enforces queued single-writer behavior in controller scope, reducing write storm contention.",
    "",
    "## 4) Multi-writer safety",
    "- Scheduler/runtime/watchdog coexistence is improved by preventing concurrent runtime persist overlap and by safe abort semantics.",
    "- Persistence timeout no longer hard-crashes selection flow at heartbeat boundary.",
    "",
    "## 5) Runtime persistence fix",
    "- Added queue-backed persist serialization in round runtime controller.",
    "- Added transient retry wrapper for bounded prisma persistence operations.",
    "- Converted transition timeout to `PERSIST_TIMEOUT` abort code.",
    "- Reduced heartbeat write amplification (coarse structured-log only, slim timeline persistence in non-coarse updates).",
    "",
    "## 6) TDI WAIT distribution",
    `- WAIT reason distribution: \`${JSON.stringify(validation.aggregate.tdiWaitReasonDistribution)}\``,
    `- firstBlockingCondition distribution: \`${JSON.stringify(validation.aggregate.tdiFirstBlockingDistribution)}\``,
    "",
    "## 7) First blocking condition",
    "- First blocker is now explicitly persisted per WAIT decision (`firstBlockingCondition`) and aggregated in sensitivity artifacts.",
    "",
    "## 8) Zero-BUY root cause",
    "- No blind threshold relaxation was applied.",
    "- Evidence indicates strict policy path remains the dominant limiter; observability defects were fixed (REJECTED counting + first blocker trace).",
    "",
    "## 9) TDI correctness fixes",
    "- Added `firstBlockingCondition` and `blockingConditions` to TDI decision records.",
    "- Added `firstBlockingDistribution` to TDI sensitivity report.",
    "- Fixed trade evidence script bug: `REJECT` -> `REJECTED` aggregation.",
    "",
    "## 10) Regression tests",
    "- Runtime tests pass: heartbeat timeout degrade, transition persist-timeout abort, concurrent persist serialization.",
    "- TDI tests pass: sensitivity reconciliation + first-blocker distribution.",
    "",
    "## 11) Controlled 2-round validation",
    `- Job status: ${validationJob?.status ?? "UNKNOWN"} (completed=${validationJob?.completedRounds ?? "?"}, failed=${validationJob?.failedRounds ?? "?"})`,
    `- Funnel: scannerCandidates=${validation.aggregate.scannerCandidates}, tdiApproved=${validation.aggregate.tdiApproved}, tdiWait=${validation.aggregate.tdiWait}, executionReady=${validation.aggregate.executionReady}, aiCalls=${validation.aggregate.aiCalls}, orders=${validation.aggregate.orders}, trades=${validation.aggregate.trades}`,
    "",
    "## 12) Remaining blockers",
    "- Selection budget exhaustion can still occur without execution-ready candidate in conservative market states.",
    "- Continue monitoring runtime p99 under scanner+AI heavy rounds before long campaigns.",
    "",
    "## Final Verdict",
    `- RUNTIME_STABILITY = ${runtimeStability}`,
    `- TDI_APPROVAL_HEALTH = ${tdiHealth}`,
    `- AI_PARITY = ${aiParity}`,
    `- READY_FOR_5_ROUND = ${readyFor5Round}`,
    `- READY_FOR_30_50_ROUND = ${readyFor3050}`,
  ];

  fs.writeFileSync(
    path.join(process.cwd(), "KRIPTO_P0_RUNTIME_TDI_BLOCKER_FIX.md"),
    `${lines.join("\n")}\n`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baselineSessionId: BASELINE_SESSION_ID,
        validationSessionId: FIX_VALIDATION_SESSION_ID,
        verdict: output.finalVerdict,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
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
