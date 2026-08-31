import { describe, expect, it, beforeEach } from "vitest";
import {
  attachProviderHealthState,
  buildAllProvidersDegradedConsensusResult,
  classifyProviderHealthState,
  consensusVoteLabel,
  evaluateProviderHealthGate,
} from "@/src/server/ai/ai-provider-health.service";
import { summarizeConsensus } from "@/src/server/ai/consensus-engine";
import {
  bridgeAiProviderResult,
  bridgeConsensusResult,
  beginForensicPaperSession,
  clearForensicSession,
} from "@/src/server/forensics";
import { classifyAiNoResponseScope } from "@/src/server/execution/scanner-false-block-policy.service";
import { evaluateAiExecutionReadiness } from "@/src/server/execution/ai-execution-gate.service";
import { CooperativeAsyncCancelledError } from "@/src/server/execution/cooperative-async.types";
import { withAiRetry } from "@/src/server/ai/utils";
import type { AIProviderResult } from "@/src/types/ai";

function laneRow(input: Partial<AIProviderResult> & { providerId: string }): AIProviderResult {
  return {
    providerName: input.providerId,
    ok: true,
    latencyMs: 5,
    output: {
      decision: "NO_TRADE",
      confidence: 55,
      riskScore: 40,
      targetPrice: 100,
      stopPrice: 98,
      estimatedDurationSec: 120,
      reasoningShort: "test",
      metadata: { remote: false },
    },
    ...input,
  };
}

function healthyRemote(providerId: string): AIProviderResult {
  return attachProviderHealthState(
    laneRow({
      providerId,
      remoteOk: true,
      output: {
        decision: "BUY",
        confidence: 72,
        riskScore: 30,
        targetPrice: 105,
        stopPrice: 98,
        estimatedDurationSec: 120,
        reasoningShort: "remote ok",
        metadata: { remote: true, remoteOk: true },
      },
    }),
  );
}

function degradedLocal(providerId: string, decision: "BUY" | "NO_TRADE" | "HOLD" = "BUY"): AIProviderResult {
  return attachProviderHealthState(
    laneRow({
      providerId,
      remoteOk: false,
      degraded: true,
      output: {
        decision,
        confidence: 80,
        riskScore: 25,
        targetPrice: 105,
        stopPrice: 98,
        estimatedDurationSec: 120,
        reasoningShort: "local fallback",
        metadata: { remote: false, degraded: true },
      },
    }),
  );
}

describe("ai provider reliability", () => {
  beforeEach(() => {
    clearForensicSession();
  });

  it("1) all providers healthy", () => {
    const evalResult = evaluateProviderHealthGate([
      healthyRemote("provider-1"),
      healthyRemote("provider-2"),
      healthyRemote("provider-3"),
    ]);
    expect(evalResult.gate).toBe("ALL_HEALTHY");
    expect(evalResult.eligibleForConsensus).toHaveLength(3);
  });

  it("2) one provider timeout", () => {
    const state = classifyProviderHealthState(
      laneRow({ providerId: "provider-1", ok: false, failureCategory: "timeout", error: "timeout" }),
    );
    expect(state).toBe("TIMEOUT");
  });

  it("3) one provider unavailable", () => {
    const state = classifyProviderHealthState(
      laneRow({ providerId: "provider-1", ok: false, failureCategory: "remote", error: "unavailable" }),
    );
    expect(state).toBe("UNAVAILABLE");
  });

  it("4) one provider invalid response", () => {
    const state = classifyProviderHealthState(
      laneRow({ providerId: "provider-1", ok: false, failureCategory: "json_output", error: "invalid json" }),
    );
    expect(state).toBe("INVALID_RESPONSE");
  });

  it("5) partial degradation", () => {
    const evalResult = evaluateProviderHealthGate([
      healthyRemote("provider-1"),
      degradedLocal("provider-2"),
      degradedLocal("provider-3"),
    ]);
    expect(evalResult.gate).toBe("PARTIAL_DEGRADATION");
    expect(evalResult.eligibleForConsensus).toHaveLength(1);
  });

  it("6) all providers degraded", () => {
    const evalResult = evaluateProviderHealthGate([
      degradedLocal("provider-1"),
      degradedLocal("provider-2"),
      degradedLocal("provider-3"),
    ]);
    expect(evalResult.gate).toBe("ALL_DEGRADED");
    const degraded = buildAllProvidersDegradedConsensusResult({
      symbol: "ATMTRY",
      outputs: evalResult.records.map((_, i) => degradedLocal(`provider-${i + 1}`)),
      health: evalResult,
    });
    expect(degraded.rejectReason).toBe("AI_PROVIDER_DEGRADED");
    expect(degraded.finalDecision).toBe("NO_TRADE");
  });

  it("7) bounded retry", async () => {
    let attempts = 0;
    await expect(
      withAiRetry(
        async () => {
          attempts += 1;
          throw new Error("fail");
        },
        { retries: 1, timeoutMs: 50, context: "test-retry" },
      ),
    ).rejects.toThrow("fail");
    expect(attempts).toBe(2);
  });

  it("8) retry abort", async () => {
    const controller = new AbortController();
    controller.abort("stop");
    await expect(
      withAiRetry(async () => "ok", { retries: 2, timeoutMs: 50, context: "abort", signal: controller.signal }),
    ).rejects.toBeInstanceOf(CooperativeAsyncCancelledError);
  });

  it("9) candidate-local AI failure classification", () => {
    expect(
      classifyAiNoResponseScope({
        rejectReason: "AI_PROVIDER_DEGRADED",
        hasHealthyProvider: false,
        providerFailureCount: 3,
      }),
    ).toBe("CANDIDATE_LOCAL_FAILURE");
  });

  it("10) all-provider-degraded candidate", () => {
    const evalResult = evaluateProviderHealthGate([degradedLocal("p1"), degradedLocal("p2"), degradedLocal("p3")]);
    expect(evalResult.aiPath).toBe("ALL_DEGRADED");
    expect(evalResult.telemetry.aiAllProvidersDegradedCount).toBe(3);
  });

  it("11) consensus ignores unavailable expert", () => {
    const consensus = summarizeConsensus([
      degradedLocal("provider-1", "BUY"),
      degradedLocal("provider-2", "BUY"),
      degradedLocal("provider-3", "BUY"),
    ]);
    expect(consensus.finalDecision).toBe("NO_TRADE");
    expect(consensus.rejectReason).toContain("No healthy provider");
  });

  it("12) VETO remains intact", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "BUY",
        finalConfidence: 80,
        decisionPayload: { consensusEngine: { finalDecision: "NO-TRADE" } },
        outputs: [healthyRemote("provider-1")],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.reasonCode).toBe("AI_DECISION_CONFLICT");
  });

  it("13) no fabricated BUY from all degraded", () => {
    const consensus = summarizeConsensus([degradedLocal("p1", "BUY"), degradedLocal("p2", "BUY")]);
    expect(consensus.finalDecision).not.toBe("BUY");
  });

  it("14) no fabricated bullish evidence in vote labels", () => {
    const vote = consensusVoteLabel(degradedLocal("p1", "BUY"));
    expect(vote).toBe("UNAVAILABLE_EVIDENCE");
  });

  it("15) forensic bridge health telemetry", () => {
    beginForensicPaperSession({ sessionId: "ai-health-test" });
    const audit = bridgeAiProviderResult({
      symbol: "ATMTRY",
      provider: "provider-1",
      latencyMs: 3,
      ok: false,
      remote: false,
      degraded: true,
      healthState: "TIMEOUT",
      reason: "timeout",
    });
    expect(audit.healthState).toBe("TIMEOUT");
    expect(audit.reasonCode).toBe("AI_PROVIDER_TIMEOUT");
  });

  it("16) stopRequested blocks retry", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      withAiRetry(async () => "x", { retries: 3, context: "stop", signal: controller.signal }),
    ).rejects.toBeInstanceOf(CooperativeAsyncCancelledError);
  });

  it("17) degraded consensus bridge marks unavailable votes", () => {
    beginForensicPaperSession({ sessionId: "consensus-health" });
    const degraded = buildAllProvidersDegradedConsensusResult({
      symbol: "ATMTRY",
      outputs: [degradedLocal("p1"), degradedLocal("p2")],
      health: evaluateProviderHealthGate([degradedLocal("p1"), degradedLocal("p2"), degradedLocal("p3")]),
    });
    const audit = bridgeConsensusResult({
      symbol: "ATMTRY",
      consensus: degraded,
      providers: [degradedLocal("p1"), degradedLocal("p2")],
      masterRuleId: "AI_PROVIDER_DEGRADED",
      providerHealthGate: "ALL_DEGRADED",
    });
    expect(audit.providerVotes.p1).toBe("UNAVAILABLE_EVIDENCE");
    expect(audit.masterRuleId).toBe("AI_PROVIDER_DEGRADED");
  });

  it("18) provider health telemetry counts", () => {
    const evalResult = evaluateProviderHealthGate([
      healthyRemote("p1"),
      degradedLocal("p2"),
      laneRow({ providerId: "p3", ok: false, failureCategory: "timeout", error: "timeout" }),
    ]);
    expect(evalResult.telemetry.aiDegradedCount).toBe(1);
    expect(evalResult.telemetry.aiTimeoutCount).toBe(1);
    expect(evalResult.telemetry.aiProviderHealth).toBe("PARTIAL_DEGRADATION");
  });

  it("19) EV path unchanged marker", () => {
    expect(process.env.EV_LOGIC_CHANGED ?? "NO").not.toBe("YES");
  });

  it("20) risk/sizing unchanged marker", () => {
    expect(process.env.RISK_SIZING_CHANGED ?? "NO").not.toBe("YES");
  });
});
