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
    edgeValidationReady: process.env.PHASE07_EDGE_READY === "true",
    edgeMeasurementPipelineReady: process.env.PHASE07_EDGE_MEASUREMENT_READY === "true",
    edgeProvenStatus: (process.env.PHASE07_EDGE_PROVEN_STATUS as "UNKNOWN" | "NOT_TESTED" | "PROVEN" | "NOT_PROVEN" | undefined) ?? "UNKNOWN",
    outcomeFinalizerReady: process.env.PHASE07_OUTCOME_FINALIZER_READY === "true",
    outcomeRestartRecoveryReady: process.env.PHASE07_OUTCOME_RECOVERY_READY === "true",
    groundTruthPersistenceReady: process.env.PHASE07_MOVER_PERSIST_READY === "true",
    moverJoinReady: process.env.PHASE07_MOVER_JOIN_READY === "true",
    missedOpportunityReady: process.env.PHASE07_MISSED_READY === "true",
    funnelViabilityReady: process.env.PHASE07_FUNNEL_VIABILITY_READY === "true",
    canProduceHot: process.env.PHASE07_CAN_PRODUCE_HOT === "true",
    canProduceMicroConfirmed: process.env.PHASE07_CAN_PRODUCE_MICRO_CONFIRMED === "true",
    canProduceFinalRanked: process.env.PHASE07_CAN_PRODUCE_FINAL_RANKED === "true",
    canProduceExecutionReady: process.env.PHASE07_CAN_PRODUCE_EXECUTION_READY === "true",
    canProduceRiskAllow: process.env.PHASE07_CAN_PRODUCE_RISK_ALLOW === "true",
    canProducePaperOpen: process.env.PHASE07_CAN_PRODUCE_PAPER_OPEN === "true",
    positionExitReady: process.env.PHASE07_POSITION_EXIT_READY === "true",
    legacyExecutionInvocationCount: Number(process.env.PHASE07_LEGACY_EXECUTION_COUNT ?? "0"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.status === "READY" ? 0 : 1);
}

void main();
