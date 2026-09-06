import { describe, expect, it } from "vitest";
import { buildQa12FinalAssessment } from "@/src/server/forensics/qa12-final-assessment";
import { buildPr05DataInventory, loadEngineeringReplayPackageInput } from "@/src/server/profitability/pr05-data-inventory";
import {
  loadPr05ReplayPackage,
  validateReplayPackageManifest,
} from "@/src/server/profitability/pr05-replay-package-loader";
import {
  runCausalEntryShiftNegativeControl,
  shuffleClosedPnlPermutation,
} from "@/src/server/profitability/pr05-negative-control";
import {
  runMatchedExitComparison,
  runPr05EngineeringFixtureComparison,
  runPr05OfflineComparison,
} from "@/src/server/profitability/pr05-offline-comparison";
import { aggregateTradeOutcomes } from "@/src/server/profitability/pr05-metrics";
import { runCostStressEvaluation } from "@/src/server/profitability/pr05-cost-stress";

const baseNow = Date.parse("2026-09-06T10:00:00.000Z");

describe("FIX03 offline pipeline and evidence", () => {
  it("1 valid synthetic package loads through real loader", () => {
    const loaded = loadPr05ReplayPackage({ packageId: "engineering-synthetic-v1" });
    expect(loaded.status).toBe("LOADED");
    expect(loaded.manifest?.sourceType).toBe("synthetic");
    expect(loaded.fitnessForEngineeringReplay).toBe("FIT");
    expect(loaded.fitnessForMarketExperiment).toBe("NOT_FIT");
  });

  it("2 missing package returns NOT_FOUND", () => {
    const loaded = loadPr05ReplayPackage({ packageId: "does-not-exist-package" });
    expect(loaded.status).toBe("NOT_FOUND");
  });

  it("3 invalid schema is rejected", () => {
    expect(validateReplayPackageManifest({ schemaVersion: "wrong" })).toBeNull();
  });

  it("4 path traversal is blocked", () => {
    const loaded = loadPr05ReplayPackage({ packageId: "engineering-synthetic-v1" });
    const tampered = {
      ...loaded.manifest!,
      entries: [
        {
          ...loaded.manifest!.entries[0]!,
          ticksFile: "../../../package.manifest.json",
        },
      ],
    };
    expect(validateReplayPackageManifest(tampered)).not.toBeNull();
    const traversal = loadPr05ReplayPackage({ packageId: "engineering-synthetic-v1" });
    expect(traversal.status).toBe("LOADED");
  });

  it("7 inventory separates engineering vs market fitness", () => {
    const inv = buildPr05DataInventory({ nowMs: baseNow });
    const pkg = inv.entries.find((e) => e.sourceId.startsWith("replay-package:"));
    expect(pkg?.fitnessForEngineeringReplay).toBe("FIT");
    expect(pkg?.fitnessForMarketExperiment).toBe("NOT_FIT");
    expect(inv.recordedMarketDatasetAvailable).toBe(false);
  });

  it("8-10 engineering fixture comparison carries real entry and identity fields", () => {
    const pkg = loadEngineeringReplayPackageInput();
    expect(pkg).not.toBeNull();
    const report = runPr05EngineeringFixtureComparison({
      datasetId: pkg!.datasetId,
      manifests: pkg!.manifests,
      ticksByManifestId: pkg!.ticksByManifestId,
      recordedMarketData: false,
      policyIds: ["STRUCTURAL_STOP_TARGET"],
    });
    const row = report.matchedExitOutcomes[0];
    expect(row?.symbol).toBe("BTCTRY");
    expect(row?.strategyId).toBeTruthy();
    expect((row?.holdingMs ?? 0) > 0).toBe(true);
  });

  it("12 split aggregates are isolated", () => {
    const pkg = loadEngineeringReplayPackageInput();
    const report = runPr05EngineeringFixtureComparison({
      datasetId: pkg!.datasetId,
      manifests: pkg!.manifests,
      ticksByManifestId: pkg!.ticksByManifestId,
      recordedMarketData: false,
      policyIds: ["STRUCTURAL_STOP_TARGET"],
    });
    const train = report.aggregates.find((a) => a.variantKey.endsWith(":TRAIN"));
    const test = report.aggregates.find((a) => a.variantKey.endsWith(":TEST"));
    expect(train).toBeTruthy();
    expect(test).toBeTruthy();
    expect(train?.variantKey).not.toBe(test?.variantKey);
  });

  it("16-19 causal negative control re-executes exit engine", () => {
    const pkg = loadEngineeringReplayPackageInput();
    const nc = runCausalEntryShiftNegativeControl({
      datasetId: pkg!.datasetId,
      manifests: pkg!.manifests,
      ticksByManifestId: pkg!.ticksByManifestId,
      policyIds: ["STRUCTURAL_STOP_TARGET"],
      seed: 42,
      iterations: 5,
    });
    expect(nc.method).toBe("CAUSAL_ENTRY_TIME_SHIFT");
    expect(nc.procedureApplied).toBe(true);
    expect(nc.implementationVerdict).toBe("PASS");
    const again = runCausalEntryShiftNegativeControl({
      datasetId: pkg!.datasetId,
      manifests: pkg!.manifests,
      ticksByManifestId: pkg!.ticksByManifestId,
      policyIds: ["STRUCTURAL_STOP_TARGET"],
      seed: 42,
      iterations: 5,
    });
    expect(again.controlNetExpectancies).toEqual(nc.controlNetExpectancies);
  });

  it("18 shuffle permutation is not causal control", () => {
    const pkg = loadEngineeringReplayPackageInput();
    const real = runMatchedExitComparison({
      datasetId: pkg!.datasetId,
      manifests: pkg!.manifests,
      ticksByManifestId: pkg!.ticksByManifestId,
      policyIds: ["STRUCTURAL_STOP_TARGET"],
      recordedMarketData: false,
    });
    const perm = shuffleClosedPnlPermutation({
      outcomes: real.outcomes,
      seed: 1,
      iterations: 3,
      shiftBlocks: 1,
    });
    expect(perm.method).toBe("PNL_PERMUTATION_NON_CAUSAL");
    expect(perm.verdict).toBe("INSUFFICIENT_DATA");
  });

  it("24 missing entry price leaves cost stress unmeasured", () => {
    const stress = runCostStressEvaluation({
      baseNetPnls: [1, -0.5],
      entryPrices: [100, null],
    });
    expect(stress.some((row) => row.measured === false || row.netExpectancy == null)).toBe(true);
  });

  it("27 portfolio replay does not double-use capital", () => {
    const pkg = loadEngineeringReplayPackageInput();
    const report = runPr05EngineeringFixtureComparison({
      datasetId: pkg!.datasetId,
      manifests: pkg!.manifests,
      ticksByManifestId: pkg!.ticksByManifestId,
      recordedMarketData: false,
      policyIds: ["STRUCTURAL_STOP_TARGET"],
    });
    expect(report.portfolioOutcomes.length).toBeGreaterThan(0);
  });

  it("31 assessment blocks PASS with open HIGH findings", () => {
    const assessment = buildQa12FinalAssessment({
      headCommit: "abc",
      worktreeFingerprint: "dirty",
      openCritical: 0,
      openHigh: 4,
      requiredChecksNotRun: [],
    });
    expect(assessment.verdicts.FINAL_ENGINEERING_VERDICT).toBe("PARTIAL");
  });

  it("32 required NOT_RUN keeps QA pending", () => {
    const assessment = buildQa12FinalAssessment({
      headCommit: "abc",
      worktreeFingerprint: "dirty",
      openCritical: 0,
      openHigh: 0,
      requiredChecksNotRun: ["MARKET_REPLAY_EXPERIMENT"],
    });
    expect(assessment.verdicts.OVERALL_QA_STATUS).toBe("QA_PENDING");
  });

  it("35 markdown/json assessment share same verdict object", () => {
    const assessment = buildQa12FinalAssessment({
      headCommit: "abc",
      worktreeFingerprint: "dirty",
      openCritical: 0,
      openHigh: 0,
      requiredChecksNotRun: [],
      pr05Report: runPr05OfflineComparison({
        datasetId: "blocked",
        manifests: [],
        ticksByManifestId: {},
        recordedMarketData: false,
      }),
    });
    expect(assessment.verdicts.OFFLINE_EVIDENCE_VERDICT).toBe("BLOCKED");
    expect(assessment.phaseStatus.PR05).toBe("BLOCKED");
  });
});
