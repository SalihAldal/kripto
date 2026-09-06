import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  PR05_SCHEMA_VERSION,
  type Pr05DataInventoryReport,
  type DataInventoryEntry,
} from "@/src/server/profitability/pr05-types";

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
    reason: "Synthetic fixture must not be reported as market profitability",
  });

  entries.push({
    sourceId: "kripto-p2-historical-paired-dataset",
    path: "kripto-p2-historical-paired-dataset.json",
    sourceClass: existsSync(join(ROOT, "kripto-p2-historical-paired-dataset.json"))
      ? "PRIOR_DEVELOPMENT_TOUCHED"
      : "MISSING",
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
    reason: "Metadata inventory without causal tick replay package",
  });

  entries.push({
    sourceId: "recorded-market-replay-package",
    path: "NOT_PRESENT",
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
    priorUsage: "Never collected in this worktree",
    fitnessForMarketExperiment: "NOT_FIT",
    reason: "PR01-DATA-01 / PR04-DATA-01 blocker",
  });

  const recordedMarketDatasetAvailable = entries.some(
    (e) => e.sourceClass === "RECORDED_MARKET" && e.fitnessForMarketExperiment === "FIT",
  );
  const blockers: string[] = [];
  if (!recordedMarketDatasetAvailable) blockers.push("PR05-DATA-01");

  return {
    schemaVersion: PR05_SCHEMA_VERSION,
    generatedAtMs: nowMs,
    recordedMarketDatasetAvailable,
    holdoutProvenance: "HOLDOUT_PROVENANCE_UNKNOWN",
    entries,
    blockers,
  };
}
