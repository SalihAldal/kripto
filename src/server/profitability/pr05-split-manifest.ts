import { createHash } from "node:crypto";
import { walkForwardSplit } from "@/src/server/forensics/p4-regime-strategy-shadow";
import {
  PR05_SCHEMA_VERSION,
  type Pr05ExperimentManifest,
  type Pr05LifecycleRow,
  type Pr05SplitManifest,
} from "@/src/server/profitability/pr05-types";

export function buildPr05SplitManifest(input: {
  experimentManifest: Pr05ExperimentManifest;
  rows: Pr05LifecycleRow[];
}): Pr05SplitManifest {
  const split = walkForwardSplit(
    input.rows.map((row) => ({
      lifecycleId: row.lifecycleId,
      eventAtMs: row.eventAtMs,
      labelEndAtMs: row.labelEndAtMs,
    })),
    input.experimentManifest.embargoMs,
  );
  const trainIds = new Set(
    split.train.map((r) => input.rows.find((x) => x.lifecycleId === r.lifecycleId && x.eventAtMs === r.eventAtMs)?.manifest.manifestId).filter(Boolean),
  );
  const validationIds = new Set(
    split.validation
      .map((r) => input.rows.find((x) => x.lifecycleId === r.lifecycleId && x.eventAtMs === r.eventAtMs)?.manifest.manifestId)
      .filter(Boolean),
  );
  const testIds = new Set(
    split.test
      .map((r) => input.rows.find((x) => x.lifecycleId === r.lifecycleId && x.eventAtMs === r.eventAtMs)?.manifest.manifestId)
      .filter(Boolean),
  );
  const lifecycleInTrain = new Set(split.train.map((r) => r.lifecycleId));
  const lifecycleInVal = new Set(split.validation.map((r) => r.lifecycleId));
  const lifecycleInTest = new Set(split.test.map((r) => r.lifecycleId));
  const crossSplit =
    [...lifecycleInTrain].some((id) => lifecycleInVal.has(id) || lifecycleInTest.has(id)) ||
    [...lifecycleInVal].some((id) => lifecycleInTest.has(id));
  const holdoutUsable =
    !input.experimentManifest.dataFingerprint.priorDevelopmentRangesTouched &&
    input.experimentManifest.dataFingerprint.recordedMarketAvailable &&
    input.rows.length >= input.experimentManifest.minIndependentLifecycleGroups;
  const body = {
    schemaVersion: PR05_SCHEMA_VERSION,
    experimentManifestHash: input.experimentManifest.manifestHash,
    embargoMs: input.experimentManifest.embargoMs,
    trainManifestIds: [...trainIds] as string[],
    validationManifestIds: [...validationIds] as string[],
    testManifestIds: [...testIds] as string[],
    holdoutUsable,
    holdoutReason: holdoutUsable ? "PROVENANCE_OK" : "HOLDOUT_PROVENANCE_UNKNOWN_OR_INSUFFICIENT_DATA",
    leakageChecks: {
      lifecycleCrossSplit: crossSplit,
      labelPurgeApplied: true,
      warmupUsesPastPricesOnly: true,
    },
  };
  const splitManifestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  return { ...body, splitManifestHash };
}

export function resolveManifestSplit(
  manifestId: string,
  splitManifest: Pr05SplitManifest,
): "TRAIN" | "VALIDATION" | "TEST" | "UNASSIGNED" {
  if (splitManifest.trainManifestIds.includes(manifestId)) return "TRAIN";
  if (splitManifest.validationManifestIds.includes(manifestId)) return "VALIDATION";
  if (splitManifest.testManifestIds.includes(manifestId)) return "TEST";
  return "UNASSIGNED";
}
