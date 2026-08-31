import { describe, expect, it, beforeEach } from "vitest";
import {
  clearProviderRegistryForTests,
  getProviderRegistryEntry,
  recordProviderOutcome,
  resetStaleProviderHealth,
  mutateProviderRegistryForTests,
} from "@/src/server/ai/ai-provider-health-registry.service";
import {
  attachProviderHealthState,
  classifyProviderHealthState,
  evaluateProviderHealthGate,
} from "@/src/server/ai/ai-provider-health.service";
import type { AIProviderResult } from "@/src/types/ai";

function laneRow(input: Partial<AIProviderResult> & { providerId: string }): AIProviderResult {
  return {
    providerName: input.providerId,
    ok: true,
    latencyMs: 5,
    output: {
      decision: "BUY",
      confidence: 72,
      riskScore: 30,
      targetPrice: 105,
      stopPrice: 98,
      estimatedDurationSec: 120,
      reasoningShort: "test",
      metadata: { remote: true, remoteOk: true },
    },
    ...input,
  };
}

describe("ai provider health registry", () => {
  beforeEach(() => {
    clearProviderRegistryForTests();
  });

  it("1) healthy provider recovery", () => {
    recordProviderOutcome({
      providerId: "provider-1",
      ok: false,
      remoteOk: false,
      healthState: "UNAVAILABLE",
      error: "timeout",
    });
    const after = recordProviderOutcome({
      providerId: "provider-1",
      ok: true,
      remoteOk: true,
      healthState: "HEALTHY",
    });
    expect(after.healthState).toBe("HEALTHY");
    expect(after.consecutiveFailures).toBe(0);
  });

  it("2) degraded provider stays provider-specific", () => {
    recordProviderOutcome({
      providerId: "provider-1",
      ok: true,
      remoteOk: true,
      healthState: "HEALTHY",
    });
    recordProviderOutcome({
      providerId: "provider-2",
      ok: false,
      remoteOk: false,
      healthState: "TIMEOUT",
      error: "timeout",
    });
    expect(getProviderRegistryEntry("provider-1").healthState).toBe("HEALTHY");
    expect(getProviderRegistryEntry("provider-2").healthState).toBe("TIMEOUT");
  });

  it("3) stale health metadata reset", () => {
    recordProviderOutcome({
      providerId: "provider-3",
      ok: false,
      remoteOk: false,
      healthState: "UNAVAILABLE",
      error: "remote",
    });
    mutateProviderRegistryForTests("provider-3", {
      lastFailureAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
    });
    expect(resetStaleProviderHealth("provider-3")).toBe(true);
    expect(getProviderRegistryEntry("provider-3").healthState).not.toBe("UNAVAILABLE");
  });

  it("4) unavailable expert excluded from consensus", () => {
    const healthy = attachProviderHealthState(
      laneRow({ providerId: "provider-1", remoteOk: true }),
    );
    const unavailable = attachProviderHealthState(
      laneRow({
        providerId: "provider-2",
        ok: false,
        output: undefined,
        error: "remote",
        failureCategory: "remote",
      }),
    );
    const evalResult = evaluateProviderHealthGate([healthy, unavailable, healthy]);
    expect(evalResult.eligibleForConsensus).toHaveLength(2);
    expect(evalResult.gate).toBe("PARTIAL_DEGRADATION");
  });

  it("5) provider-specific health classification", () => {
    expect(
      classifyProviderHealthState(
        laneRow({ providerId: "provider-1", ok: false, output: undefined, error: "timeout", failureCategory: "timeout" }),
      ),
    ).toBe("TIMEOUT");
    expect(classifyProviderHealthState(laneRow({ providerId: "provider-1", remoteOk: true }))).toBe("HEALTHY");
  });
});
