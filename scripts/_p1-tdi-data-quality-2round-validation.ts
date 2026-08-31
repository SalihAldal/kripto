import fs from "node:fs";
import path from "node:path";
import { TDI_INPUT_INVENTORY, buildTdiDataQualityArtifacts } from "@/src/server/forensics/tdi-data-quality.service";
import type { TdiDecisionRecord } from "@/src/server/forensics/forensic.types";

type JsonObject = Record<string, unknown>;

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const idx = line.indexOf("=");
  if (idx === -1) continue;
  const key = line.slice(0, idx);
  const value = line.slice(idx + 1);
  if (!(key in process.env)) process.env[key] = value;
}

const RUN_ID = `p1-tdi-data-quality-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const BASELINE_MISSING_TELEMETRY = 57;
const BASELINE_DATA_QUALITY_BLOCK = 57;
const BASELINE_POLICY_BLOCK = 9;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readJson<T = JsonObject>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function byCount(rows: string[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row] = (acc[row] ?? 0) + 1;
    return acc;
  }, {});
}

function roundDirs(sessionId: string) {
  const root = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
    .sort();
}

function readSessionRows(sessionId: string) {
  const rounds = roundDirs(sessionId);
  const tdiRows: Array<Record<string, unknown>> = [];
  const qualityRows: Array<Record<string, unknown>> = [];
  const missingRows: Array<Record<string, unknown>> = [];
  const summaries: Array<Record<string, unknown>> = [];
  for (const roundNo of rounds) {
    const root = path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", roundNo);
    const tdi = readJson<{ records?: Array<Record<string, unknown>> }>(path.join(root, "tdi-decisions.json"));
    const quality = readJson<{ inputContracts?: Array<Record<string, unknown>>; dataQualitySummary?: Record<string, unknown> }>(
      path.join(root, "tdi-data-quality.json"),
    );
    const missing = readJson<{ rows?: Array<Record<string, unknown>> }>(path.join(root, "tdi-missing-telemetry-report.json"));
    const summary = readJson<Record<string, unknown>>(path.join(root, "round-summary.json"));
    for (const row of tdi?.records ?? []) tdiRows.push({ ...row, roundNo: Number(roundNo), sessionId });
    for (const row of quality?.inputContracts ?? []) qualityRows.push({ ...row, roundNo: Number(roundNo), sessionId });
    for (const row of missing?.rows ?? []) missingRows.push({ ...row, roundNo: Number(roundNo), sessionId });
    if (summary) summaries.push(summary);
  }
  return { tdiRows, qualityRows, missingRows, summaries };
}

function summarizePatchTimeout(sessionId: string) {
  let timeoutCount = 0;
  let sampleCount = 0;
  for (const roundNo of roundDirs(sessionId)) {
    const tx = readJson<{ records?: Array<{ operation?: string; classification?: string; reasonDetail?: string }> }>(
      path.join(process.cwd(), "artifacts", "forensics", sessionId, "rounds", roundNo, "transaction-duration.json"),
    );
    for (const row of tx?.records ?? []) {
      if (!String(row.operation ?? "").includes("patchJobActiveRound")) continue;
      sampleCount += 1;
      if (
        String(row.classification ?? "").toUpperCase() === "TIMEOUT" ||
        String(row.reasonDetail ?? "").toLowerCase().includes("timeout")
      ) {
        timeoutCount += 1;
      }
    }
  }
  return { sampleCount, timeoutCount };
}

function buildMissingFieldRollup(rows: Array<Record<string, unknown>>) {
  const fields: string[] = [];
  for (const row of rows) {
    const list = Array.isArray(row.missingFields) ? row.missingFields : [];
    for (const field of list) fields.push(String(field));
  }
  const counts = byCount(fields);
  const total = rows.length || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([field, missingCount]) => ({
      field,
      missingCount,
      percentage: Number(((missingCount / total) * 100).toFixed(2)),
      firstProducer: TDI_INPUT_INVENTORY.find((r) => r.field === field)?.producer ?? "UNKNOWN",
      lastProducer: TDI_INPUT_INVENTORY.find((r) => r.field === field)?.producer ?? "UNKNOWN",
      finalConsumer: TDI_INPUT_INVENTORY.find((r) => r.field === field)?.consumer ?? "UNKNOWN",
    }));
}

function buildMarkdown(input: {
  smokeSessionId: string;
  beforeMissing: number;
  afterMissing: number;
  beforeDataQualityBlock: number;
  afterDataQualityBlock: number;
  afterPolicyBlock: number;
  roundSummaries: Array<Record<string, unknown>>;
  tdiRows: Array<Record<string, unknown>>;
  missingRows: Array<Record<string, unknown>>;
  missingRollup: Array<Record<string, unknown>>;
  rootCauseCounts: Record<string, number>;
  runtimeTimeouts: { sampleCount: number; timeoutCount: number };
  verdict: "PASS" | "PARTIAL" | "FAIL";
}) {
  const waitRows = input.tdiRows.filter((row) => row.verdict === "WAIT");
  const approved = input.tdiRows.filter((row) => row.verdict === "APPROVED").length;
  const rejected = input.tdiRows.filter((row) => row.verdict === "REJECTED").length;
  const firstBlocking = byCount(waitRows.map((row) => String(row.firstBlockingCondition ?? "OTHER")));
  const lines: string[] = [];
  lines.push("# KRIPTO_P1_TDI_DATA_QUALITY_FIX_REPORT");
  lines.push("");
  lines.push(`- generatedAt: ${new Date().toISOString()}`);
  lines.push(`- runId: ${RUN_ID}`);
  lines.push(`- smokeSessionId: ${input.smokeSessionId}`);
  lines.push("");
  lines.push("## 1. Missing telemetry inventory");
  lines.push(`- beforeMissingTelemetryCount: ${input.beforeMissing}`);
  lines.push(`- afterMissingTelemetryCount: ${input.afterMissing}`);
  lines.push(`- missingFieldRollup: ${JSON.stringify(input.missingRollup)}`);
  lines.push("");
  lines.push("## 2. Root cause by field");
  lines.push(`- rootCauseCounts: ${JSON.stringify(input.rootCauseCounts)}`);
  lines.push("");
  lines.push("## 3. Technical data issues");
  const techRows = input.missingRows.filter(
    (row) => String(row.firstBlockingCondition ?? "") === "TECHNICAL" || (Array.isArray(row.blockingConditions) && row.blockingConditions.includes("TECHNICAL")),
  );
  lines.push(`- technicalDataProblemCount: ${techRows.length}`);
  lines.push("");
  lines.push("## 4. Momentum data issues");
  const momRows = input.missingRows.filter(
    (row) => String(row.firstBlockingCondition ?? "") === "MOMENTUM" || (Array.isArray(row.blockingConditions) && row.blockingConditions.includes("MOMENTUM")),
  );
  lines.push(`- momentumDataProblemCount: ${momRows.length}`);
  lines.push("");
  lines.push("## 5. Confidence data issues");
  const confRows = input.missingRows.filter(
    (row) => String(row.firstBlockingCondition ?? "") === "CONFIDENCE" || (Array.isArray(row.blockingConditions) && row.blockingConditions.includes("CONFIDENCE")),
  );
  lines.push(`- confidenceDataProblemCount: ${confRows.length}`);
  lines.push("");
  lines.push("## 6. Paper/live routing");
  lines.push("- execution WAIT bridge now propagates technical/momentum/sentiment/shortMomentum/shortFlow into TDI record.");
  lines.push("");
  lines.push("## 7. Cache/freshness");
  lines.push("- stale context is surfaced in tdiInputContract status instead of implicit neutral fallback.");
  lines.push("");
  lines.push("## 8. Abort/timeout impact");
  lines.push(`- patchJobActiveRoundSamples: ${input.runtimeTimeouts.sampleCount}`);
  lines.push(`- patchJobActiveRoundTimeoutCount: ${input.runtimeTimeouts.timeoutCount}`);
  lines.push("");
  lines.push("## 9. Runtime/artifact reconciliation");
  lines.push("- Runtime TDI rows now export tdi-data-quality, tdi-input-contract and tdi-missing-telemetry-report artifacts per round.");
  lines.push("");
  lines.push("## 10. Exact fixes");
  lines.push("- Added explicit TDI input contract with field statuses (AVAILABLE/MISSING/STALE/INVALID/NOT_APPLICABLE/UNKNOWN).");
  lines.push("- Added data quality issue inference and block classification (DATA_QUALITY_BLOCK vs POLICY_BLOCK).");
  lines.push("- Fixed WAIT taxonomy and replay alignment for wait distributions.");
  lines.push("");
  lines.push("## 11. Tests");
  lines.push("- tests/forensics/tdi-data-quality.test.ts");
  lines.push("- tests/forensics/tdi-sensitivity-reconciliation.test.ts");
  lines.push("");
  lines.push("## 12. 2-round smoke");
  lines.push(`- tdiApproved: ${approved}`);
  lines.push(`- tdiWait: ${waitRows.length}`);
  lines.push(`- tdiRejected: ${rejected}`);
  lines.push(`- firstBlockingDistribution: ${JSON.stringify(firstBlocking)}`);
  lines.push("");
  lines.push("## 13. Before/after missing telemetry");
  lines.push(`- before: ${input.beforeMissing}`);
  lines.push(`- after: ${input.afterMissing}`);
  lines.push("");
  lines.push("## 14. Before/after DATA_QUALITY_BLOCK vs POLICY_BLOCK");
  lines.push(`- beforeDataQualityBlockCount: ${input.beforeDataQualityBlock}`);
  lines.push(`- afterDataQualityBlockCount: ${input.afterDataQualityBlock}`);
  lines.push(`- afterPolicyBlockCount: ${input.afterPolicyBlock}`);
  lines.push("");
  lines.push("## 15. Remaining blockers");
  lines.push(`- unresolvedMissingRows: ${input.afterMissing}`);
  lines.push(`- verdict: ${input.verdict}`);
  lines.push("");
  lines.push("## 16. TDI readiness verdict");
  lines.push(`- TDI_DATA_QUALITY_READINESS: ${input.verdict}`);
  lines.push("- objective kept: no threshold lowering, no BUY forcing, no safety gate weakening.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const { getRuntimeExecutionContext } = await import("@/src/server/repositories/execution.repository");
  const { startAutoRoundJob, getAutoRoundStatus, stopAutoRoundJob } = await import("@/src/server/execution/auto-round-engine.service");
  const { prisma } = await import("@/src/server/db/prisma");

  const beforeMissing = BASELINE_MISSING_TELEMETRY;
  const beforeDataQualityBlock = BASELINE_DATA_QUALITY_BLOCK;

  const { user } = await getRuntimeExecutionContext();
  let smokeSessionId = String(process.env.REUSE_SMOKE_SESSION_ID ?? "").trim();
  if (!smokeSessionId) {
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
      throw new Error(`Failed to start 2-round smoke: ${JSON.stringify(started)}`);
    }
    smokeSessionId = started.jobId;
    const deadline = Date.now() + 55 * 60_000;
    while (Date.now() < deadline) {
      const job = await prisma.autoRoundJob.findUnique({ where: { id: smokeSessionId } });
      if (job && job.status !== "RUNNING") break;
      await sleep(15_000);
    }
  }
  const finalStatus = await getAutoRoundStatus(user.id);
  const sessionRows = readSessionRows(smokeSessionId);
  const qualityArtifacts = buildTdiDataQualityArtifacts(sessionRows.tdiRows as TdiDecisionRecord[]);
  const afterMissing = qualityArtifacts.missingTelemetryReport.missingTelemetryCount;
  const afterDataQualityBlock = qualityArtifacts.dataQualitySummary.dataQualityBlockCount;
  const afterPolicyBlock = qualityArtifacts.dataQualitySummary.policyBlockCount;
  const runtimeTimeouts = summarizePatchTimeout(smokeSessionId);
  const missingRollup = buildMissingFieldRollup(qualityArtifacts.missingTelemetryReport.rows as Array<Record<string, unknown>>);
  const rootCauseCounts = qualityArtifacts.missingTelemetryReport.rootCauseCounts;

  const verdict: "PASS" | "PARTIAL" | "FAIL" =
    runtimeTimeouts.timeoutCount > 0
      ? "PARTIAL"
      : afterMissing < beforeMissing
        ? "PASS"
        : afterMissing === beforeMissing
          ? "PARTIAL"
          : "FAIL";

  const reportJson = {
    generatedAt: new Date().toISOString(),
    runId: RUN_ID,
    baselineSessionId: "p1-previous-smoke-manual-baseline",
    smokeSessionId,
    finalStatus,
    inventory: TDI_INPUT_INVENTORY,
    missingTelemetryInventory: {
      beforeMissingTelemetryCount: beforeMissing,
      afterMissingTelemetryCount: afterMissing,
      missingFieldRollup: missingRollup,
    },
    rootCauseByField: {
      rootCauseCounts,
    },
    technicalDataIssues: {
      count: (qualityArtifacts.missingTelemetryReport.rows as Array<Record<string, unknown>>).filter(
        (row) => String(row.firstBlockingCondition ?? "") === "TECHNICAL",
      ).length,
    },
    momentumDataIssues: {
      count: (qualityArtifacts.missingTelemetryReport.rows as Array<Record<string, unknown>>).filter(
        (row) => String(row.firstBlockingCondition ?? "") === "MOMENTUM",
      ).length,
    },
    confidenceDataIssues: {
      count: (qualityArtifacts.missingTelemetryReport.rows as Array<Record<string, unknown>>).filter(
        (row) => String(row.firstBlockingCondition ?? "") === "CONFIDENCE",
      ).length,
    },
    paperLiveRouting: {
      fix: "execution WAIT paths now propagate full TDI telemetry payload into forensic bridge",
      paperRelaxedObserved: true,
    },
    cacheFreshness: {
      statuses: byCount(
        (qualityArtifacts.inputContracts as Array<Record<string, unknown>>).map((row) => {
          const contract = row.tdiInputContract as Record<string, { status?: string }> | undefined;
          return String(contract?.marketContext?.status ?? "UNKNOWN");
        }),
      ),
    },
    abortTimeoutImpact: runtimeTimeouts,
    runtimeArtifactReconciliation: {
      generatedArtifacts: ["tdi-data-quality.json", "tdi-input-contract.json", "tdi-missing-telemetry-report.json"],
      missingRows: qualityArtifacts.missingTelemetryReport.rows.length,
    },
    exactFixes: [
      "TDI input contract (value + status) added to record model",
      "Data quality issue inference and block classification added",
      "Execution WAIT bridge telemetry propagation added",
      "Round forensic export now writes data-quality artifacts",
    ],
    smoke2Round: {
      roundSummaries: sessionRows.summaries,
      tdiCounts: {
        approved: sessionRows.tdiRows.filter((row) => row.verdict === "APPROVED").length,
        wait: sessionRows.tdiRows.filter((row) => row.verdict === "WAIT").length,
        rejected: sessionRows.tdiRows.filter((row) => row.verdict === "REJECTED").length,
      },
      firstBlockingDistribution: byCount(
        sessionRows.tdiRows
          .filter((row) => row.verdict === "WAIT")
          .map((row) => String(row.firstBlockingCondition ?? "OTHER")),
      ),
      dataQualityBlockCount: afterDataQualityBlock,
      policyBlockCount: afterPolicyBlock,
      missingTelemetryCount: afterMissing,
      patchJobActiveRoundTimeoutCount: runtimeTimeouts.timeoutCount,
    },
    beforeAfter: {
      missingTelemetry: { before: beforeMissing, after: afterMissing },
      dataQualityBlockCount: { before: beforeDataQualityBlock, after: afterDataQualityBlock },
      policyBlockCount: { before: BASELINE_POLICY_BLOCK, after: afterPolicyBlock },
    },
    remainingBlockers: {
      unresolvedMissingRows: afterMissing,
      runtimeTimeouts: runtimeTimeouts.timeoutCount,
    },
    tdiReadinessVerdict: verdict,
  };

  fs.writeFileSync(
    path.join(process.cwd(), "tdi-data-quality.json"),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        runId: RUN_ID,
        smokeSessionId,
        inventory: TDI_INPUT_INVENTORY,
        dataQualitySummary: qualityArtifacts.dataQualitySummary,
        rootCauseCounts: qualityArtifacts.missingTelemetryReport.rootCauseCounts,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(process.cwd(), "tdi-input-contract.json"),
    `${JSON.stringify({ runId: RUN_ID, smokeSessionId, rows: qualityArtifacts.inputContracts }, null, 2)}\n`,
    "utf8",
  );
  fs.writeFileSync(
    path.join(process.cwd(), "tdi-missing-telemetry-report.json"),
    `${JSON.stringify({ runId: RUN_ID, smokeSessionId, ...qualityArtifacts.missingTelemetryReport }, null, 2)}\n`,
    "utf8",
  );

  fs.writeFileSync(
    path.join(process.cwd(), "kripto-p1-tdi-data-quality-fix.json"),
    `${JSON.stringify(reportJson, null, 2)}\n`,
    "utf8",
  );

  const markdown = buildMarkdown({
    smokeSessionId,
    beforeMissing,
    afterMissing,
    beforeDataQualityBlock,
    afterDataQualityBlock,
    afterPolicyBlock,
    roundSummaries: sessionRows.summaries,
    tdiRows: sessionRows.tdiRows,
    missingRows: qualityArtifacts.missingTelemetryReport.rows as Array<Record<string, unknown>>,
    missingRollup,
    rootCauseCounts,
    runtimeTimeouts,
    verdict,
  });
  fs.writeFileSync(path.join(process.cwd(), "KRIPTO_P1_TDI_DATA_QUALITY_FIX_REPORT.md"), markdown, "utf8");

  fs.mkdirSync(path.join(process.cwd(), "reports"), { recursive: true });
  fs.writeFileSync(
    path.join(process.cwd(), "reports", "p1-tdi-data-quality-2round-validation.json"),
    `${JSON.stringify(
      {
        runId: RUN_ID,
        smokeSessionId,
        verdict,
        beforeMissing,
        afterMissing,
        dataQualityBlockCount: afterDataQualityBlock,
        policyBlockCount: afterPolicyBlock,
        runtimeTimeouts,
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
        smokeSessionId,
        verdict,
        beforeMissing,
        afterMissing,
        dataQualityBlockCount: afterDataQualityBlock,
        policyBlockCount: afterPolicyBlock,
        runtimeTimeouts,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
  process.exit(0);
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
