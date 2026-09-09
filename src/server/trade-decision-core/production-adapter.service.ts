import type { StrategyId } from "@/src/server/forensics/p4-regime-strategy-shadow";
import {
  FIX01_SELECTED_SIGNAL_SCHEMA,
  type SelectedStrategySignal,
} from "@/src/server/execution/fix01-selected-signal";
import type { InvalidationContract } from "@/src/server/profitability/pr03-types";
import type { EntrySignalIntent } from "./types";

export function entryIntentToInvalidation(intent: EntrySignalIntent): InvalidationContract {
  if (intent.invalidationCurrency !== "TRY" || !Number.isFinite(intent.invalidationPrice) || !(intent.invalidationPrice! > 0)) {
    throw new Error("TDC_INVALIDATION_CURRENCY_OR_PRICE_INVALID");
  }
  const reference = Number(intent.metadata.tryPrice ?? intent.invalidationPrice);
  return {
    referenceLevel: reference,
    invalidationThreshold: intent.invalidationPrice ?? reference,
    reasonCode: "TDC_OI_INVALIDATION",
    computedAtMs: intent.signalAtMs,
    availableAtMs: intent.availableAtMs,
    validUntilMs: null,
    sourceObservations: [...intent.reasonCodes],
  };
}

export function enrichSelectedSignalWithEntryIntent(input: {
  base: SelectedStrategySignal | null;
  intent: EntrySignalIntent;
  candidateId: string;
  lifecycleId: string;
  featureSnapshotId: string;
  carrierStrategyId?: StrategyId;
}): SelectedStrategySignal {
  const invalidation = entryIntentToInvalidation(input.intent);
  if (input.base) {
    return {
      ...input.base,
      signalId: input.intent.signalId,
      invalidation: input.base.invalidation ?? invalidation,
      sourceObservations: [
        ...input.base.sourceObservations,
        ...input.intent.reasonCodes.filter((code) => !input.base!.sourceObservations.includes(code)),
      ],
    };
  }
  const carrier = input.carrierStrategyId ?? "MOMENTUM_CONTINUATION";
  return {
    schemaVersion: FIX01_SELECTED_SIGNAL_SCHEMA,
    strategyId: carrier,
    policyVersion: input.intent.strategyVersion,
    candidateId: input.candidateId,
    lifecycleId: input.lifecycleId,
    setupId: `${input.intent.variantId}:${input.intent.signalAtMs}`,
    signalId: input.intent.signalId,
    featureSnapshotId: input.featureSnapshotId,
    setupState: "TDC_ENTRY",
    triggerAt: new Date(input.intent.signalAtMs).toISOString(),
    validUntil: null,
    invalidation,
    evaluationId: `tdc:${input.intent.signalId}`,
    frozenAt: new Date(input.intent.availableAtMs).toISOString(),
    sourceObservations: [...input.intent.reasonCodes],
  };
}

export function buildTradeDecisionCorePositionMetadata(intent: EntrySignalIntent) {
  return {
    tradeDecisionCore: {
      signalId: intent.signalId,
      variantId: intent.variantId,
      alphaId: intent.alphaId,
      strategyVersion: intent.strategyVersion,
      signalAtMs: intent.signalAtMs,
      availableAtMs: intent.availableAtMs,
      invalidationPrice: intent.invalidationPrice,
      reasonCodes: intent.reasonCodes,
    },
  };
}
