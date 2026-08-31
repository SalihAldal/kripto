import { describe, expect, it, beforeEach } from "vitest";
import {
  classifyHybridEvTelemetry,
  isLegacyEvAnomaly,
  replayEvAnomalyClassification,
} from "@/src/server/ai/ev-telemetry.service";

describe("ev telemetry", () => {
  it("16) genuine EV threshold reject", () => {
    const row = classifyHybridEvTelemetry({
      finalDecision: "NO_TRADE",
      composite: 40,
      threshold: 58,
      compositeOk: false,
    });
    expect(row.reasonCode).toBe("EV_REJECT_THRESHOLD");
    expect(row.verdict).toBe("REJECTED");
  });

  it("17) genuine EV data reject", () => {
    const row = classifyHybridEvTelemetry({
      finalDecision: "NO_TRADE",
      composite: 72,
      threshold: 58,
      compositeOk: true,
      rejectReason: "missing snapshot data quality",
    });
    expect(row.reasonCode).toBe("EV_REJECT_DATA");
  });

  it("18) hybrid NO_TRADE above EV threshold", () => {
    const row = classifyHybridEvTelemetry({
      finalDecision: "NO_TRADE",
      composite: 72,
      threshold: 58,
      compositeOk: true,
      noTradeReasonList: ["MTF_ALIGNMENT"],
    });
    expect(row.reasonCode).toBe("HYBRID_DECISION_MIRROR");
  });

  it("19) hybrid decision mirror telemetry", () => {
    const row = classifyHybridEvTelemetry({
      finalDecision: "NO_TRADE",
      composite: 65,
      threshold: 58,
      compositeOk: true,
      rejectReason: "No-trade mode: regime filter",
    });
    expect(row.reasonCode).toBe("HYBRID_DECISION_MIRROR");
    expect(row.verdict).toBe("REJECTED");
  });

  it("20) 856 anomaly replay classifies as mirror", () => {
    const replay = replayEvAnomalyClassification({
      candidateId: "hybrid:ATMTRY:1",
      symbol: "ATMTRY",
      expectedValue: 72,
      threshold: 58,
      verdict: "REJECTED",
      reasonCode: "EV_REJECT",
      formulaVersion: "hybrid-v1",
    });
    expect(replay.classification).toBe("HYBRID_DECISION_MIRROR");
    expect(replay.replayReasonCode).toBe("HYBRID_DECISION_MIRROR");
  });

  it("21) EV logic unchanged — pass and wait unchanged", () => {
    expect(classifyHybridEvTelemetry({ finalDecision: "BUY", composite: 80, threshold: 58, compositeOk: true }).reasonCode).toBe(
      "EV_PASS",
    );
    expect(
      classifyHybridEvTelemetry({ finalDecision: "HOLD", composite: 80, threshold: 58, compositeOk: true }).reasonCode,
    ).toBe("EV_WAIT");
  });

  it("legacy anomaly detector", () => {
    expect(
      isLegacyEvAnomaly({
        candidateId: "x",
        symbol: "X",
        expectedValue: 70,
        threshold: 58,
        verdict: "REJECTED",
        reasonCode: "EV_REJECT",
        formulaVersion: "hybrid-v1",
      }),
    ).toBe(true);
  });
});
