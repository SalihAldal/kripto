/**
 * Validates non-blocking round runtime architecture.
 * Run: npx tsx scripts/round-engine-runtime-validation.ts
 */
import { computeCompositeRoundProgress, mapRuntimeStepToCoarseState } from "@/src/server/execution/round-runtime.types";
import { summarizeRuntimeMetrics } from "@/src/server/execution/round-runtime.service";

const before = {
  progressModel: "elapsed-time weighted",
  scannerUsesCheckpointRatio: false,
};

const after = {
  progressModel: "composite work-weighted",
  scannerUsesCheckpointRatio: true,
};

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function main() {
  assert(mapRuntimeStepToCoarseState("PUMP_CONFIRMATION") === "tariyor", "pump step maps to tariyor");
  assert(mapRuntimeStepToCoarseState("SYMBOL_SELECTED") === "coin_secildi", "symbol selected maps correctly");

  const at48 = computeCompositeRoundProgress({
    roundNo: 1,
    totalRounds: 100,
    step: "SCANNING",
    selectionAttempt: 1,
    maxSelectionAttempts: 3,
    retryCount: 0,
    candidatesProcessed: 48,
    candidatesRemaining: 52,
    scannerTotal: 100,
    currentScannerPhase: "context",
  });
  const at100 = computeCompositeRoundProgress({
    roundNo: 1,
    totalRounds: 100,
    step: "SCANNING",
    selectionAttempt: 1,
    maxSelectionAttempts: 3,
    retryCount: 0,
    candidatesProcessed: 100,
    candidatesRemaining: 0,
    scannerTotal: 100,
    currentScannerPhase: "context",
  });
  assert(at48.scanner === 48, "scanner sub-progress uses processed/total");
  assert(at100.scanner === 100, "scanner completes at checkpoint total");
  assert(at100.overall > at48.overall, "overall progress increases with scanner checkpoints");
  assert(at100.intraRound > at48.intraRound, "intra-round progress increases with scanner checkpoints");

  const metrics = summarizeRuntimeMetrics([
    {
      metadata: {
        runtime: {
          timeline: [{ kind: "heartbeat" }, { kind: "heartbeat" }],
        },
      },
      rounds: [
        {
          metadata: { runtime: { step: "ROUND_COMPLETED", elapsedMs: 12_000 } },
          endedAt: new Date(),
        },
      ],
    },
  ]);
  assert(metrics.avgHeartbeatEvents >= 2, "heartbeat telemetry summarized");

  console.log(
    JSON.stringify(
      {
        ok: true,
        before,
        after,
        scannerCheckpointSample: { at48: at48.overall, at100: at100.overall },
        metrics,
      },
      null,
      2,
    ),
  );
}

main();
