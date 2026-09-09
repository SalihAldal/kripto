import { describe, expect, it } from "vitest";
import { buildSignalIdempotencyKey, buildFillIdempotencyKeyFromExchange } from "@/src/server/trade-decision-core/execution-idempotency.service";
import { entryIntentToInvalidation, enrichSelectedSignalWithEntryIntent } from "@/src/server/trade-decision-core/production-adapter.service";
import { applyTradeDecisionCoreProductionBridge } from "@/src/server/trade-decision-core/production-bridge.service";
import { freezeSelectedStrategySignal } from "@/src/server/execution/fix01-selected-signal";
import type { EarlyEvaluationResult } from "@/src/server/profitability/pr02-types";
import type { EntrySignalIntent } from "@/src/server/trade-decision-core/types";

const baseIntent: EntrySignalIntent = {
  signalId: "baseline_fixed_8h_v2:BTCUSDT:1700000000000",
  strategyVersion: "baseline_fixed_8h_v2",
  variantId: "baseline_fixed_8h_v2",
  alphaId: "OI_IMPULSE_LONG_V2",
  side: "LONG",
  signalAtMs: 1_700_000_000_000,
  availableAtMs: 1_700_000_000_000,
  invalidationPrice: 98.5,
  invalidationCurrency: "TRY",
  reasonCodes: ["baseline_oi_v2", "OI_V2"],
  metadata: { tryPrice: 100 },
};

function buildEarlyDetail(): EarlyEvaluationResult {
  return {
    policyVersion: "pr02-v1",
    candidateId: "cand-1",
    lifecycleId: "life-1",
    setupId: "setup-1",
    featureSnapshotId: "feat-1",
    setupState: "TRIGGERED",
    evaluatedAt: "2026-09-06T10:00:00.000Z",
    trigger: {
      signalId: "early-sig-1",
      triggerAt: "2026-09-06T10:00:00.000Z",
      validUntil: "2026-09-06T10:05:00.000Z",
    },
    invalidation: {
      referenceLevel: 99,
      invalidationThreshold: 98,
      reasonCode: "EARLY_STRUCTURAL",
      computedAtMs: Date.parse("2026-09-06T10:00:00.000Z"),
      availableAtMs: Date.parse("2026-09-06T10:00:00.000Z"),
      validUntilMs: null,
      sourceObservations: ["baseline"],
    },
    strategyEvaluation: {
      evaluationId: "eval-1",
      candidateId: "cand-1",
      strategyId: "EARLY_ACCELERATION",
      policyVersion: "pr02-v1",
      sourceType: "LIVE_MARKET",
      evaluatedAt: "2026-09-06T10:00:00.000Z",
      marketEventAt: "2026-09-06T10:00:00.000Z",
      verdict: "ELIGIBLE",
      regimeCompatibility: 1,
      setupQuality: 1,
      entryTimingQuality: 1,
      executionQuality: 1,
      estimatedCostPercent: 0.1,
      minimumViableMovePercent: 0.2,
      reasons: [],
      firstBlocker: null,
      missingFeatures: [],
      staleFeatures: [],
      invalidFeatures: [],
      entryTrigger: "EARLY",
      invalidationReason: null,
      suggestedHorizon: "short",
      suggestedRiskProfile: "normal",
      suggestedExitProfile: "trail",
      shadowOnly: true,
    },
  };
}

describe("trade decision core production bridge", () => {
  it("disabled modda P4 signal id idempotency anahtarına taşınır", () => {
    const p4 = freezeSelectedStrategySignal("EARLY_ACCELERATION", buildEarlyDetail());
    const result = applyTradeDecisionCoreProductionBridge({
      enabled: false,
      variantId: "baseline_fixed_8h_v2",
      candidateMetadata: {},
      symbol: "BTCTRY",
      decisionAtMs: Date.parse("2026-09-06T10:00:00.000Z"),
      p4SelectedSignal: p4,
      p4PreferredStrategy: "EARLY_ACCELERATION",
      candidateId: "cand-1",
      lifecycleId: "life-1",
      featureSnapshotId: "feat-1",
      mode: "paper",
      fallbackIdempotencyKey: "auto:default:paper",
    });
    expect(result.status).toBe("disabled");
    expect(result.signalIdempotencyKey).toBe(buildSignalIdempotencyKey("early-sig-1"));
  });

  it("entry intent invalidation sözleşmesi üretir ve P4 sinyalini zenginleştirir", () => {
    const invalidation = entryIntentToInvalidation(baseIntent);
    expect(invalidation.reasonCode).toBe("TDC_OI_INVALIDATION");
    expect(invalidation.invalidationThreshold).toBe(98.5);

    const p4 = freezeSelectedStrategySignal("EARLY_ACCELERATION", buildEarlyDetail());
    const enriched = enrichSelectedSignalWithEntryIntent({
      base: p4,
      intent: baseIntent,
      candidateId: "cand-1",
      lifecycleId: "life-1",
      featureSnapshotId: "feat-1",
    });
    expect(enriched.signalId).toBe(baseIntent.signalId);
    expect(enriched.invalidation?.reasonCode).toBe("EARLY_STRUCTURAL");
  });

  it("fill idempotency canonical settlement kimliğini kullanır", () => {
    const key = buildFillIdempotencyKeyFromExchange({
      venue: "BINANCE_TR",
      exchangeConnectionId: "conn-1",
      symbol: "BTCTRY",
      exchangeOrderId: "ord-1",
      exchangeTradeId: "trade-1",
    });
    expect(key.startsWith("tdc:fill:")).toBe(true);
    expect(key.length).toBeGreaterThan(20);
  });
});
