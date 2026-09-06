import { createHash } from "node:crypto";
import type { MatchedEntryManifest } from "@/src/server/profitability/pr04-types";
import type { InvalidationContract } from "@/src/server/profitability/pr03-types";
import type { StrategyId } from "@/src/server/forensics/p4-regime-strategy-shadow";
import type { RiskReference } from "@/src/server/profitability/pr04-types";

export function buildMatchedEntryManifest(input: {
  entrySignalId: string;
  strategyId: StrategyId;
  entryPolicyVersion: string;
  entryAtMs: number;
  fills: Array<{ price: number; quantity: number; fee: number; atMs: number }>;
  riskReference: RiskReference;
  invalidation: InvalidationContract | null;
  featureEvidenceIds: string[];
  dataSource: string;
  replayWindow: { fromMs: number; toMs: number };
  symbol?: string | null;
  regime?: string | null;
  closedAtMs?: number | null;
}): MatchedEntryManifest {
  const initialQuantity = input.fills.reduce((acc, row) => acc + row.quantity, 0);
  const body = JSON.stringify({
    entrySignalId: input.entrySignalId,
    strategyId: input.strategyId,
    entryPolicyVersion: input.entryPolicyVersion,
    entryAtMs: input.entryAtMs,
    fills: input.fills,
    initialQuantity,
    riskReference: input.riskReference,
    invalidation: input.invalidation,
    featureEvidenceIds: input.featureEvidenceIds,
    dataSource: input.dataSource,
    replayWindow: input.replayWindow,
    symbol: input.symbol ?? null,
    regime: input.regime ?? null,
    closedAtMs: input.closedAtMs ?? null,
  });
  const manifestHash = createHash("sha256").update(body).digest("hex");
  return {
    manifestId: manifestHash.slice(0, 24),
    manifestHash,
    entrySignalId: input.entrySignalId,
    strategyId: input.strategyId,
    entryPolicyVersion: input.entryPolicyVersion,
    entryAtMs: input.entryAtMs,
    fills: input.fills,
    initialQuantity,
    riskReference: input.riskReference,
    invalidation: input.invalidation,
    featureEvidenceIds: input.featureEvidenceIds,
    dataSource: input.dataSource,
    replayWindow: input.replayWindow,
    symbol: input.symbol ?? null,
    regime: input.regime ?? null,
    closedAtMs: input.closedAtMs ?? null,
  };
}

export function verifyManifestImmutable(original: MatchedEntryManifest, candidate: MatchedEntryManifest) {
  return original.manifestHash === candidate.manifestHash;
}
