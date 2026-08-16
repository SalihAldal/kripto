import { describe, expect, it } from "vitest";
import {
  computeCompositeRoundProgress,
  computeRoundProgressPct,
  mapRuntimeStepToCoarseState,
} from "@/src/server/execution/round-runtime.types";

describe("round runtime types", () => {
  it("maps granular steps to coarse auto-round states", () => {
    expect(mapRuntimeStepToCoarseState("SYMBOL_SELECTED")).toBe("coin_secildi");
    expect(mapRuntimeStepToCoarseState("PUMP_SCAN")).toBe("tariyor");
    expect(mapRuntimeStepToCoarseState("ROUND_FAILED")).toBe("tur_basarisiz");
  });

  it("computes monotonic composite progress across phases", () => {
    const early = computeCompositeRoundProgress({
      roundNo: 1,
      totalRounds: 10,
      step: "PUMP_SCAN",
      selectionAttempt: 1,
      maxSelectionAttempts: 3,
      retryCount: 0,
      candidatesProcessed: 2,
      candidatesRemaining: 8,
      pumpTotal: 10,
      pumpProcessed: 2,
      currentPipeline: "pump-cache",
    });
    const later = computeCompositeRoundProgress({
      roundNo: 1,
      totalRounds: 10,
      step: "SYMBOL_SELECTED",
      selectionAttempt: 1,
      maxSelectionAttempts: 3,
      retryCount: 0,
      candidatesProcessed: 10,
      candidatesRemaining: 0,
      scannerTotal: 10,
      executionPhasePct: 88,
    });
    expect(later.overall).toBeGreaterThan(early.overall);
    expect(later.intraRound).toBeGreaterThan(early.intraRound);
  });

  it("uses scanner checkpoint ratio for scanner progress", () => {
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
      currentPipeline: "scanner-full",
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
      currentPipeline: "scanner-full",
    });
    expect(at100.scanner).toBe(100);
    expect(at100.overall).toBeGreaterThan(at48.overall);
    expect(at100.intraRound).toBeGreaterThan(at48.intraRound);
    expect(at48.scanner).toBe(48);
  });

  it("does not depend on elapsed time for scanner progress", () => {
    const progress = computeRoundProgressPct({
      roundNo: 1,
      totalRounds: 100,
      step: "SCANNING",
      selectionAttempt: 1,
      maxSelectionAttempts: 3,
      retryCount: 0,
      candidatesProcessed: 75,
      candidatesRemaining: 25,
      scannerTotal: 100,
      currentScannerPhase: "context",
    });
    expect(progress).toBeGreaterThan(0.2);
  });
});
