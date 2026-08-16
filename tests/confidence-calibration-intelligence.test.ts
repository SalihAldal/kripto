import { describe, expect, it } from "vitest";
import {
  aggregateCalibrationKpis,
  applyConfidenceCalibration,
  applyConfidenceCalibrationToDecision,
  buildCalibrationBinsFromOutcomes,
  calibrateExpectedValue,
  resolveModelDisagreementScore,
} from "../src/server/ai/confidence-calibration-intelligence.service";

describe("confidence calibration intelligence", () => {
  it("builds calibration bins from historical outcomes", () => {
    const bins = buildCalibrationBinsFromOutcomes([
      { confidence: 72, won: true },
      { confidence: 74, won: false },
      { confidence: 76, won: true },
      { confidence: 78, won: true },
    ]);
    expect(bins.length).toBeGreaterThan(0);
    expect(bins[0]?.predictedAvg).toBeGreaterThan(0);
  });

  it("reduces overestimated confidence instead of increasing it", () => {
    const bins = buildCalibrationBinsFromOutcomes([
      { confidence: 82, won: true },
      { confidence: 84, won: false },
      { confidence: 86, won: false },
      { confidence: 88, won: true },
    ]);
    const calibrated = applyConfidenceCalibration({
      rawConfidence: 86,
      bins,
      disagreementScore: 12,
      conflictScore: 18,
    });
    expect(calibrated.calibratedConfidence).toBeLessThan(86);
    expect(calibrated.overestimated).toBe(true);
  });

  it("penalizes model disagreement", () => {
    const disagreement = resolveModelDisagreementScore([
      {
        providerId: "provider-1",
        providerName: "OpenAI",
        ok: true,
        latencyMs: 100,
        output: {
          decision: "BUY",
          confidence: 82,
          targetPrice: 100,
          stopPrice: 95,
          estimatedDurationSec: 600,
          reasoningShort: "buy",
          riskScore: 30,
        },
      },
      {
        providerId: "provider-2",
        providerName: "Claude",
        ok: true,
        latencyMs: 120,
        output: {
          decision: "NO_TRADE",
          confidence: 58,
          targetPrice: null,
          stopPrice: null,
          estimatedDurationSec: 600,
          reasoningShort: "wait",
          riskScore: 62,
        },
      },
    ]);
    const withDisagreement = applyConfidenceCalibration({
      rawConfidence: 75,
      disagreementScore: disagreement.score,
    });
    const withoutDisagreement = applyConfidenceCalibration({ rawConfidence: 75 });
    expect(withDisagreement.calibratedConfidence).toBeLessThan(withoutDisagreement.calibratedConfidence);
    expect(disagreement.score).toBeGreaterThan(0);
  });

  it("calibrates expected value toward realized confidence ratio", () => {
    const calibratedEv = calibrateExpectedValue({
      expectedProfitPercent: 0.8,
      calibratedConfidence: 68,
      rawConfidence: 78,
    });
    expect(calibratedEv).toBeLessThan(0.8);
    expect(calibratedEv).toBeGreaterThan(0);
  });

  it("applies calibration to AI consensus result", () => {
    const calibrated = applyConfidenceCalibrationToDecision({
      result: {
        finalDecision: "BUY",
        finalConfidence: 84,
        finalConsensusConfidence: 84,
        finalRiskScore: 35,
        score: 72,
        explanation: "test",
        outputs: [],
        rejected: false,
        generatedAt: new Date().toISOString(),
      },
      providerResults: [],
      marketRegime: "trending",
    });
    expect(calibrated.finalConfidence).toBeLessThanOrEqual(92);
    expect(calibrated.decisionPayload?.confidenceCalibration).toBeDefined();
  });

  it("does not increase confidence on small-sample underestimated bins", () => {
    const bins = buildCalibrationBinsFromOutcomes([{ confidence: 72, won: true }]);
    const calibrated = applyConfidenceCalibration({
      rawConfidence: 71,
      bins,
    });
    expect(calibrated.calibratedConfidence).toBeLessThanOrEqual(71);
    expect(calibrated.underestimated).toBe(false);
  });

  it("aggregates calibration KPIs", () => {
    const kpis = aggregateCalibrationKpis({
      telemetryRows: [
        {
          rawConfidence: 82,
          calibratedConfidence: 74,
          consensusConfidence: 74,
          modelDisagreementScore: 10,
          conflictScore: 8,
          agreementScore: 62,
          calibrationError: 8,
          calibrationAdjustment: -8,
          overestimated: true,
          underestimated: false,
          expectedValueRaw: 0.7,
          expectedValueCalibrated: 0.61,
          modelConfidences: [82],
          providerDecisions: ["BUY"],
        },
      ],
      pnls: [4, -2],
    });
    expect(kpis.sampleCount).toBe(1);
    expect(kpis.averageCalibrationError).toBe(8);
    expect(kpis.overestimationRate).toBe(100);
  });
});
