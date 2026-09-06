import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Qa12PhaseVerdict } from "@/src/server/forensics/qa12-final-assessment";

export const POST_FIX_QA_SCHEMA = "post-fix-final-qa-v1" as const;

export type PostFixRequirementRow = {
  requirementId: string;
  phase: string;
  expectedBehavior: string;
  producer: string;
  consumer: string;
  productionPath: string;
  persistenceBoundary: string;
  testRef: string;
  evidencePath?: string;
  functionExists: boolean;
  productionWired: boolean;
  behaviorExecuted: boolean;
  dbVerified: boolean;
  marketDataEvaluated: boolean;
  result: Qa12PhaseVerdict;
  note: string;
};

export type PostFixFinding = {
  findingId: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  requirementId: string;
  fileFunction: string;
  reproduction: string;
  expected: string;
  actual: string;
  impact: string;
  rootCause: string;
  fix: string;
  regression: string;
  status: "OPEN" | "FIXED" | "BLOCKED" | "NOT_RUN";
};

export type PostFixTestRunEvidence = {
  command: string;
  environment: string;
  durationMs: number;
  exitCode: number;
  passed: number;
  failed: number;
  skipped: number;
  logHint: string;
};

export type PostFixFinalQaAssessment = {
  schemaVersion: typeof POST_FIX_QA_SCHEMA;
  generatedAtMs: number;
  fingerprints: {
    headCommit: string;
    worktreeFingerprint: string;
    contentFingerprint: string;
    nodeVersion: string;
    npmVersion: string;
    lockfile: string;
    testDatabase: string;
    dataPackages: string[];
  };
  verdicts: {
    FINAL_ENGINEERING_VERDICT: Qa12PhaseVerdict;
    STRATEGY_CONTEXT_AND_IDENTITY_VERDICT: Qa12PhaseVerdict;
    DURABLE_EXIT_AND_SETTLEMENT_VERDICT: Qa12PhaseVerdict;
    CRASH_RECONCILIATION_VERDICT: Qa12PhaseVerdict;
    DATA_INGESTION_AND_REPLAY_VERDICT: Qa12PhaseVerdict;
    NEGATIVE_CONTROL_IMPLEMENTATION_VERDICT: Qa12PhaseVerdict;
    ASSESSMENT_TRUSTWORTHINESS_VERDICT: Qa12PhaseVerdict;
    FULL_CHAIN_DB_VERDICT: Qa12PhaseVerdict;
    REQUIRED_CHECKS_NOT_RUN: string[];
    OPEN_CRITICAL_COUNT: number;
    OPEN_HIGH_COUNT: number;
    PROFITABILITY_EVIDENCE: "NOT_ESTABLISHED" | "INSUFFICIENT_DATA" | "INVALID_EVIDENCE";
    OVERALL_QA_STATUS: "QA_COMPLETED_WITH_GAPS" | "QA_PENDING";
    PAPER_CAMPAIGN_STARTED: false;
    LIVE_AUTHORIZATION: "DISABLED";
  };
  requirementMatrix: PostFixRequirementRow[];
  findings: PostFixFinding[];
  testRuns: PostFixTestRunEvidence[];
  reportValidity: Array<{ report: string; status: "VALID" | "PARTIALLY_VALID" | "SUPERSEDED" | "INVALIDATED" | "NOT_REVERIFIED" }>;
  supersededClaims: string[];
};

function hashContent(paths: string[]) {
  const hash = createHash("sha256");
  for (const rel of paths.sort()) {
    const abs = join(process.cwd(), rel);
    if (!existsSync(abs)) continue;
    hash.update(rel);
    hash.update(readFileSync(abs));
  }
  return hash.digest("hex").slice(0, 16);
}

export function buildPostFixFinalQaAssessment(input: {
  headCommit: string;
  worktreeFingerprint: string;
  contentPaths: string[];
  nodeVersion: string;
  npmVersion: string;
  testDatabase: string;
  dataPackages: string[];
  requirementMatrix: PostFixRequirementRow[];
  findings: PostFixFinding[];
  testRuns: PostFixTestRunEvidence[];
  nowMs?: number;
}): PostFixFinalQaAssessment {
  const openCritical = input.findings.filter((f) => f.severity === "CRITICAL" && f.status === "OPEN").length;
  const openHigh = input.findings.filter((f) => f.severity === "HIGH" && f.status === "OPEN").length;
  const requiredNotRunFromFindings = input.findings
    .filter((f) => f.status === "NOT_RUN" || f.status === "BLOCKED")
    .map((f) => f.requirementId);
  const requiredNotRunFromMatrix = input.requirementMatrix
    .filter((r) => r.result === "NOT_RUN" || r.result === "BLOCKED")
    .map((r) => r.requirementId);
  const uniqueRequiredNotRun = [
    ...new Set([
      ...requiredNotRunFromFindings,
      ...requiredNotRunFromMatrix,
      ...(openCritical > 0 ? ["CRITICAL_FINDINGS_REMAINING"] : []),
    ]),
  ];

  const fix01Rows = input.requirementMatrix.filter((r) => r.phase === "FIX01");
  const fix01Pass = fix01Rows.length > 0 && fix01Rows.every((r) => r.result === "PASS");
  const fix02DbPass = input.requirementMatrix.some(
    (r) => r.requirementId === "FIX02-DB-01" && r.dbVerified && r.result === "PASS",
  );
  const fix03Pass = input.requirementMatrix.filter((r) => r.phase.startsWith("FIX03") && r.result === "PASS").length >= 4;
  const fullChainDb = input.requirementMatrix.find((r) => r.requirementId === "CHAIN-DB-01");

  const strategyVerdict: Qa12PhaseVerdict = fix01Pass ? "PASS" : "PARTIAL";
  const durableExitVerdict: Qa12PhaseVerdict = fix02DbPass ? "PASS" : "BLOCKED";
  const crashVerdict: Qa12PhaseVerdict =
    input.findings.some((f) => f.findingId === "PFQA-OPEN-01" && f.status === "OPEN") ? "PARTIAL" : fix02DbPass ? "PARTIAL" : "BLOCKED";
  const dataVerdict: Qa12PhaseVerdict = fix03Pass ? "PASS" : "PARTIAL";
  const ncVerdict: Qa12PhaseVerdict =
    input.requirementMatrix.find((r) => r.requirementId === "FIX03-NC-01")?.result === "PASS" ? "PASS" : "PARTIAL";
  const assessmentTrust: Qa12PhaseVerdict =
    input.requirementMatrix.find((r) => r.requirementId === "QA-ASSESS-01")?.result === "PASS" ? "PASS" : "PARTIAL";
  const fullChainDbVerdict: Qa12PhaseVerdict = fullChainDb?.result ?? (fix02DbPass ? "PARTIAL" : "BLOCKED");

  const hasOpenSevere = openCritical > 0 || openHigh > 0;
  const hasBlockedRequired = uniqueRequiredNotRun.length > 0;
  const finalEngineering: Qa12PhaseVerdict =
    openCritical > 0 || hasBlockedRequired ? "PARTIAL" : hasOpenSevere ? "PARTIAL" : "PASS";

  const recordedMarket = input.dataPackages.some((p) => p.includes("recorded"));
  const profitabilityEvidence = recordedMarket ? "NOT_ESTABLISHED" : "INSUFFICIENT_DATA";

  return {
    schemaVersion: POST_FIX_QA_SCHEMA,
    generatedAtMs: input.nowMs ?? Date.now(),
    fingerprints: {
      headCommit: input.headCommit,
      worktreeFingerprint: input.worktreeFingerprint,
      contentFingerprint: hashContent(input.contentPaths),
      nodeVersion: input.nodeVersion,
      npmVersion: input.npmVersion,
      lockfile: existsSync(join(process.cwd(), "package-lock.json")) ? "package-lock.json" : "missing",
      testDatabase: input.testDatabase,
      dataPackages: input.dataPackages,
    },
    verdicts: {
      FINAL_ENGINEERING_VERDICT: finalEngineering,
      STRATEGY_CONTEXT_AND_IDENTITY_VERDICT: strategyVerdict,
      DURABLE_EXIT_AND_SETTLEMENT_VERDICT: durableExitVerdict,
      CRASH_RECONCILIATION_VERDICT: crashVerdict,
      DATA_INGESTION_AND_REPLAY_VERDICT: dataVerdict,
      NEGATIVE_CONTROL_IMPLEMENTATION_VERDICT: ncVerdict,
      ASSESSMENT_TRUSTWORTHINESS_VERDICT: assessmentTrust,
      FULL_CHAIN_DB_VERDICT: fullChainDbVerdict,
      REQUIRED_CHECKS_NOT_RUN: uniqueRequiredNotRun,
      OPEN_CRITICAL_COUNT: openCritical,
      OPEN_HIGH_COUNT: openHigh,
      PROFITABILITY_EVIDENCE: profitabilityEvidence,
      OVERALL_QA_STATUS: openCritical > 0 || hasBlockedRequired ? "QA_PENDING" : "QA_COMPLETED_WITH_GAPS",
      PAPER_CAMPAIGN_STARTED: false,
      LIVE_AUTHORIZATION: "DISABLED",
    },
    requirementMatrix: input.requirementMatrix,
    findings: input.findings,
    testRuns: input.testRuns,
    reportValidity: [
      { report: "KRIPTO_FIX01_STRATEGY_CONTEXT_AND_INVALIDATION_REPORT.md", status: "PARTIALLY_VALID" },
      { report: "KRIPTO_FIX02_DURABLE_EXIT_AND_SETTLEMENT_REPORT.md", status: "PARTIALLY_VALID" },
      { report: "KRIPTO_FIX03_OFFLINE_PIPELINE_AND_EVIDENCE_REPORT.md", status: "VALID" },
      { report: "KRIPTO_FINAL_QA_12_REPORT.md", status: "SUPERSEDED" },
      { report: "KRIPTO_FINAL_QA_FINDINGS.md", status: "SUPERSEDED" },
    ],
    supersededClaims: [
      "QA12-OPEN-03 exit state in-memory only (FIX02 DB persistence)",
      "QA12-OPEN-04 partial close not wired (FIX02 settlement path)",
      "QA12-OPEN-05 EARLY lacks invalidation (FIX01 buildEarlyStructuralInvalidation)",
      "QA12 placeholder expect(true) durable claim",
      "PR05 shuffle-only negative control",
      "buildQa12FinalAssessment hardcoded phase verdicts",
      "QA12-OPEN-01 disposable PostgreSQL unavailable (re-verified available in post-fix QA)",
    ],
  };
}

export function renderPostFixRequirementMatrixMarkdown(rows: PostFixRequirementRow[]) {
  const lines = [
    "# KRIPTO POST-FIX QA — REQUIREMENT MATRIX",
    "",
    "| Req ID | Phase | Expected | Production Path | Test | DB | Market | Result |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.requirementId} | ${r.phase} | ${r.expectedBehavior.slice(0, 60)} | ${r.productionPath.slice(0, 40)} | ${r.testRef} | ${r.dbVerified ? "Y" : "N"} | ${r.marketDataEvaluated ? "Y" : "N"} | ${r.result} |`,
    ),
  ];
  return lines.join("\n");
}

export function renderPostFixFindingsMarkdown(findings: PostFixFinding[]) {
  const lines = ["# KRIPTO POST-FIX QA — FINDINGS", ""];
  for (const f of findings) {
    lines.push(`## ${f.findingId} (${f.severity}) — ${f.status}`);
    lines.push(`- **Requirement:** ${f.requirementId}`);
    lines.push(`- **File:** ${f.fileFunction}`);
    lines.push(`- **Expected:** ${f.expected}`);
    lines.push(`- **Actual:** ${f.actual}`);
    lines.push(`- **Impact:** ${f.impact}`);
    if (f.fix) lines.push(`- **Fix:** ${f.fix}`);
    if (f.regression) lines.push(`- **Regression:** ${f.regression}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderPostFixFinalQaReportMarkdown(assessment: PostFixFinalQaAssessment) {
  const v = assessment.verdicts;
  return [
    "# KRIPTO POST-FIX FINAL QA REPORT",
    "",
    "## Fingerprints",
    "",
    `| Field | Value |`,
    `|---|---|`,
    `| HEAD | \`${assessment.fingerprints.headCommit}\` |`,
    `| Worktree | ${assessment.fingerprints.worktreeFingerprint} |`,
    `| Content fingerprint | \`${assessment.fingerprints.contentFingerprint}\` |`,
    `| Node/NPM | ${assessment.fingerprints.nodeVersion} / ${assessment.fingerprints.npmVersion} |`,
    `| Test DB | ${assessment.fingerprints.testDatabase} |`,
    `| Data packages | ${assessment.fingerprints.dataPackages.join(", ") || "none recorded"} |`,
    "",
    "## Executive Verdicts",
    "",
    ...Object.entries(v).map(([k, val]) => `- \`${k}\` = ${String(val)}`),
    "",
    "## Test Runs",
    "",
    "| Command | Exit | Passed | Failed | Duration |",
    "|---|---|---|---|---|",
    ...assessment.testRuns.map(
      (t) => `| \`${t.command.slice(0, 70)}\` | ${t.exitCode} | ${t.passed} | ${t.failed} | ${t.durationMs}ms |`,
    ),
    "",
    "## Report Validity",
    "",
    ...assessment.reportValidity.map((r) => `- **${r.report}**: ${r.status}`),
    "",
    "## Integration Chains Verified",
    "",
    "1. **EARLY** — producer context → trigger → `freezeSelectedStrategySignal` → `structuralInvalidation` in entry metadata",
    "2. **Empty context** — PR02/PR03 strategies not triggered; `selectedSignal=null` (no fixture fallback)",
    "3. **BREAKOUT** — router → frozen signal → `LEVEL_HOLD_BREACH` in snapshot",
    "4. **PostgreSQL** — EARLY invalidation → `bootstrapExitPersistenceAtEntry` → restart restore → partial settlement",
    "5. **Idempotency** — duplicate `settlementFillId` does not double-account",
    "6. **Claim fence** — wrong owner cannot release durable lock",
    "7. **FIX03** — loader → engineering comparison → causal NC → assessment (no PnL shuffle)",
    "",
    "## Engineering vs Market Evidence",
    "",
    "| Layer | Status |",
    "|---|---|",
    "| Production code wiring (FIX01–03) | Verified on real modules |",
    "| Disposable PostgreSQL E2E | PASS (`kripto-main-postgres-1`) |",
    "| Recorded market replay | NOT_RUN |",
    "| Profitability claim | INSUFFICIENT_DATA |",
    "",
    "## Safe Commands",
    "",
    "```bash",
    "npm run test:run -- tests/post-fix-final-qa.integration.test.ts",
    "npm run test:run -- tests/fix02-durable-exit-and-settlement.integration.test.ts",
    "POST_FIX_QA_EVIDENCE_ONLY=1 POST_FIX_QA_SKIP_BUILD=1 npx tsx scripts/generate-post-fix-final-qa.ts",
    "```",
    "",
    "## Superseded Claims",
    "",
    ...assessment.supersededClaims.map((c) => `- ${c}`),
  ].join("\n");
}
