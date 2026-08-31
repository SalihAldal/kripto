import { describe, expect, it } from "vitest";
import {
  computeConsensusMetrics,
  detectConflicts,
  mapMasterConsensusDecision,
  resolveEffectiveTradingDecision,
  resolveMasterDecision,
} from "@/src/server/decision-engine/conflict-detection.service";
import type { ExpertOpinionResult } from "@/src/server/decision-engine/decision-engine.types";
import {
  evaluateAiExecutionReadiness,
  isBlockingAiDecision,
  normalizeAiDecision,
} from "@/src/server/execution/ai-execution-gate.service";
import { classifySelectionScannerAiBlock } from "@/src/server/forensics/candidate-funnel-trace.service";

function expert(
  expertType: ExpertOpinionResult["expertType"],
  opinion: ExpertOpinionResult["opinion"],
  score: number,
): ExpertOpinionResult {
  return {
    expertType,
    opinion,
    confidence: score,
    score,
    summary: "test",
    positiveFactors: [],
    negativeFactors: [],
    topRisks: [],
  };
}

function healthyRemote(provider: string) {
  return {
    providerName: provider,
    ok: true,
    output: { decision: "BUY", confidence: 78, metadata: { remote: true } },
  };
}

describe("P2 scanner AI conflict root cause", () => {
  it("1) provider agreement BUY passes execution gate", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "BUY",
        finalConsensusDecision: "BUY",
        finalConfidence: 78,
        outputs: [healthyRemote("p1")],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_PASS");
  });

  it("2) provider agreement NO_TRADE blocks at selection", () => {
    expect(isBlockingAiDecision("NO_TRADE")).toBe(true);
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "NO_TRADE",
        finalConsensusDecision: "NO-TRADE",
        finalConfidence: 22,
        outputs: [healthyRemote("p1")],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.reasonCode).toBe("AI_VETO");
  });

  it("3) legitimate provider disagreement still blocks (no preservation)", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "BUY",
        finalConsensusDecision: "NO-TRADE",
        finalConfidence: 80,
        outputs: [healthyRemote("p1")],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.reasonCode).toBe("AI_DECISION_CONFLICT");
  });

  it("4) preserved hybrid BUY aligns consensus — no false conflict", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "BUY",
        finalConsensusDecision: "BUY",
        finalConfidence: 78,
        decisionPayload: {
          masterDecisionEngine: { preservedHybridBuy: true, decision: "WAIT" },
        },
        outputs: [healthyRemote("p1")],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_PASS");
    expect(gate.reasonCode).not.toBe("AI_DECISION_CONFLICT");
  });

  it("5) scanner AI block classification for NO_TRADE", () => {
    const block = classifySelectionScannerAiBlock({ aiFinalDecision: "NO_TRADE" });
    expect(block.category).toBe("SCANNER_AI_PRE_TDI_BLOCK");
    expect(block.tdiEntered).toBe(false);
  });

  it("6) scanner AI continue — BUY not blocking at selection", () => {
    expect(isBlockingAiDecision("BUY")).toBe(false);
  });

  it("7) TDI path reachable after aggregation fix (gate pass, TDI downstream)", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "BUY",
        finalConsensusDecision: "BUY",
        finalConfidence: 78,
        outputs: [healthyRemote("p1")],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_PASS");
    expect(gate.executionSide).toBe("BUY");
  });

  it("8) execution AI after scanner disagreement without alignment still blocks", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "BUY",
        finalConsensusDecision: "NO-TRADE",
        finalConfidence: 78,
        outputs: [healthyRemote("p1")],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.reasonCode).toBe("AI_DECISION_CONFLICT");
  });

  it("9) degraded provider missing evidence blocks", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "BUY",
        finalConsensusDecision: "BUY",
        finalConfidence: 78,
        outputs: [{ providerName: "p1", ok: false, output: undefined }],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.reasonCode).toBe("AI_EVIDENCE_MISSING");
  });

  it("10) unavailable provider — consensus missing blocks", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "BUY",
        finalConsensusDecision: null,
        finalConfidence: 78,
        outputs: [healthyRemote("p1")],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.reasonCode).toBe("AI_CONSENSUS_MISSING");
  });

  it("11) stale snapshot — conflict detection uses normalized fields", () => {
    expect(normalizeAiDecision("NO-TRADE")).toBe("NO_TRADE");
    expect(normalizeAiDecision("NO TRADE")).toBe("NO_TRADE");
  });

  it("12) duplicate AI path — master maps consensus when hybrid preserved", () => {
    const opinions = [
      expert("MARKET", "WEAK_BUY", 58),
      expert("MOMENTUM", "BUY", 62),
      expert("VOLUME", "WEAK_BUY", 54),
      expert("LIQUIDITY", "BUY", 60),
      expert("RISK", "WEAK_BUY", 56),
      expert("NEWS", "WEAK_BUY", 48),
      expert("EXECUTION", "WEAK_BUY", 50),
      expert("LEARNING", "WEAK_BUY", 46),
    ];
    const matrix = { market: 58, momentum: 62, volume: 54, liquidity: 60, risk: 56, news: 48, execution: 50, learning: 46 };
    const conflicts = detectConflicts(opinions);
    const metrics = computeConsensusMetrics(opinions, conflicts);
    const masterDecision = resolveMasterDecision({ matrix, metrics, opinions, conflicts });
    const effective = resolveEffectiveTradingDecision({
      masterDecision,
      hybridDecision: "BUY",
      hybridRejected: false,
      hybridConfidence: 78,
      metrics,
      opinions,
    });
    expect(effective.preservedHybridBuy).toBe(true);
    expect(mapMasterConsensusDecision(masterDecision, effective.preservedHybridBuy)).toBe("BUY");
  });

  it("13) decision hash alignment — BUY/BUY no conflict class", () => {
    const block = classifySelectionScannerAiBlock({
      aiFinalDecision: "BUY",
      consensusDecision: "BUY",
    });
    expect(block.category).not.toBe("AI_DECISION_CONFLICT");
  });

  it("14) NO_TRADE state machine blocks at selection", () => {
    expect(isBlockingAiDecision("HOLD")).toBe(true);
    expect(isBlockingAiDecision("REJECT")).toBe(true);
    expect(isBlockingAiDecision("WAIT")).toBe(true);
  });

  it("15) AI_STARTED orphan — missing verdict blocks", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: null,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.reasonCode).toBe("AI_VERDICT_MISSING");
  });

  it("16) AI VETO preservation — true NO_TRADE still blocks", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "NO_TRADE",
        finalConsensusDecision: "NO-TRADE",
        finalConfidence: 20,
        outputs: [healthyRemote("p1")],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_BLOCK");
    expect(gate.reasonCode).toBe("AI_VETO");
  });

  it("17) TDI preservation — gate pass does not imply TDI approve", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: { finalDecision: "BUY", finalConsensusDecision: "BUY", finalConfidence: 78, outputs: [healthyRemote("p1")] } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.verdict).toBe("AI_GATE_PASS");
  });

  it("18) EV preservation — gate pass only clears AI layer", () => {
    expect(evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: { finalDecision: "BUY", finalConsensusDecision: "BUY", finalConfidence: 78, outputs: [healthyRemote("p1")] } as never,
      learningLane: false,
      microTradeEligible: false,
    }).reasonCode).toBe("AI_GATE_PASS");
  });

  it("19) risk/sizing preservation — gate does not bypass downstream", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: { finalDecision: "BUY", finalConsensusDecision: "BUY", finalConfidence: 78, outputs: [healthyRemote("p1")] } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.executionSide).toBe("BUY");
    expect(gate.verdict).not.toBe("AI_ADVISORY_ONLY");
  });
});
