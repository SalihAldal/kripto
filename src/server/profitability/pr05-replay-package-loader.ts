import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import type { StrategyId } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { buildMatchedEntryManifest } from "@/src/server/profitability/pr04-matched-entry-manifest";
import type { Pr04ExitReplayTick } from "@/src/server/profitability/pr04-replay";
import { buildRiskReference } from "@/src/server/profitability/pr04-structural-stop";
import type { InvalidationContract } from "@/src/server/profitability/pr03-types";
import type { MatchedEntryManifest } from "@/src/server/profitability/pr04-types";

export const PR05_REPLAY_PACKAGE_SCHEMA = "pr05-replay-package-v1" as const;

export type Pr05ReplayPackageManifest = {
  schemaVersion: typeof PR05_REPLAY_PACKAGE_SCHEMA;
  datasetId: string;
  sourceType: "recorded" | "synthetic" | "retrospective";
  venue: string;
  instrument: string;
  quote: string;
  timeRange: { fromMs: number; toMs: number };
  hasEventAt: boolean;
  hasAvailableAt: boolean;
  resolution: string;
  knownGaps: string[];
  feeMetadata: boolean;
  historicalUniverse: boolean;
  priorUsage: string;
  contentHashes: Record<string, string>;
  entries: Array<{
    entrySignalId: string;
    strategyId: StrategyId;
    entryPolicyVersion: string;
    entryAtMs: number;
    symbol?: string | null;
    regime?: string | null;
    fills: Array<{ price: number; quantity: number; fee: number; atMs: number }>;
    invalidation?: InvalidationContract | null;
    featureEvidenceIds?: string[];
    replayWindow: { fromMs: number; toMs: number };
    ticksFile: string;
  }>;
};

export type Pr05ReplayPackageLoadResult = {
  status: "LOADED" | "NOT_FOUND" | "INVALID_SCHEMA" | "HASH_MISMATCH" | "PATH_TRAVERSAL" | "MISSING_FILE";
  packageDir: string;
  manifest?: Pr05ReplayPackageManifest;
  manifests?: MatchedEntryManifest[];
  ticksByManifestId?: Record<string, Pr04ExitReplayTick[]>;
  reason: string;
  fitnessForMarketExperiment: "FIT" | "NOT_FIT" | "UNKNOWN";
  fitnessForEngineeringReplay: "FIT" | "NOT_FIT" | "UNKNOWN";
};

const DEFAULT_DATA_ROOT = join(process.cwd(), "data", "replay-packages");

function sha256File(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isPathInsideRoot(root: string, target: string) {
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}\\`) || normalizedTarget.startsWith(`${normalizedRoot}/`);
}

export function validateReplayPackageManifest(raw: unknown): Pr05ReplayPackageManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Partial<Pr05ReplayPackageManifest>;
  if (m.schemaVersion !== PR05_REPLAY_PACKAGE_SCHEMA) return null;
  if (!m.datasetId || !m.sourceType || !m.venue || !m.instrument || !Array.isArray(m.entries)) return null;
  if (!m.timeRange || typeof m.timeRange.fromMs !== "number" || typeof m.timeRange.toMs !== "number") return null;
  if (!m.contentHashes || typeof m.contentHashes !== "object") return null;
  for (const entry of m.entries) {
    if (!entry.entrySignalId || !entry.strategyId || !entry.ticksFile) return null;
    if (!Array.isArray(entry.fills) || entry.fills.length === 0) return null;
    if (!entry.replayWindow) return null;
  }
  return m as Pr05ReplayPackageManifest;
}

export function loadPr05ReplayPackage(input?: {
  packageId?: string;
  dataRoot?: string;
}): Pr05ReplayPackageLoadResult {
  const dataRoot = input?.dataRoot ?? DEFAULT_DATA_ROOT;
  if (!existsSync(dataRoot)) {
    return {
      status: "NOT_FOUND",
      packageDir: dataRoot,
      reason: "REPLAY_PACKAGE_ROOT_NOT_FOUND",
      fitnessForMarketExperiment: "NOT_FIT",
      fitnessForEngineeringReplay: "NOT_FIT",
    };
  }
  const packageId = input?.packageId ?? discoverFirstPackageId(dataRoot);
  if (!packageId) {
    return {
      status: "NOT_FOUND",
      packageDir: dataRoot,
      reason: "NO_REPLAY_PACKAGE_DIRECTORY",
      fitnessForMarketExperiment: "NOT_FIT",
      fitnessForEngineeringReplay: "NOT_FIT",
    };
  }
  const packageDir = join(dataRoot, packageId);
  const manifestPath = join(packageDir, "package.manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      status: "NOT_FOUND",
      packageDir,
      reason: "PACKAGE_MANIFEST_NOT_FOUND",
      fitnessForMarketExperiment: "NOT_FIT",
      fitnessForEngineeringReplay: "NOT_FIT",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return {
      status: "INVALID_SCHEMA",
      packageDir,
      reason: "MANIFEST_JSON_PARSE_FAILED",
      fitnessForMarketExperiment: "NOT_FIT",
      fitnessForEngineeringReplay: "NOT_FIT",
    };
  }
  const manifest = validateReplayPackageManifest(parsed);
  if (!manifest) {
    return {
      status: "INVALID_SCHEMA",
      packageDir,
      reason: "MANIFEST_SCHEMA_INVALID",
      fitnessForMarketExperiment: "NOT_FIT",
      fitnessForEngineeringReplay: "NOT_FIT",
    };
  }
  const manifests: MatchedEntryManifest[] = [];
  const ticksByManifestId: Record<string, Pr04ExitReplayTick[]> = {};
  for (const entry of manifest.entries) {
    const ticksRel = normalize(entry.ticksFile).replace(/^(\.\.(\/|\\|$))+/, "");
    if (ticksRel.includes("..")) {
      return {
        status: "PATH_TRAVERSAL",
        packageDir,
        manifest,
        reason: `PATH_TRAVERSAL_BLOCKED:${entry.ticksFile}`,
        fitnessForMarketExperiment: "NOT_FIT",
        fitnessForEngineeringReplay: "NOT_FIT",
      };
    }
    const ticksPath = join(packageDir, ticksRel);
    if (!isPathInsideRoot(packageDir, ticksPath)) {
      return {
        status: "PATH_TRAVERSAL",
        packageDir,
        manifest,
        reason: `PATH_OUTSIDE_PACKAGE:${entry.ticksFile}`,
        fitnessForMarketExperiment: "NOT_FIT",
        fitnessForEngineeringReplay: "NOT_FIT",
      };
    }
    if (!existsSync(ticksPath)) {
      return {
        status: "MISSING_FILE",
        packageDir,
        manifest,
        reason: `TICKS_FILE_MISSING:${entry.ticksFile}`,
        fitnessForMarketExperiment: "NOT_FIT",
        fitnessForEngineeringReplay: "NOT_FIT",
      };
    }
    const relKey = ticksRel.replace(/\\/g, "/");
    const expectedHash = manifest.contentHashes[relKey];
    if (expectedHash) {
      const actualHash = sha256File(ticksPath);
      if (actualHash !== expectedHash) {
        return {
          status: "HASH_MISMATCH",
          packageDir,
          manifest,
          reason: `HASH_MISMATCH:${relKey}`,
          fitnessForMarketExperiment: "NOT_FIT",
          fitnessForEngineeringReplay: "NOT_FIT",
        };
      }
    }
    const ticks = JSON.parse(readFileSync(ticksPath, "utf8")) as Pr04ExitReplayTick[];
    const entryPrice = entry.fills.reduce((acc, row) => acc + row.price * row.quantity, 0) / Math.max(
      entry.fills.reduce((acc, row) => acc + row.quantity, 0),
      1e-9,
    );
    const initialQty = entry.fills.reduce((acc, row) => acc + row.quantity, 0);
    const invalidation = entry.invalidation ?? null;
    const stopPrice = invalidation?.invalidationThreshold ?? entryPrice * 0.992;
    const matched = buildMatchedEntryManifest({
      entrySignalId: entry.entrySignalId,
      strategyId: entry.strategyId,
      entryPolicyVersion: entry.entryPolicyVersion,
      entryAtMs: entry.entryAtMs,
      fills: entry.fills,
      riskReference: buildRiskReference({
        entryPrice,
        initialStopPrice: stopPrice,
        initialQuantity: initialQty,
        entryFee: entry.fills.reduce((acc, row) => acc + row.fee, 0),
        includesFeesInBreakEven: true,
        computedAtMs: entry.entryAtMs,
      }),
      invalidation,
      featureEvidenceIds: entry.featureEvidenceIds ?? [],
      dataSource: manifest.sourceType === "synthetic" ? "SYNTHETIC_FIXTURE" : "RECORDED_REPLAY",
      replayWindow: entry.replayWindow,
      symbol: entry.symbol ?? manifest.instrument,
      regime: entry.regime ?? null,
    });
    manifests.push(matched);
    ticksByManifestId[matched.manifestId] = ticks;
  }
  const fitnessForMarketExperiment = manifest.sourceType === "recorded" ? "FIT" : "NOT_FIT";
  const fitnessForEngineeringReplay = manifests.length > 0 ? "FIT" : "NOT_FIT";
  return {
    status: "LOADED",
    packageDir,
    manifest,
    manifests,
    ticksByManifestId,
    reason: manifest.sourceType === "synthetic" ? "SYNTHETIC_ENGINEERING_REPLAY_ONLY" : "RECORDED_PACKAGE_LOADED",
    fitnessForMarketExperiment,
    fitnessForEngineeringReplay,
  };
}

export function discoverReplayPackageIds(dataRoot = DEFAULT_DATA_ROOT) {
  if (!existsSync(dataRoot)) return [];
  return readdirSync(dataRoot, { withFileTypes: true })
    .filter((row) => row.isDirectory())
    .map((row) => row.name)
    .filter((name) => existsSync(join(dataRoot, name, "package.manifest.json")));
}

function discoverFirstPackageId(dataRoot: string) {
  const ids = discoverReplayPackageIds(dataRoot);
  return ids[0] ?? null;
}

export function assessDataSufficiency(input: {
  sourceType: Pr05ReplayPackageManifest["sourceType"];
  entryCount: number;
  hasEventAt: boolean;
  hasAvailableAt: boolean;
  feeMetadata: boolean;
  historicalUniverse: boolean;
}) {
  const reasons: string[] = [];
  if (input.entryCount === 0) reasons.push("PACKAGE_EMPTY");
  if (!input.hasEventAt) reasons.push("EVENT_AT_MISSING");
  if (!input.hasAvailableAt) reasons.push("AVAILABLE_AT_MISSING");
  const engineeringReplay = input.entryCount > 0 && input.hasEventAt ? "FIT" : "NOT_FIT";
  const exitAnalysis = input.entryCount > 0 && input.hasEventAt ? "FIT" : "NOT_FIT";
  const marketExperiment =
    input.sourceType === "recorded" && input.entryCount >= 20 && input.hasEventAt && input.hasAvailableAt && input.feeMetadata
      ? "FIT"
      : "NOT_FIT";
  const fullStrategyReplay =
    input.sourceType === "recorded" && input.entryCount >= 20 && input.historicalUniverse ? "FIT" : "NOT_FIT";
  return { engineeringReplay, exitAnalysis, marketExperiment, fullStrategyReplay, reasons };
}
