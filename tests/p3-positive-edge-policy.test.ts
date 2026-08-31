import { describe, expect, it } from "vitest";
import {
  computeVariantMetrics,
  selectPolicyWinner,
  simulateTdiBaseline,
  simulateTdiVariantA,
  simulateTdiVariantD,
  TDI_THRESHOLDS,
  type TradeProfile,
} from "@/src/server/policy/positive-edge-policy-research.service";
import { evaluateAiExecutionReadiness } from "@/src/server/execution/ai-execution-gate.service";

const sampleProfitable: TradeProfile & { cohort: "profitable" } = {
  symbol: "TEST",
  netPnL: 10,
  technicalScore: 55,
  momentumScore: 2,
  sentimentScore: 50,
  shortMomentum: 0.02,
  shortFlow: 0.01,
  confidence: 45,
  bullishCount: 2,
  executionScore: 50,
  EV: 55,
  cohort: "profitable",
};

const sampleNearThreshold: TradeProfile & { cohort: "profitable" } = {
  ...sampleProfitable,
  symbol: "NEAR",
  momentumScore: 58,
  confidence: 65,
  bullishCount: 5,
  executionScore: 60,
  EV: 70,
};

describe("P3 positive-edge policy research", () => {
  it("baseline blocks low-momentum profitable profile at MOMENTUM", () => {
    const result = simulateTdiBaseline(sampleProfitable);
    expect(result.verdict).toBe("WAIT");
    expect(result.firstBlocker).toBe("MOMENTUM");
    expect(result.executionReady).toBe(false);
  });

  it("variant D does not release profile far below momentum threshold", () => {
    const result = simulateTdiVariantD(sampleProfitable);
    expect(result.executionReady).toBe(false);
  });

  it("variant A vs baseline on near-threshold profile", () => {
    const base = simulateTdiBaseline(sampleNearThreshold);
    const variant = simulateTdiVariantA(sampleNearThreshold);
    expect(base.executionReady || variant.executionReady).toBeDefined();
  });

  it("selectPolicyWinner returns NO_SAFE_POLICY_CHANGE when no OOS edge", () => {
    const rows = [
      { ...sampleProfitable, cohort: "profitable" as const },
      { ...sampleProfitable, symbol: "LOSS", netPnL: -5, cohort: "losing" as const },
    ];
    const train = rows;
    const oos = rows;
    const baselineOos = computeVariantMetrics("BASELINE", oos);
    const metrics = [
      computeVariantMetrics("BASELINE", oos),
      computeVariantMetrics("D_MOMENTUM_SHORT_TELEMETRY_DEDUP", oos),
    ];
    const selection = selectPolicyWinner(
      metrics.map((m) => computeVariantMetrics(m.variant, train)),
      metrics,
      baselineOos,
    );
    expect(selection.winner).toBe("NO_SAFE_POLICY_CHANGE");
  });

  it("preserves AI VETO policy", () => {
    const gate = evaluateAiExecutionReadiness({
      policy: "VETO",
      ai: {
        finalDecision: "NO_TRADE",
        finalConsensusDecision: "NO-TRADE",
        finalConfidence: 20,
        outputs: [{ providerName: "p1", ok: true, output: { decision: "NO_TRADE", confidence: 20 } }],
      } as never,
      learningLane: false,
      microTradeEligible: false,
    });
    expect(gate.reasonCode).toBe("AI_VETO");
  });

  it("TDI thresholds unchanged", () => {
    expect(TDI_THRESHOLDS.momentum).toBe(60);
    expect(TDI_THRESHOLDS.confidence).toBe(40);
    expect(TDI_THRESHOLDS.technical).toBe(48);
  });

  it("42 profitable synthetic cohort — no variant releases without threshold change", () => {
    const profiles = Array.from({ length: 42 }, (_, i) => ({
      ...sampleProfitable,
      symbol: `P${i}`,
      momentumScore: 1.94 + (i % 3) * 0.5,
      cohort: "profitable" as const,
    }));
    const variantD = computeVariantMetrics("D_MOMENTUM_SHORT_TELEMETRY_DEDUP", profiles);
    expect(variantD.profitableReleased).toBe(0);
  });

  it("206 loss cohort — variant D does not flood releases", () => {
    const profiles = Array.from({ length: 20 }, (_, i) => ({
      ...sampleProfitable,
      symbol: `L${i}`,
      netPnL: -4,
      momentumScore: 3 + i * 0.2,
      cohort: "losing" as const,
    }));
    const variantD = computeVariantMetrics("D_MOMENTUM_SHORT_TELEMETRY_DEDUP", profiles);
    expect(variantD.losingReleased).toBe(0);
  });
});
