import { runPreValidationGate } from "@/src/server/forensics/prevalidation-gate.service";

async function main() {
  const result = await runPreValidationGate({
    buildPass: process.env.PHASE07_BUILD_PASS === "true",
    typecheckPass: process.env.PHASE07_TYPECHECK_PASS === "true",
    typecheckErrorCount: Number(process.env.PHASE07_TYPECHECK_ERROR_COUNT ?? "9999"),
    reportGeneratorReady: process.env.PHASE07_REPORT_READY === "true",
    mfeConversionReady: process.env.PHASE07_MFE_READY === "true",
    captureRatioReady: process.env.PHASE07_CAPTURE_READY === "true",
    rankCalibrationReady: process.env.PHASE07_RANK_READY === "true",
    latencyReady: process.env.PHASE07_LATENCY_READY === "true",
    resourceTelemetryReady: process.env.PHASE07_RESOURCE_READY === "true",
    wsHardeningReady: process.env.PHASE07_WS_READY === "true",
    breakerReady: process.env.PHASE07_BREAKER_READY === "true",
    paperExecutionReady: process.env.PHASE07_PAPER_READY === "true",
    legacyExecutionInvocationCount: Number(process.env.PHASE07_LEGACY_EXECUTION_COUNT ?? "0"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.status === "READY" ? 0 : 1);
}

void main();
