import type { CheckStatus } from "@/src/server/forensics/er01-telemetry-verdict";
import type { Pr05OfflineComparisonReport } from "@/src/server/profitability/pr05-types";

export type Qa12PhaseVerdict = "PASS" | "PARTIAL" | "FAIL" | "NOT_RUN" | "BLOCKED";

export type Qa12RequirementRow = {
  requirementId: string;
  sourcePhase: string;
  expectedBehavior: string;
  productionPath: string;
  testRef: string;
  evidenceStatus: "CODE_ONLY" | "TESTED" | "MARKET_DATA" | "OPERATIONAL" | "BLOCKED";
  result: Qa12PhaseVerdict;
  note: string;
};

export type Qa12Finding = {
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
  verification: CheckStatus;
};

export type Qa12EvidenceCheck = {
  checkId: string;
  result: Qa12PhaseVerdict;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  required: boolean;
  scope: string;
  evidencePath?: string;
  exitCode?: number;
  note?: string;
};

export type Qa12FinalAssessment = {
  schemaVersion: "qa12-final-assessment-v1";
  generatedAtMs: number;
  headCommit: string;
  worktreeFingerprint: string;
  verdicts: {
    FINAL_ENGINEERING_VERDICT: Qa12PhaseVerdict;
    PRODUCTION_PATH_INTEGRATION_VERDICT: Qa12PhaseVerdict;
    EXECUTION_AND_ACCOUNTING_VERDICT: Qa12PhaseVerdict;
    CAUSALITY_AND_DATASET_VERDICT: Qa12PhaseVerdict;
    STRATEGY_LIFECYCLE_VERDICT: Qa12PhaseVerdict;
    EXIT_MANAGEMENT_VERDICT: Qa12PhaseVerdict;
    OFFLINE_EVIDENCE_VERDICT: Qa12PhaseVerdict;
    PROFITABILITY_EVIDENCE: "NOT_ESTABLISHED" | "INSUFFICIENT_DATA" | "INVALID_EVIDENCE";
    OFFLINE_CANDIDATE_VERDICT: "BLOCKED" | "INSUFFICIENT_DATA" | "NO_CANDIDATE_SUPPORTED" | "OFFLINE_CANDIDATE_SUPPORTED" | "INVALID_EVIDENCE";
    OPEN_CRITICAL_COUNT: number;
    OPEN_HIGH_COUNT: number;
    REQUIRED_CHECKS_NOT_RUN: string[];
    OVERALL_QA_STATUS: "QA_COMPLETED_WITH_GAPS" | "QA_PENDING";
    PAPER_CAMPAIGN_STARTED: false;
    LIVE_AUTHORIZATION: "DISABLED";
    PRODUCTION_POLICY_CHANGED: false;
  };
  phaseStatus: Record<string, Qa12PhaseVerdict>;
  evidenceChecks: Qa12EvidenceCheck[];
  invalidatedReports: string[];
  stillValidReports: string[];
  supersededClaims: string[];
};

function derivePhaseStatus(input: {
  openCritical: number;
  openHigh: number;
  requiredChecksNotRun: string[];
  pr05Report?: Pr05OfflineComparisonReport | null;
  fix01Passed?: boolean;
  fix02Passed?: boolean;
}) {
  const phaseStatus: Record<string, Qa12PhaseVerdict> = {
    ER01: input.openCritical > 0 ? "PARTIAL" : "PASS",
    ER02: input.openCritical > 0 ? "PARTIAL" : "PASS",
    ER03: input.openCritical > 0 ? "PARTIAL" : "PASS",
    ER04: input.requiredChecksNotRun.some((id) => id.includes("DB") || id.includes("ER04")) ? "PARTIAL" : "PASS",
    ER05: input.requiredChecksNotRun.some((id) => id.includes("ER05")) ? "PARTIAL" : "PASS",
    ER06: input.requiredChecksNotRun.length > 0 ? "PARTIAL" : "PASS",
    PR01: "PARTIAL",
    PR02: input.fix01Passed ? "PASS" : "PARTIAL",
    PR03: input.fix01Passed ? "PASS" : "PARTIAL",
    PR04: input.fix02Passed ? "PASS" : "PARTIAL",
    PR05:
      input.pr05Report?.status === "BLOCKED"
        ? "BLOCKED"
        : input.pr05Report?.status === "COMPLETED"
          ? "PARTIAL"
          : "PARTIAL",
  };
  return phaseStatus;
}

export function buildQa12FinalAssessment(input: {
  headCommit: string;
  worktreeFingerprint: string;
  openCritical: number;
  openHigh: number;
  requiredChecksNotRun: string[];
  evidenceChecks?: Qa12EvidenceCheck[];
  pr05Report?: Pr05OfflineComparisonReport | null;
  fix01Passed?: boolean;
  fix02Passed?: boolean;
  nowMs?: number;
}): Qa12FinalAssessment {
  const phaseStatus = derivePhaseStatus(input);
  const hasBlockedRequired = input.requiredChecksNotRun.length > 0;
  const hasOpenSevere = input.openCritical > 0 || input.openHigh > 0;
  const failedRequired = (input.evidenceChecks ?? []).some((c) => c.required && (c.result === "FAIL" || c.result === "BLOCKED"));
  const offlineEvidenceVerdict: Qa12PhaseVerdict =
    input.pr05Report?.status === "BLOCKED"
      ? "BLOCKED"
      : input.pr05Report?.dataInventory.recordedMarketDatasetAvailable
        ? "PARTIAL"
        : "PARTIAL";
  const finalEngineeringVerdict: Qa12PhaseVerdict =
    input.openCritical > 0 || failedRequired || hasBlockedRequired ? "PARTIAL" : hasOpenSevere ? "PARTIAL" : "PASS";
  const profitabilityEvidence =
    input.pr05Report?.profitabilityEvidence ??
    (input.pr05Report?.dataInventory.recordedMarketDatasetAvailable ? "NOT_ESTABLISHED" : "INSUFFICIENT_DATA");
  const offlineCandidateVerdict =
    input.pr05Report?.offlineCandidateVerdict ??
    (input.pr05Report?.dataInventory.recordedMarketDatasetAvailable ? "NO_CANDIDATE_SUPPORTED" : "BLOCKED");
  const invalidatedReports = [
    ...(input.pr05Report?.negativeControl.method === "CAUSAL_ENTRY_TIME_SHIFT" ? [] : ["KRIPTO_PR05_OFFLINE_COMPARISON_AND_CANDIDATE_REPORT.md:negative-control"]),
    ...(hasOpenSevere ? ["KRIPTO_FINAL_QA_12_REPORT.md:placeholder-pass-claims"] : []),
  ];
  const supersededClaims = [
    "PR05 shuffle-only negative control (PNL permutation) as causal evidence",
    "QA12 scenario F expect(true) durable claim placeholder",
    "buildQa12FinalAssessment hardcoded phase PASS/BLOCKED map",
  ];
  return {
    schemaVersion: "qa12-final-assessment-v1",
    generatedAtMs: input.nowMs ?? Date.now(),
    headCommit: input.headCommit,
    worktreeFingerprint: input.worktreeFingerprint,
    verdicts: {
      FINAL_ENGINEERING_VERDICT: finalEngineeringVerdict,
      PRODUCTION_PATH_INTEGRATION_VERDICT: input.fix02Passed ? "PARTIAL" : "PARTIAL",
      EXECUTION_AND_ACCOUNTING_VERDICT: input.fix02Passed ? "PARTIAL" : "PARTIAL",
      CAUSALITY_AND_DATASET_VERDICT: offlineEvidenceVerdict,
      STRATEGY_LIFECYCLE_VERDICT: input.fix01Passed ? "PASS" : "PARTIAL",
      EXIT_MANAGEMENT_VERDICT: input.fix02Passed ? "PARTIAL" : "PARTIAL",
      OFFLINE_EVIDENCE_VERDICT: offlineEvidenceVerdict,
      PROFITABILITY_EVIDENCE: profitabilityEvidence,
      OFFLINE_CANDIDATE_VERDICT: offlineCandidateVerdict,
      OPEN_CRITICAL_COUNT: input.openCritical,
      OPEN_HIGH_COUNT: input.openHigh,
      REQUIRED_CHECKS_NOT_RUN: input.requiredChecksNotRun,
      OVERALL_QA_STATUS: hasBlockedRequired || input.openCritical > 0 ? "QA_PENDING" : "QA_COMPLETED_WITH_GAPS",
      PAPER_CAMPAIGN_STARTED: false,
      LIVE_AUTHORIZATION: "DISABLED",
      PRODUCTION_POLICY_CHANGED: false,
    },
    phaseStatus,
    evidenceChecks: input.evidenceChecks ?? [],
    invalidatedReports,
    stillValidReports: [
      "KRIPTO_ER01_TELEMETRY_AND_VERDICT_REPORT.md",
      "KRIPTO_ER02_FEATURE_CONTRACT_AND_ROUTER_INPUT_REPORT.md",
      "KRIPTO_ER03_CANONICAL_POLICY_AND_SELECTION_REPORT.md",
      "KRIPTO_FIX01_STRATEGY_CONTEXT_AND_INVALIDATION_REPORT.md",
      "KRIPTO_FIX02_DURABLE_EXIT_AND_SETTLEMENT_REPORT.md",
    ],
    supersededClaims,
  };
}

export function renderQa12AssessmentMarkdown(assessment: Qa12FinalAssessment) {
  const lines = [
    "# QA12 Assessment Snapshot",
    "",
    `Generated: ${new Date(assessment.generatedAtMs).toISOString()}`,
    `Head: ${assessment.headCommit}`,
    "",
    "## Verdicts",
    ...Object.entries(assessment.verdicts).map(([key, value]) => `- ${key}: ${String(value)}`),
    "",
    "## Phase Status",
    ...Object.entries(assessment.phaseStatus).map(([key, value]) => `- ${key}: ${value}`),
  ];
  return lines.join("\n");
}
