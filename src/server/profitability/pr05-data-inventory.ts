import { join } from "node:path";
import { existsSync } from "node:fs";
import {
  PR05_SCHEMA_VERSION,
  type Pr05DataInventoryReport,
  type DataInventoryEntry,
} from "@/src/server/profitability/pr05-types";
import {
  assessDataSufficiency,
  discoverReplayPackageIds,
  loadPr05ReplayPackage,
} from "@/src/server/profitability/pr05-replay-package-loader";

const ROOT = process.cwd();

export function buildPr05DataInventory(input?: { nowMs?: number }): Pr05DataInventoryReport {
  const nowMs = input?.nowMs ?? Date.now();
  const entries: DataInventoryEntry[] = [];

  const exchangeInfoPath = join(ROOT, "data", "exchange-info-tr.json");
  entries.push({
    sourceId: "exchange-info-tr",
    path: "data/exchange-info-tr.json",
    sourceClass: existsSync(exchangeInfoPath) ? "RETROSPECTIVE_METADATA" : "MISSING",
    venue: "BINANCE_TR",
    quoteCurrency: "TRY",
    timeRange: { fromMs: null, toMs: null },
    hasEventAt: false,
    hasAvailableAt: false,
    resolution: "venue-metadata",
    gapsKnown: false,
    feeMetadata: true,
    entryFillData: false,
    historicalUniverse: false,
    priorUsage: "PR01 universe filters; not a price replay source",
    fitnessForMarketExperiment: "NOT_FIT",
    fitnessForEngineeringReplay: "NOT_FIT",
    reason: "Static exchange filters only",
  });

  const scannerCursorPath = join(ROOT, "data", "scanner-cursor.json");
  entries.push({
    sourceId: "scanner-cursor",
    path: "data/scanner-cursor.json",
    sourceClass: existsSync(scannerCursorPath) ? "RETROSPECTIVE_METADATA" : "MISSING",
    venue: "BINANCE_TR",
    quoteCurrency: null,
    timeRange: { fromMs: null, toMs: null },
    hasEventAt: false,
    hasAvailableAt: false,
    resolution: "cursor-state",
    gapsKnown: true,
    feeMetadata: false,
    entryFillData: false,
    historicalUniverse: false,
    priorUsage: "Scanner runtime cursor",
    fitnessForMarketExperiment: "NOT_FIT",
    fitnessForEngineeringReplay: "NOT_FIT",
    reason: "Operational cursor, not historical replay",
  });

  entries.push({
    sourceId: "test-fixtures-inline",
    path: "tests/pr02|pr03|pr04|pr05 *.test.ts",
    sourceClass: "SYNTHETIC_FIXTURE",
    venue: "SYNTHETIC",
    quoteCurrency: "TRY",
    timeRange: { fromMs: Date.parse("2026-09-06T10:00:00.000Z"), toMs: Date.parse("2026-09-06T12:00:00.000Z") },
    hasEventAt: true,
    hasAvailableAt: true,
    resolution: "synthetic-tick/candle",
    gapsKnown: true,
    feeMetadata: true,
    entryFillData: true,
    historicalUniverse: false,
    priorUsage: "Engineering contract tests only",
    fitnessForMarketExperiment: "NOT_FIT",
    fitnessForEngineeringReplay: "FIT",
    reason: "Synthetic fixture must not be reported as market profitability",
  });

  const pairedPath = join(ROOT, "kripto-p2-historical-paired-dataset.json");
  entries.push({
    sourceId: "kripto-p2-historical-paired-dataset",
    path: "kripto-p2-historical-paired-dataset.json",
    sourceClass: existsSync(pairedPath) ? "PRIOR_DEVELOPMENT_TOUCHED" : "MISSING",
    venue: "BINANCE_TR",
    quoteCurrency: "TRY",
    timeRange: { fromMs: Date.parse("2026-08-13T00:00:00.000Z"), toMs: Date.parse("2026-08-22T00:00:00.000Z") },
    hasEventAt: false,
    hasAvailableAt: false,
    resolution: "forensic-run-inventory",
    gapsKnown: true,
    feeMetadata: false,
    entryFillData: false,
    historicalUniverse: false,
    priorUsage: "Prior forensic runs; mostly INCOMPLETE; tradeCount=0",
    fitnessForMarketExperiment: "NOT_FIT",
    fitnessForEngineeringReplay: "NOT_FIT",
    reason: "Metadata inventory without causal tick replay package",
  });

  const packageIds = discoverReplayPackageIds();
  const blockers: string[] = [];
  let recordedMarketDatasetAvailable = false;
  let holdoutProvenance: Pr05DataInventoryReport["holdoutProvenance"] = "HOLDOUT_PROVENANCE_UNKNOWN";

  if (!packageIds.length) {
    entries.push({
      sourceId: "recorded-market-replay-package",
      path: "data/replay-packages/*",
      sourceClass: "MISSING",
      venue: null,
      quoteCurrency: null,
      timeRange: { fromMs: null, toMs: null },
      hasEventAt: false,
      hasAvailableAt: false,
      resolution: "none",
      gapsKnown: true,
      feeMetadata: false,
      entryFillData: false,
      historicalUniverse: false,
      priorUsage: "No replay package directory discovered",
      fitnessForMarketExperiment: "NOT_FIT",
      fitnessForEngineeringReplay: "NOT_FIT",
      reason: "PR05-DATA-01: replay package not found",
    });
    blockers.push("PR05-DATA-01");
  } else {
    for (const packageId of packageIds) {
      const loaded = loadPr05ReplayPackage({ packageId });
      const manifest = loaded.manifest;
      const sufficiency = manifest
        ? assessDataSufficiency({
            sourceType: manifest.sourceType,
            entryCount: manifest.entries.length,
            hasEventAt: manifest.hasEventAt,
            hasAvailableAt: manifest.hasAvailableAt,
            feeMetadata: manifest.feeMetadata,
            historicalUniverse: manifest.historicalUniverse,
          })
        : null;
      const sourceClass =
        loaded.status === "LOADED"
          ? manifest?.sourceType === "recorded"
            ? "RECORDED_MARKET"
            : "SYNTHETIC_FIXTURE"
          : "MISSING";
      entries.push({
        sourceId: `replay-package:${packageId}`,
        path: loaded.packageDir.replace(ROOT, ".").replace(/\\/g, "/"),
        sourceClass,
        venue: manifest?.venue ?? null,
        quoteCurrency: manifest?.quote ?? null,
        timeRange: manifest?.timeRange ?? { fromMs: null, toMs: null },
        hasEventAt: manifest?.hasEventAt ?? false,
        hasAvailableAt: manifest?.hasAvailableAt ?? false,
        resolution: manifest?.resolution ?? "unknown",
        gapsKnown: (manifest?.knownGaps?.length ?? 0) > 0,
        feeMetadata: manifest?.feeMetadata ?? false,
        entryFillData: (loaded.manifests?.length ?? 0) > 0,
        historicalUniverse: manifest?.historicalUniverse ?? false,
        priorUsage: manifest?.priorUsage ?? "unknown",
        fitnessForMarketExperiment: loaded.fitnessForMarketExperiment,
        fitnessForEngineeringReplay: loaded.fitnessForEngineeringReplay,
        reason:
          loaded.status === "LOADED"
            ? loaded.reason
            : `${loaded.status}:${loaded.reason}`,
      });
      if (loaded.status !== "LOADED") {
        blockers.push(`PR05-PACKAGE-${loaded.status}`);
      }
      if (loaded.fitnessForMarketExperiment === "FIT") {
        recordedMarketDatasetAvailable = true;
        holdoutProvenance = manifest?.priorUsage?.toLowerCase().includes("untouched") ? "INDEPENDENT" : "HOLDOUT_PROVENANCE_UNKNOWN";
      }
      if (loaded.status === "LOADED" && sufficiency && sufficiency.marketExperiment === "NOT_FIT" && manifest?.sourceType === "synthetic") {
        blockers.push("PR05-DATA-01");
      }
    }
    if (!recordedMarketDatasetAvailable) blockers.push("PR05-DATA-01");
  }

  return {
    schemaVersion: PR05_SCHEMA_VERSION,
    generatedAtMs: nowMs,
    recordedMarketDatasetAvailable,
    holdoutProvenance,
    entries,
    blockers: [...new Set(blockers)],
  };
}

export function loadEngineeringReplayPackageInput() {
  const loaded = loadPr05ReplayPackage();
  if (loaded.status !== "LOADED" || !loaded.manifest || !loaded.manifests || !loaded.ticksByManifestId) {
    return null;
  }
  return {
    datasetId: loaded.manifest.datasetId,
    manifests: loaded.manifests,
    ticksByManifestId: loaded.ticksByManifestId,
    recordedMarketData: loaded.manifest.sourceType === "recorded",
    sourceType: loaded.manifest.sourceType,
  };
}
