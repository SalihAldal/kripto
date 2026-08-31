import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/forensics/db-health.service", () => ({
  assertValidationDatabaseReady: vi.fn(async () => ({
    status: "PASS",
    reasonCode: "DB_READY",
    reasonDetail: "ok",
    checkedAt: new Date().toISOString(),
    databaseUrlConfigured: true,
    requiredTables: [],
    missingTables: [],
    migrationTablePresent: true,
    latestMigration: "20260831_init",
  })),
}));

import { runPreValidationGate } from "@/src/server/forensics/prevalidation-gate.service";

describe("prevalidation gate", () => {
  it("returns READY when all mandatory checks pass", async () => {
    const result = await runPreValidationGate({
      buildPass: true,
      typecheckPass: true,
      typecheckErrorCount: 0,
      reportGeneratorReady: true,
      mfeConversionReady: true,
      captureRatioReady: true,
      rankCalibrationReady: true,
      latencyReady: true,
      resourceTelemetryReady: true,
      wsHardeningReady: true,
      breakerReady: true,
      paperExecutionReady: true,
      legacyExecutionInvocationCount: 0,
    });
    expect(result.status).toBe("READY");
    expect(result.blockers.length).toBe(0);
  });

  it("returns NOT_READY when build/typecheck fail", async () => {
    const result = await runPreValidationGate({
      buildPass: false,
      typecheckPass: false,
      typecheckErrorCount: 12,
    });
    expect(result.status).toBe("NOT_READY");
    expect(result.blockers.some((row) => row.includes("BUILD_PASS"))).toBe(true);
    expect(result.blockers.some((row) => row.includes("TYPECHECK_PASS"))).toBe(true);
  });
});
