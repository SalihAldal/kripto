import type { AIAnalysisInput } from "@/src/types/ai";

export type MomentumTelemetry = {
  shortMomentumPercent: number | null;
  shortFlowImbalance: number | null;
  shortTradeCount: number | null;
  hasTelemetry: boolean;
  hasSufficientSamples: boolean;
};

export function readMomentumTelemetry(
  signals: AIAnalysisInput["marketSignals"] | undefined,
): MomentumTelemetry {
  const rawMom = signals?.shortMomentumPercent;
  const rawFlow = signals?.shortFlowImbalance;
  const rawTradeCount = signals?.shortTradeCount;
  const hasMom = rawMom !== undefined && rawMom !== null && Number.isFinite(Number(rawMom));
  const hasFlow = rawFlow !== undefined && rawFlow !== null && Number.isFinite(Number(rawFlow));
  const hasTradeCount = rawTradeCount !== undefined && rawTradeCount !== null && Number.isFinite(Number(rawTradeCount));
  const shortTradeCount = hasTradeCount ? Number(rawTradeCount) : null;
  const hasSufficientSamples = shortTradeCount !== null && shortTradeCount >= 2;
  return {
    shortMomentumPercent: hasMom ? Number(rawMom) : null,
    shortFlowImbalance: hasFlow ? Number(rawFlow) : null,
    shortTradeCount,
    hasTelemetry: hasMom && hasFlow && hasTradeCount,
    hasSufficientSamples,
  };
}

/** True only when telemetry exists and both short momentum and flow are below hybrid weak thresholds. */
export function resolveLowMomentumInput(signals: AIAnalysisInput["marketSignals"] | undefined) {
  const telemetry = readMomentumTelemetry(signals);
  if (!telemetry.hasTelemetry || !telemetry.hasSufficientSamples) return false;
  return (
    Math.abs(telemetry.shortMomentumPercent ?? 0) < 0.08 &&
    Math.abs(telemetry.shortFlowImbalance ?? 0) < 0.03
  );
}

export function resolveMomentumWeak(input: {
  sentimentScore: number;
  minSentimentScore: number;
  regimeSentimentDelta: number;
  lowMomentumInput: boolean;
}) {
  return (
    input.sentimentScore < input.minSentimentScore + input.regimeSentimentDelta || input.lowMomentumInput
  );
}

export function resolvePaperMomentumWaiver(input: {
  paperRelaxed: boolean;
  sentimentScore: number;
  newsComplex: boolean;
}) {
  return input.paperRelaxed && input.sentimentScore >= 32 && !input.newsComplex;
}

export function resolveMomentumSupportive(input: {
  sentimentOk: boolean;
  momentumWeak: boolean;
  newsComplex: boolean;
  paperMomentumWaiver: boolean;
}) {
  return (
    (input.sentimentOk && !input.momentumWeak && !input.newsComplex) || input.paperMomentumWaiver
  );
}

/** Avoid duplicate downgrade when paper lane already waived weak momentum. */
export function resolveTechStrongButOthersWeak(input: {
  technicalStrong: boolean;
  riskVeto: boolean;
  allowPumpOverride: boolean;
  momentumWeak: boolean;
  qualityWeak: boolean;
  paperMomentumWaiver: boolean;
}) {
  const momentumBlocks =
    input.momentumWeak && !input.paperMomentumWaiver;
  return (
    input.technicalStrong &&
    (input.riskVeto || (!input.allowPumpOverride && (momentumBlocks || input.qualityWeak)))
  );
}
