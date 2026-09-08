import type { AiOverlayDecision, AiOverlayResult, AlphaSignal } from "./types";

export function applyAiOverlay(signal: AlphaSignal, input?: {
  regime?: string;
  anomalyScore?: number;
  vetoThreshold?: number;
}): AiOverlayResult {
  const anomaly = input?.anomalyScore ?? 0;
  const vetoThreshold = input?.vetoThreshold ?? 85;
  if (anomaly >= vetoThreshold) {
    return {
      decision: "VETO",
      confidenceAdjustment: -signal.confidence,
      reasonCodes: ["AI_ANOMALY_VETO"],
    };
  }
  if (signal.confidence < 40) {
    return {
      decision: "REDUCE",
      confidenceAdjustment: -10,
      reasonCodes: ["AI_LOW_CONFIDENCE_REDUCE"],
    };
  }
  return {
    decision: "ALLOW",
    confidenceAdjustment: 0,
    reasonCodes: ["AI_ALLOW"],
  };
}

export function overlayAllowsTrade(result: AiOverlayResult): boolean {
  return result.decision === "ALLOW" || result.decision === "REDUCE";
}

export type AiOverlaySummary = Record<AiOverlayDecision, number>;

export function summarizeAiOverlay(results: AiOverlayResult[]): AiOverlaySummary {
  return results.reduce(
    (acc, row) => {
      acc[row.decision] += 1;
      return acc;
    },
    { ALLOW: 0, REDUCE: 0, VETO: 0 } as AiOverlaySummary,
  );
}
