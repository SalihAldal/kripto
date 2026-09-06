import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Qa12PhaseVerdict } from "@/src/server/forensics/qa12-final-assessment";

export const CORRECTIONS_FINAL_QA_SCHEMA = "corrections-final-qa-v1" as const;

export type CorrectionsRequirementRow = {
  requirementId: string;
  correction: "EXEC" | "REPLAY" | "BOTH";
  expectedBehavior: string;
  producer: string;
  consumer: string;
  productionPath: string;
  persistenceBoundary: string;
  testRef: string;
  functionExists: boolean;
  productionWired: boolean;
  behaviorExecuted: boolean;
  dbVerified: boolean;
  marketDataEvaluated: boolean;
  result: Qa12PhaseVerdict;
  note: string;
};

export type CorrectionsFinding = {
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

export type CorrectionsTestRunEvidence = {
  command: string;
  environment: string;
  durationMs: number;
  exitCode: number;
  passed: number;
  failed: number;
  skipped: number;
  logHint: string;
};

export type CorrectionsFinalQaAssessment = {
  schemaVersion: typeof CORRECTIONS_FINAL_QA_SCHEMA;
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
    POST_PARTIAL_STOP_VERDICT: Qa12PhaseVerdict;
    ATOMIC_SETTLEMENT_VERDICT: Qa12PhaseVerdict;
    ACTUAL_FILL_PROPAGATION_VERDICT: Qa12PhaseVerdict;
    CRASH_AND_CONCURRENCY_VERDICT: Qa12PhaseVerdict;
    AVAILABILITY_CAUSALITY_VERDICT: Qa12PhaseVerdict;
    NEGATIVE_CONTROL_VERDICT: Qa12PhaseVerdict;
    PORTFOLIO_TIME_AND_CAPITAL_VERDICT: Qa12PhaseVerdict;
    PRODUCTION_CHAIN_VERDICT: Qa12PhaseVerdict;
    REQUIRED_CHECKS_NOT_RUN: string[];
    OPEN_CRITICAL_COUNT: number;
    OPEN_HIGH_COUNT: number;
    PROFITABILITY_EVIDENCE: "NOT_ESTABLISHED" | "INSUFFICIENT_DATA" | "INVALID_EVIDENCE";
    OVERALL_QA_STATUS: "QA_COMPLETED_WITH_GAPS" | "QA_PENDING";
    PAPER_CAMPAIGN_STARTED: false;
    LIVE_AUTHORIZATION: "DISABLED";
  };
  requirementMatrix: CorrectionsRequirementRow[];
  findings: CorrectionsFinding[];
  testRuns: CorrectionsTestRunEvidence[];
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

function rowResult(matrix: CorrectionsRequirementRow[], id: string): Qa12PhaseVerdict {
  return matrix.find((r) => r.requirementId === id)?.result ?? "NOT_RUN";
}

export function buildCorrectionsFinalQaAssessment(input: {
  headCommit: string;
  worktreeFingerprint: string;
  contentPaths: string[];
  nodeVersion: string;
  npmVersion: string;
  testDatabase: string;
  dataPackages: string[];
  requirementMatrix: CorrectionsRequirementRow[];
  findings: CorrectionsFinding[];
  testRuns: CorrectionsTestRunEvidence[];
  nowMs?: number;
}): CorrectionsFinalQaAssessment {
  const openCritical = input.findings.filter((f) => f.severity === "CRITICAL" && f.status === "OPEN").length;
  const openHigh = input.findings.filter((f) => f.severity === "HIGH" && f.status === "OPEN").length;
  const requiredNotRun = [
    ...new Set([
      ...input.findings.filter((f) => f.status === "NOT_RUN" || f.status === "BLOCKED").map((f) => f.requirementId),
      ...input.requirementMatrix.filter((r) => r.result === "NOT_RUN" || r.result === "BLOCKED").map((r) => r.requirementId),
      ...(openCritical > 0 ? ["CRITICAL_FINDINGS_REMAINING"] : []),
    ]),
  ];

  const postPartialStop = rowResult(input.requirementMatrix, "EXEC-STOP-01");
  const atomicSettlement = rowResult(input.requirementMatrix, "EXEC-ATOMIC-01");
  const fillPropagation = rowResult(input.requirementMatrix, "EXEC-FILL-01");
  const crashConcurrency = rowResult(input.requirementMatrix, "EXEC-CRASH-01");
  const availability = rowResult(input.requirementMatrix, "REPLAY-AVAIL-01");
  const negativeControl = rowResult(input.requirementMatrix, "REPLAY-NC-01");
  const portfolioCapital = rowResult(input.requirementMatrix, "REPLAY-PORT-01");
  const productionChain = rowResult(input.requirementMatrix, "CHAIN-SETTLE-01");

  const coreVerdicts = [postPartialStop, atomicSettlement, fillPropagation, availability, negativeControl, portfolioCapital];
  const allCorePass = coreVerdicts.every((v) => v === "PASS");
  const hasOpenSevere = openCritical > 0 || openHigh > 0;
  const hasBlockedRequired = requiredNotRun.length > 0;

  const finalEngineering: Qa12PhaseVerdict =
    openCritical > 0 || hasBlockedRequired ? "PARTIAL" : hasOpenSevere ? "PARTIAL" : allCorePass ? "PASS" : "PARTIAL";

  const recordedMarket = input.dataPackages.some((p) => p.includes("recorded"));

  return {
    schemaVersion: CORRECTIONS_FINAL_QA_SCHEMA,
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
      POST_PARTIAL_STOP_VERDICT: postPartialStop,
      ATOMIC_SETTLEMENT_VERDICT: atomicSettlement,
      ACTUAL_FILL_PROPAGATION_VERDICT: fillPropagation,
      CRASH_AND_CONCURRENCY_VERDICT: crashConcurrency,
      AVAILABILITY_CAUSALITY_VERDICT: availability,
      NEGATIVE_CONTROL_VERDICT: negativeControl,
      PORTFOLIO_TIME_AND_CAPITAL_VERDICT: portfolioCapital,
      PRODUCTION_CHAIN_VERDICT: productionChain,
      REQUIRED_CHECKS_NOT_RUN: requiredNotRun,
      OPEN_CRITICAL_COUNT: openCritical,
      OPEN_HIGH_COUNT: openHigh,
      PROFITABILITY_EVIDENCE: recordedMarket ? "NOT_ESTABLISHED" : "INSUFFICIENT_DATA",
      OVERALL_QA_STATUS: openCritical > 0 || hasBlockedRequired ? "QA_PENDING" : "QA_COMPLETED_WITH_GAPS",
      PAPER_CAMPAIGN_STARTED: false,
      LIVE_AUTHORIZATION: "DISABLED",
    },
    requirementMatrix: input.requirementMatrix,
    findings: input.findings,
    testRuns: input.testRuns,
    reportValidity: [
      { report: "KRIPTO_EXECUTION_CORRECTION_REPORT.md", status: "PARTIALLY_VALID" },
      { report: "kripto-execution-correction.json", status: "PARTIALLY_VALID" },
      { report: "KRIPTO_REPLAY_CORRECTION_REPORT.md", status: "VALID" },
      { report: "kripto-replay-correction.json", status: "VALID" },
      { report: "KRIPTO_POST_FIX_FINAL_QA_REPORT.md", status: "SUPERSEDED" },
      { report: "KRIPTO_POST_FIX_QA_FINDINGS.md", status: "SUPERSEDED" },
    ],
    supersededClaims: [
      "EXECUTION_CORRECTION_REPORT PASS without independent adversarial stop DB assertions",
      "execution-correction test A quantity<1 only (superseded by ADV-STOP-01)",
      "RECONCILE_REQUIRED written without consumer proof (still NOT_RUN)",
      "ensureSingleActiveExitOrder mock allowed:true as double-sell guarantee",
      "post-fix chain 5 routed.partial||handled weak assertion",
      "REPLAY_CORRECTION PASS without portfolio intermediate-state verification",
    ],
  };
}

export function renderCorrectionsRequirementMatrixMarkdown(rows: CorrectionsRequirementRow[]) {
  const lines = [
    "# KRIPTO CORRECTIONS FINAL QA — REQUIREMENT MATRIX",
    "",
    "| Req ID | Correction | Expected | Production Path | Test | DB | Market | Result |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.requirementId} | ${r.correction} | ${r.expectedBehavior.slice(0, 55)} | ${r.productionPath.slice(0, 35)} | ${r.testRef} | ${r.dbVerified ? "Y" : "N"} | ${r.marketDataEvaluated ? "Y" : "N"} | ${r.result} |`,
    ),
  ];
  return lines.join("\n");
}

export function renderCorrectionsFindingsMarkdown(findings: CorrectionsFinding[]) {
  const lines = ["# KRIPTO CORRECTIONS FINAL QA — FINDINGS", ""];
  for (const f of findings) {
    lines.push(`## ${f.findingId} (${f.severity}) — ${f.status}`);
    lines.push(`- **Requirement:** ${f.requirementId}`);
    lines.push(`- **File:** ${f.fileFunction}`);
    lines.push(`- **Reproduction:** ${f.reproduction}`);
    lines.push(`- **Expected:** ${f.expected}`);
    lines.push(`- **Actual:** ${f.actual}`);
    lines.push(`- **Root cause:** ${f.rootCause}`);
    lines.push(`- **Impact:** ${f.impact}`);
    if (f.fix) lines.push(`- **Fix:** ${f.fix}`);
    if (f.regression) lines.push(`- **Regression:** ${f.regression}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function renderCorrectionsFinalQaReportMarkdown(assessment: CorrectionsFinalQaAssessment) {
  const v = assessment.verdicts;
  return [
    "# KRIPTO CORRECTIONS FINAL QA REPORT",
    "",
    "Independent adversarial verification of Düzeltme 1/2 (execution) and Düzeltme 2/2 (replay).",
    "",
    "## Fingerprints",
    "",
    "| Field | Value |",
    "|---|---|",
    `| HEAD | \`${assessment.fingerprints.headCommit}\` |`,
    `| Worktree | ${assessment.fingerprints.worktreeFingerprint} |`,
    `| Content fingerprint | \`${assessment.fingerprints.contentFingerprint}\` |`,
    `| Node | ${assessment.fingerprints.nodeVersion} |`,
    `| Lockfile | ${assessment.fingerprints.lockfile} |`,
    `| Test DB | ${assessment.fingerprints.testDatabase} |`,
    `| Data packages | ${assessment.fingerprints.dataPackages.join(", ") || "none"} |`,
    "",
    "## Verdicts",
    "",
    "| Verdict | Value |",
    "|---|---|",
    `| FINAL_ENGINEERING_VERDICT | ${v.FINAL_ENGINEERING_VERDICT} |`,
    `| POST_PARTIAL_STOP_VERDICT | ${v.POST_PARTIAL_STOP_VERDICT} |`,
    `| ATOMIC_SETTLEMENT_VERDICT | ${v.ATOMIC_SETTLEMENT_VERDICT} |`,
    `| ACTUAL_FILL_PROPAGATION_VERDICT | ${v.ACTUAL_FILL_PROPAGATION_VERDICT} |`,
    `| CRASH_AND_CONCURRENCY_VERDICT | ${v.CRASH_AND_CONCURRENCY_VERDICT} |`,
    `| AVAILABILITY_CAUSALITY_VERDICT | ${v.AVAILABILITY_CAUSALITY_VERDICT} |`,
    `| NEGATIVE_CONTROL_VERDICT | ${v.NEGATIVE_CONTROL_VERDICT} |`,
    `| PORTFOLIO_TIME_AND_CAPITAL_VERDICT | ${v.PORTFOLIO_TIME_AND_CAPITAL_VERDICT} |`,
    `| PRODUCTION_CHAIN_VERDICT | ${v.PRODUCTION_CHAIN_VERDICT} |`,
    `| OPEN_CRITICAL_COUNT | ${v.OPEN_CRITICAL_COUNT} |`,
    `| OPEN_HIGH_COUNT | ${v.OPEN_HIGH_COUNT} |`,
    `| PROFITABILITY_EVIDENCE | ${v.PROFITABILITY_EVIDENCE} |`,
    `| OVERALL_QA_STATUS | ${v.OVERALL_QA_STATUS} |`,
    "",
    "## Required checks not run",
    "",
    v.REQUIRED_CHECKS_NOT_RUN.length ? v.REQUIRED_CHECKS_NOT_RUN.map((x) => `- ${x}`).join("\n") : "- none",
    "",
    "## Test runs",
    "",
    ...assessment.testRuns.map(
      (t) =>
        `- \`${t.command}\` — exit ${t.exitCode}, ${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped, ${t.durationMs}ms`,
    ),
    "",
    "## Superseded / invalidated prior claims",
    "",
    ...assessment.supersededClaims.map((c) => `- ${c}`),
    "",
    "## Report validity",
    "",
    ...assessment.reportValidity.map((r) => `- ${r.report}: **${r.status}**`),
    "",
  ].join("\n");
}
