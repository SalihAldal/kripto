import type { CheckStatus } from "@/src/server/forensics/er01-telemetry-verdict";

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
    OFFLINE_CANDIDATE_VERDICT: "BLOCKED" | "INSUFFICIENT_DATA" | "NO_CANDIDATE_SUPPORTED" | "OFFLINE_CANDIDATE_SUPPORTED";
    OPEN_CRITICAL_COUNT: number;
    OPEN_HIGH_COUNT: number;
    REQUIRED_CHECKS_NOT_RUN: string[];
    OVERALL_QA_STATUS: "QA_COMPLETED_WITH_GAPS" | "QA_PENDING";
    PAPER_CAMPAIGN_STARTED: false;
    LIVE_AUTHORIZATION: "DISABLED";
    PRODUCTION_POLICY_CHANGED: false;
  };
  phaseStatus: Record<string, Qa12PhaseVerdict>;
  invalidatedReports: string[];
  stillValidReports: string[];
};

export function buildQa12FinalAssessment(input: {
  headCommit: string;
  worktreeFingerprint: string;
  openCritical: number;
  openHigh: number;
  requiredChecksNotRun: string[];
  nowMs?: number;
}): Qa12FinalAssessment {
  const phaseStatus: Record<string, Qa12PhaseVerdict> = {
    ER01: "PASS",
    ER02: "PASS",
    ER03: "PASS",
    ER04: "PARTIAL",
    ER05: "PARTIAL",
    ER06: "PARTIAL",
    PR01: "PARTIAL",
    PR02: "PARTIAL",
    PR03: "PARTIAL",
    PR04: "PARTIAL",
    PR05: "BLOCKED",
  };
  const hasBlocked = input.openCritical > 0 || input.requiredChecksNotRun.length > 0;
  return {
    schemaVersion: "qa12-final-assessment-v1",
    generatedAtMs: input.nowMs ?? Date.now(),
    headCommit: input.headCommit,
    worktreeFingerprint: input.worktreeFingerprint,
    verdicts: {
      FINAL_ENGINEERING_VERDICT: hasBlocked ? "PARTIAL" : "PASS",
      PRODUCTION_PATH_INTEGRATION_VERDICT: "PARTIAL",
      EXECUTION_AND_ACCOUNTING_VERDICT: "PARTIAL",
      CAUSALITY_AND_DATASET_VERDICT: "PARTIAL",
      STRATEGY_LIFECYCLE_VERDICT: "PARTIAL",
      EXIT_MANAGEMENT_VERDICT: "PARTIAL",
      OFFLINE_EVIDENCE_VERDICT: "BLOCKED",
      PROFITABILITY_EVIDENCE: "INSUFFICIENT_DATA",
      OFFLINE_CANDIDATE_VERDICT: "BLOCKED",
      OPEN_CRITICAL_COUNT: input.openCritical,
      OPEN_HIGH_COUNT: input.openHigh,
      REQUIRED_CHECKS_NOT_RUN: input.requiredChecksNotRun,
      OVERALL_QA_STATUS: "QA_COMPLETED_WITH_GAPS",
      PAPER_CAMPAIGN_STARTED: false,
      LIVE_AUTHORIZATION: "DISABLED",
      PRODUCTION_POLICY_CHANGED: false,
    },
    phaseStatus,
    invalidatedReports: [],
    stillValidReports: [
      "KRIPTO_ER01_TELEMETRY_AND_VERDICT_REPORT.md",
      "KRIPTO_ER02_FEATURE_CONTRACT_AND_ROUTER_INPUT_REPORT.md",
      "KRIPTO_ER03_CANONICAL_POLICY_AND_SELECTION_REPORT.md",
      "KRIPTO_PR04_EXIT_AND_POSITION_MANAGEMENT_REPORT.md",
      "KRIPTO_PR05_OFFLINE_COMPARISON_AND_CANDIDATE_REPORT.md",
    ],
  };
}
