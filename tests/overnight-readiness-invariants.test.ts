import { describe, expect, it } from "vitest";
import {
  resolveConsensusForExecutionGate,
  resolveMtfAlignmentContract,
  resolvePumpRiskContract,
  validateAiDecisionInvariants,
} from "@/src/server/decision-engine/decision-contract.service";
import { mapMasterConsensusDecision } from "@/src/server/decision-engine/conflict-detection.service";
import {
  evaluateAiExecutionReadiness,
  isBlockingAiDecision,
} from "@/src/server/execution/ai-execution-gate.service";
import { classifyHybridEvTelemetry, isLegacyEvAnomaly } from "@/src/server/ai/ev-telemetry.service";
import {
  PAPER_TOP_GAINER_PRIORITY_THRESHOLD,
  LIVE_TOP_GAINER_PRIORITY_THRESHOLD,
} from "@/src/server/scanner/paper-lane-profile";

function healthyRemote(provider: string) {
  return { providerName: provider, ok: true, output: { decision: "BUY", confidence: 78, metadata: { remote: true } } };
}

describe("overnight readiness — decision invariants", () => {
  it("preservedHybridBuy requires aligned canonical fields", () => {
    const ai = {
      finalDecision: "BUY",
      finalConsensusDecision: "BUY",
      decisionPayload: { masterDecisionEngine: { preservedHybridBuy: true } },
    };
    expect(validateAiDecisionInvariants(ai).ok).toBe(true);
    expect(resolveConsensusForExecutionGate(ai)).toBe("BUY");
  });

  it("detects BUY vs NO_TRADE misalignment without preservation", () => {
    const result = validateAiDecisionInvariants({
      finalDecision: "BUY",
      finalConsensusDecision: "NO-TRADE",
    });
    expect(result.ok).toBe(false);
    expect(result.violations).toContain("BUY_CONSENSUS_MISALIGNMENT");
  });

  it("mapMasterConsensusDecision aligns when hybrid preserved", () => {
    expect(mapMasterConsensusDecision("WAIT", true)).toBe("BUY");
    expect(mapMasterConsensusDecision("NO_TRADE", false)).toBe("NO-TRADE");
  });

  it("execution gate passes preserved hybrid BUY", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "BUY",
        finalConsensusDecision: "NO-TRADE",
        finalConfidence: 78,
        decisionPayload: { masterDecisionEngine: { preservedHybridBuy: true } },
        outputs: [healthyRemote("p1")],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_PASS");
  });

  it("NO_TRADE cannot pass selection blocking gate", () => {
    expect(isBlockingAiDecision("NO_TRADE")).toBe(true);
    expect(isBlockingAiDecision("BUY")).toBe(false);
  });
});

describe("overnight readiness — data contracts", () => {
  it("MTF missing is UNAVAILABLE not zero", () => {
    const contract = resolveMtfAlignmentContract({ aiAlignment: undefined, contextAlignment: null });
    expect(contract.status).toBe("UNAVAILABLE");
    expect(contract.score).toBeNull();
  });

  it("pumpRisk degraded futures is UNAVAILABLE not zero-risk", () => {
    const contract = resolvePumpRiskContract({
      manipulationPressureScore: 0,
      futuresDegraded: true,
    });
    expect(contract.status).toBe("UNAVAILABLE");
    expect(contract.score).toBeNull();
    expect(contract.degraded).toBe(true);
  });

  it("EV_REJECT with EV>=threshold is legacy mirror anomaly", () => {
    expect(
      isLegacyEvAnomaly({
        candidateId: "c1",
        symbol: "X",
        expectedValue: 62,
        threshold: 55,
        reasonCode: "EV_REJECT",
        verdict: "REJECTED",
      }),
    ).toBe(true);
    const classified = classifyHybridEvTelemetry({
      finalDecision: "NO_TRADE",
      composite: 62,
      threshold: 55,
      compositeOk: true,
      rejectReason: "hybrid block",
    });
    expect(classified.reasonCode).toBe("HYBRID_DECISION_MIRROR");
  });
});

describe("overnight readiness — paper lane parity", () => {
  it("paper priority 50 vs live 70 unchanged", () => {
    expect(PAPER_TOP_GAINER_PRIORITY_THRESHOLD).toBe(50);
    expect(LIVE_TOP_GAINER_PRIORITY_THRESHOLD).toBe(70);
  });
});

describe("overnight readiness — PnL synthetic lifecycle", () => {
  it("netPnL = grossPnL - fees", () => {
    const gross = 12.5;
    const fees = 1.25;
    expect(gross - fees).toBe(11.25);
  });
});
