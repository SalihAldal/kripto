import type { AIAnalysisInput, AIRecommendedAction, AIStandardizedOutput } from "@/src/types/ai";

function truncate(text: string, max = 220) {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

function toAction(decision: string): AIRecommendedAction {
  if (decision === "BUY" || decision === "SELL" || decision === "HOLD" || decision === "NO_TRADE") return decision;
  return "NO_TRADE";
}

export function buildStandardizedOutput(input: {
  analysisInput: AIAnalysisInput;
  decision: string;
  confidenceScore: number;
  coreThesis: string;
  bullishFactors?: string[];
  bearishFactors?: string[];
  riskFlags?: string[];
  noTradeTriggers?: string[];
  explanationSummary: string;
}): AIStandardizedOutput {
  const mtf = input.analysisInput.multiTimeframe;
  return {
    symbol: input.analysisInput.symbol,
    timestamp: new Date().toISOString(),
    timeframeContext: {
      higher: mtf ? `${mtf.higher.trend} (conf=${mtf.higher.confidence})` : "UNKNOWN",
      mid: mtf ? `${mtf.mid.structure}/${mtf.mid.momentumBias}` : "UNKNOWN",
      lower: mtf ? `${mtf.lower.entryQuality}` : "UNKNOWN",
      alignmentSummary: mtf?.finalAlignmentSummary ?? mtf?.reason ?? "Timeframe unavailable",
    },
    coreThesis: truncate(input.coreThesis, 180),
    bullishFactors: (input.bullishFactors ?? []).slice(0, 8),
    bearishFactors: (input.bearishFactors ?? []).slice(0, 8),
    confidenceScore: Number(input.confidenceScore.toFixed(2)),
    riskFlags: (input.riskFlags ?? []).slice(0, 8),
    noTradeTriggers: (input.noTradeTriggers ?? []).slice(0, 8),
    recommendedAction: toAction(input.decision),
    explanationSummary: truncate(input.explanationSummary, 220),
  };
}
