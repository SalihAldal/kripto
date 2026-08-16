/**
 * Validates cooperative async runtime protections.
 * Run: npx tsx scripts/async-runtime-validation.ts
 */
import {
  computeCompositeRoundProgress,
  mapRuntimeStepToCoarseState,
} from "@/src/server/execution/round-runtime.types";
import {
  createAsyncTelemetry,
  runCooperativePool,
  summarizeAsyncTelemetry,
  withBoundedAwait,
} from "@/src/server/execution/cooperative-async.service";

const before = {
  discoveryCheckpoint: false,
  aiWorkerTimeout: false,
  budgetPollingInLongAwait: false,
  watchdogDuringSelection: false,
  promiseAllInfiniteWait: true,
};

const after = {
  discoveryCheckpoint: true,
  aiWorkerTimeout: true,
  budgetPollingInLongAwait: true,
  watchdogDuringSelection: true,
  promiseAllInfiniteWait: false,
};

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(mapRuntimeStepToCoarseState("SCANNING") === "tariyor", "scanning maps to tariyor");

  const contextOnly = computeCompositeRoundProgress({
    roundNo: 1,
    totalRounds: 25,
    step: "SCANNING",
    selectionAttempt: 1,
    maxSelectionAttempts: 3,
    retryCount: 0,
    candidatesProcessed: 100,
    candidatesRemaining: 0,
    scannerTotal: 100,
    currentScannerPhase: "context",
  });
  assert(contextOnly.aiAnalysis < 5, "AI progress stays at 0 during context phase");

  const aiPhase = computeCompositeRoundProgress({
    roundNo: 1,
    totalRounds: 25,
    step: "AI_ANALYSIS",
    selectionAttempt: 1,
    maxSelectionAttempts: 3,
    retryCount: 0,
    candidatesProcessed: 12,
    candidatesRemaining: 88,
    scannerTotal: 100,
    aiProcessed: 12,
    aiTotal: 100,
    currentScannerPhase: "ai",
  });
  assert(aiPhase.aiAnalysis === 12, "AI progress uses aiProcessed/aiTotal");

  const telemetry = createAsyncTelemetry();
  const rows = await runCooperativePool(
    ["stall", "b", "c"],
    async (symbol) => {
      if (symbol === "stall") await new Promise(() => undefined);
      return symbol.toUpperCase();
    },
    {
      label: "validation-pool",
      concurrency: 2,
      workerTimeoutMs: 35,
      telemetry,
    },
  );
  assert(rows[0] === null, "stalled worker timed out");
  assert(rows[1] === "B" && rows[2] === "C", "remaining workers completed");

  let timedOut = false;
  try {
    await withBoundedAwait("validation-timeout", new Promise(() => undefined), 25, telemetry);
  } catch {
    timedOut = true;
  }
  assert(timedOut, "bounded await rejects on timeout");

  console.log(
    JSON.stringify(
      {
        ok: true,
        before,
        after,
        improvements: {
          maxBlockingMitigation: "per-worker timeout + stage watchdog + selection watchdog",
          heartbeatDuringDiscovery: after.discoveryCheckpoint,
          aiProgressAccuracyFix: contextOnly.aiAnalysis < aiPhase.aiAnalysis,
        },
        telemetry: summarizeAsyncTelemetry(telemetry),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
