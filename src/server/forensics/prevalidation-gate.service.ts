import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "@/lib/config";
import { assertValidationDatabaseReady } from "@/src/server/forensics/db-health.service";
import { getCanonicalAuthorityCounters } from "@/src/server/execution/authority-counters.service";
import type {
  PreValidationGateCheck,
  PreValidationGateResult,
} from "@/src/server/forensics/forensic.types";

type ManualCheck = {
  code: string;
  pass: boolean;
  detail: string;
  metadata?: Record<string, unknown>;
};

export type PreValidationGateInput = {
  buildPass?: boolean;
  typecheckPass?: boolean;
  typecheckErrorCount?: number;
  reportGeneratorReady?: boolean;
  mfeConversionReady?: boolean;
  captureRatioReady?: boolean;
  rankCalibrationReady?: boolean;
  latencyReady?: boolean;
  resourceTelemetryReady?: boolean;
  wsHardeningReady?: boolean;
  breakerReady?: boolean;
  paperExecutionReady?: boolean;
  edgeValidationReady?: boolean;
  edgeMeasurementPipelineReady?: boolean;
  edgeProvenStatus?: "UNKNOWN" | "NOT_TESTED" | "PROVEN" | "NOT_PROVEN";
  outcomeFinalizerReady?: boolean;
  outcomeRestartRecoveryReady?: boolean;
  groundTruthPersistenceReady?: boolean;
  moverJoinReady?: boolean;
  missedOpportunityReady?: boolean;
  funnelViabilityReady?: boolean;
  canProduceHot?: boolean;
  canProduceMicroConfirmed?: boolean;
  canProduceFinalRanked?: boolean;
  canProduceExecutionReady?: boolean;
  canProduceRiskAllow?: boolean;
  canProducePaperOpen?: boolean;
  positionExitReady?: boolean;
  legacyExecutionInvocationCount?: number;
};

function pushManualCheck(list: PreValidationGateCheck[], input: ManualCheck) {
  list.push({
    code: input.code,
    status: input.pass ? "PASS" : "FAIL",
    detail: input.detail,
    metadata: input.metadata,
  });
}

function buildGateArtifact(result: PreValidationGateResult) {
  const rootDir = path.join(process.cwd(), "artifacts", "forensics", "prevalidation", result.checkedAt.replace(/[:.]/g, "-"));
  mkdirSync(rootDir, { recursive: true });
  const filePath = path.join(rootDir, "prevalidation-gate.json");
  writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return filePath;
}

export async function runPreValidationGate(input: PreValidationGateInput = {}) {
  const checks: PreValidationGateCheck[] = [];
  const db = await assertValidationDatabaseReady();
  checks.push({
    code: "DB_READY",
    status: db.status === "PASS" ? "PASS" : "FAIL",
    detail: db.reasonDetail,
    metadata: {
      reasonCode: db.reasonCode,
      missingTables: db.missingTables,
      latestMigration: db.latestMigration,
    },
  });

  pushManualCheck(checks, {
    code: "MIGRATIONS_READY",
    pass: db.migrationTablePresent && db.status === "PASS",
    detail: db.migrationTablePresent ? "Prisma migration history table is present" : "Migration history table is missing",
  });

  pushManualCheck(checks, {
    code: "BUILD_PASS",
    pass: input.buildPass === true,
    detail: input.buildPass === true ? "Build completed successfully" : "Build has not passed in this closure run",
  });
  pushManualCheck(checks, {
    code: "TYPECHECK_PASS",
    pass: input.typecheckPass === true && Number(input.typecheckErrorCount ?? 0) === 0,
    detail:
      input.typecheckPass === true
        ? `Typecheck passed with ${Number(input.typecheckErrorCount ?? 0)} errors`
        : "Typecheck has not passed in this closure run",
    metadata: { errorCount: Number(input.typecheckErrorCount ?? -1) },
  });

  const authority = getCanonicalAuthorityCounters();
  pushManualCheck(checks, {
    code: "AI_HARD_VETO_ZERO",
    pass: authority.aiHardVetoCount === 0,
    detail: `aiHardVetoCount=${authority.aiHardVetoCount}`,
  });
  pushManualCheck(checks, {
    code: "TDI_HARD_VETO_ZERO",
    pass: authority.tdiHardVetoCount === 0,
    detail: `tdiHardVetoCount=${authority.tdiHardVetoCount}`,
  });
  pushManualCheck(checks, {
    code: "LEARNING_HARD_VETO_ZERO",
    pass: authority.learningHardVetoCount === 0,
    detail: `learningHardVetoCount=${authority.learningHardVetoCount}`,
  });
  pushManualCheck(checks, {
    code: "LEGACY_INVOCATION_ZERO",
    pass:
      authority.legacyScannerInvocationCount === 0 &&
      authority.legacyScannerPersistCount === 0 &&
      Number(input.legacyExecutionInvocationCount ?? 0) === 0,
    detail: `legacyScannerInvocationCount=${authority.legacyScannerInvocationCount}, legacyScannerPersistCount=${authority.legacyScannerPersistCount}, legacyExecutionInvocationCount=${Number(input.legacyExecutionInvocationCount ?? 0)}`,
  });

  pushManualCheck(checks, {
    code: "LIVE_ORDER_LOCKED",
    pass: env.LIVE_TRADING_ENABLED === false,
    detail: `LIVE_TRADING_ENABLED=${String(env.LIVE_TRADING_ENABLED)}`,
  });
  pushManualCheck(checks, {
    code: "REPORT_GENERATOR_READY",
    pass: input.reportGeneratorReady === true,
    detail: input.reportGeneratorReady ? "Validation report generator calculators are wired" : "Validation report generator is incomplete",
  });
  pushManualCheck(checks, {
    code: "MFE_CONVERSION_READY",
    pass: input.mfeConversionReady === true,
    detail: input.mfeConversionReady ? "MFE conversion calculator is active" : "MFE conversion calculator is incomplete",
  });
  pushManualCheck(checks, {
    code: "CAPTURE_RATIO_READY",
    pass: input.captureRatioReady === true,
    detail: input.captureRatioReady ? "Capture ratio calculator is active" : "Capture ratio calculator is incomplete",
  });
  pushManualCheck(checks, {
    code: "RANK_CALIBRATION_READY",
    pass: input.rankCalibrationReady === true,
    detail: input.rankCalibrationReady ? "Rank calibration output is active" : "Rank calibration output is incomplete",
  });
  pushManualCheck(checks, {
    code: "LATENCY_READY",
    pass: input.latencyReady === true,
    detail: input.latencyReady ? "Pipeline/deep latency calculators are active" : "Latency calculator output is incomplete",
  });
  pushManualCheck(checks, {
    code: "RESOURCE_TELEMETRY_READY",
    pass: input.resourceTelemetryReady === true,
    detail: input.resourceTelemetryReady ? "CPU/memory/event-loop/redis telemetry is active" : "Resource telemetry is incomplete",
  });
  pushManualCheck(checks, {
    code: "WS_HARDENING_READY",
    pass: input.wsHardeningReady === true,
    detail: input.wsHardeningReady ? "WS hardening checks are active" : "WS hardening checks not confirmed",
  });
  pushManualCheck(checks, {
    code: "BREAKER_READY",
    pass: input.breakerReady === true,
    detail: input.breakerReady ? "Breaker checks are active" : "Breaker checks not confirmed",
  });
  pushManualCheck(checks, {
    code: "PAPER_EXECUTION_READY",
    pass: input.paperExecutionReady === true,
    detail: input.paperExecutionReady ? "Paper execution invariants are active" : "Paper execution readiness not confirmed",
  });
  checks.push({
    code: "EDGE_VALIDATION_READY",
    status: input.edgeValidationReady === true ? "PASS" : "WARN",
    detail:
      input.edgeValidationReady === true
        ? "Historical edge dataset is sufficient for profitability validation"
        : "Historical edge proof is not sufficient yet; this does not block long-run measurement",
    metadata: { edgeProven: input.edgeProvenStatus ?? "UNKNOWN" },
  });
  pushManualCheck(checks, {
    code: "OUTCOME_FINALIZER_READY",
    pass: input.outcomeFinalizerReady === true,
    detail: input.outcomeFinalizerReady ? "Outcome finalizer is active for pending horizon settlement" : "Outcome finalizer not confirmed",
  });
  pushManualCheck(checks, {
    code: "OUTCOME_RESTART_RECOVERY_READY",
    pass: input.outcomeRestartRecoveryReady === true,
    detail: input.outcomeRestartRecoveryReady ? "Pending outcomes are recoverable after restart" : "Outcome restart recovery not confirmed",
  });
  pushManualCheck(checks, {
    code: "GROUND_TRUTH_PERSISTENCE_READY",
    pass: input.groundTruthPersistenceReady === true,
    detail: input.groundTruthPersistenceReady ? "Ground truth movers are persisted in canonical storage" : "Ground truth mover persistence is incomplete",
  });
  pushManualCheck(checks, {
    code: "MOVER_JOIN_READY",
    pass: input.moverJoinReady === true,
    detail: input.moverJoinReady ? "Mover to candidate join analytics are available" : "Mover join analytics are incomplete",
  });
  pushManualCheck(checks, {
    code: "MISSED_OPPORTUNITY_READY",
    pass: input.missedOpportunityReady === true,
    detail: input.missedOpportunityReady ? "Missed profitable opportunity analytics are available" : "Missed opportunity analytics are incomplete",
  });
  pushManualCheck(checks, {
    code: "EDGE_MEASUREMENT_PIPELINE_READY",
    pass: input.edgeMeasurementPipelineReady === true,
    detail: input.edgeMeasurementPipelineReady ? "Measurement stack is ready for long run evidence collection" : "Measurement stack is not ready",
    metadata: { edgeProven: input.edgeProvenStatus ?? "UNKNOWN" },
  });
  pushManualCheck(checks, {
    code: "FUNNEL_VIABILITY_READY",
    pass: input.funnelViabilityReady === true,
    detail: input.funnelViabilityReady ? "Known-good fixture confirms canonical end-to-end viability" : "Funnel viability fixture not confirmed",
  });
  pushManualCheck(checks, {
    code: "CAN_PRODUCE_HOT",
    pass: input.canProduceHot === true,
    detail: input.canProduceHot ? "Known-good candidate reaches HOT" : "Known-good candidate cannot reach HOT",
  });
  pushManualCheck(checks, {
    code: "CAN_PRODUCE_MICRO_CONFIRMED",
    pass: input.canProduceMicroConfirmed === true,
    detail: input.canProduceMicroConfirmed ? "Known-good candidate reaches MICRO_CONFIRMED" : "Known-good candidate cannot reach MICRO_CONFIRMED",
  });
  pushManualCheck(checks, {
    code: "CAN_PRODUCE_FINAL_RANKED",
    pass: input.canProduceFinalRanked === true,
    detail: input.canProduceFinalRanked ? "Known-good candidate reaches FINAL_RANKED" : "Known-good candidate cannot reach FINAL_RANKED",
  });
  pushManualCheck(checks, {
    code: "CAN_PRODUCE_EXECUTION_READY",
    pass: input.canProduceExecutionReady === true,
    detail: input.canProduceExecutionReady ? "Known-good candidate reaches EXECUTION_READY" : "Known-good candidate cannot reach EXECUTION_READY",
  });
  pushManualCheck(checks, {
    code: "CAN_PRODUCE_RISK_ALLOW",
    pass: input.canProduceRiskAllow === true,
    detail: input.canProduceRiskAllow ? "Known-good candidate reaches RISK_ALLOWED" : "Known-good candidate cannot reach RISK_ALLOWED",
  });
  pushManualCheck(checks, {
    code: "CAN_PRODUCE_PAPER_OPEN",
    pass: input.canProducePaperOpen === true,
    detail: input.canProducePaperOpen ? "Known-good candidate reaches PAPER_OPENED" : "Known-good candidate cannot reach PAPER_OPENED",
  });
  pushManualCheck(checks, {
    code: "POSITION_EXIT_READY",
    pass: input.positionExitReady === true,
    detail: input.positionExitReady ? "Known-good paper position can close end-to-end" : "Position close path not confirmed",
  });

  const blockers = checks
    .filter((row) => row.status === "FAIL")
    .map((row) => `${row.code}: ${row.detail}`);
  const longRunMustPass = new Set([
    "DB_READY",
    "MIGRATIONS_READY",
    "BUILD_PASS",
    "TYPECHECK_PASS",
    "OUTCOME_FINALIZER_READY",
    "OUTCOME_RESTART_RECOVERY_READY",
    "GROUND_TRUTH_PERSISTENCE_READY",
    "MOVER_JOIN_READY",
    "MFE_CONVERSION_READY",
    "MISSED_OPPORTUNITY_READY",
    "REPORT_GENERATOR_READY",
    "FUNNEL_VIABILITY_READY",
    "CAN_PRODUCE_HOT",
    "CAN_PRODUCE_MICRO_CONFIRMED",
    "CAN_PRODUCE_FINAL_RANKED",
    "CAN_PRODUCE_EXECUTION_READY",
    "CAN_PRODUCE_RISK_ALLOW",
    "CAN_PRODUCE_PAPER_OPEN",
    "PAPER_EXECUTION_READY",
    "POSITION_EXIT_READY",
    "AI_HARD_VETO_ZERO",
    "TDI_HARD_VETO_ZERO",
    "LEARNING_HARD_VETO_ZERO",
    "WS_HARDENING_READY",
    "BREAKER_READY",
    "LIVE_ORDER_LOCKED",
  ]);
  const longPaperRunReady =
    checks.filter((row) => longRunMustPass.has(row.code)).every((row) => row.status === "PASS") &&
    input.edgeMeasurementPipelineReady === true;
  checks.push({
    code: "LONG_PAPER_RUN_READY",
    status: longPaperRunReady ? "PASS" : "FAIL",
    detail: longPaperRunReady ? "All mandatory pre-long-run viability checks pass" : "One or more mandatory long-run checks failed",
    metadata: { edgeProven: input.edgeProvenStatus ?? "UNKNOWN" },
  });
  const result: PreValidationGateResult = {
    status: blockers.length === 0 ? "READY" : "NOT_READY",
    checkedAt: new Date().toISOString(),
    blockers,
    checks,
  };
  const artifactPath = buildGateArtifact(result);
  return { ...result, artifactPath };
}
