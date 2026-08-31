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
  pushManualCheck(checks, {
    code: "EDGE_VALIDATION_READY",
    pass: input.edgeValidationReady === true,
    detail: input.edgeValidationReady ? "Edge dataset/calculators are sufficient for meaningful long paper validation" : "Edge dataset/calculators are not yet sufficient",
  });

  const blockers = checks
    .filter((row) => row.status === "FAIL")
    .map((row) => `${row.code}: ${row.detail}`);
  const result: PreValidationGateResult = {
    status: blockers.length === 0 ? "READY" : "NOT_READY",
    checkedAt: new Date().toISOString(),
    blockers,
    checks,
  };
  const artifactPath = buildGateArtifact(result);
  return { ...result, artifactPath };
}
