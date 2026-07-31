import { analyzeEntryTiming } from "@/src/server/entry-timing/entry-analysis.service";
import { enqueueEntryTimingJob } from "@/src/server/entry-timing/entry-timing-queue";
import type { EntryEvaluationResult } from "@/src/server/execution-engine-v2/execution-engine-v2.types";
import { mapEntryVerdictToDecision } from "@/src/server/execution-engine-v2/execution-engine-v2.types";
import { emitExecutionEngineV2Event, EXECUTION_ENGINE_V2_EVENT } from "@/src/server/execution-engine-v2/execution-engine-v2.events";

export async function evaluateEntryForBuyCandidate(input: {
  symbol: string;
  decisionId: string;
  decisionConfidence: number;
  price?: number;
  decision?: string;
}): Promise<EntryEvaluationResult> {
  const decisionUpper = (input.decision ?? "BUY").toUpperCase();
  if (!decisionUpper.includes("BUY") && decisionUpper !== "STRONG_BUY") {
    return {
      decision: "REJECT",
      entryScore: 0,
      entryConfidence: 0,
      expectedEntryPrice: input.price ?? 0,
      expectedRr: 0,
      expectedHoldMinutes: 0,
      expectedVolatility: 0,
      entryType: null,
      analysisId: "",
      reasons: ["Not a Decision Engine BUY candidate"],
    };
  }

  const result = await analyzeEntryTiming(input.symbol, input.price);
  const { analysis, quality, verdict } = result;

  const decisionConfidenceBoost = Math.min(10, input.decisionConfidence / 10);
  const adjustedConfidence = Math.min(100, analysis.entryConfidence + decisionConfidenceBoost);
  const adjustedScore = Math.min(100, analysis.entryScore + decisionConfidenceBoost * 0.5);

  let finalVerdict = verdict.verdict;
  if (input.decisionConfidence < 40 && finalVerdict === "BUY") {
    finalVerdict = "WAIT";
  }

  const entryDecision = mapEntryVerdictToDecision(finalVerdict, analysis.waitDuration);

  if (entryDecision.startsWith("WAIT") && analysis.reevaluateAt) {
    void enqueueEntryTimingJob({ type: "WAIT_REEVALUATE" }).catch(() => null);
  }

  const evaluation: EntryEvaluationResult = {
    decision: entryDecision,
    entryScore: adjustedScore,
    entryConfidence: adjustedConfidence,
    expectedEntryPrice: analysis.priceAtAnalysis,
    expectedRr: quality.expectedRr ?? 0,
    expectedHoldMinutes: quality.expectedHoldMinutes ?? 90,
    expectedVolatility: quality.expectedVolatility ?? 0,
    entryType: analysis.entryType,
    analysisId: analysis.id,
    reevaluateAt: analysis.reevaluateAt?.toISOString(),
    reasons: verdict.reasons,
    optimalEntryPrice: analysis.priceAtAnalysis,
    entryQualityScore: quality.qualityScore,
  };

  emitExecutionEngineV2Event(EXECUTION_ENGINE_V2_EVENT.ENTRY_EVALUATED, {
    symbol: input.symbol,
    decisionId: input.decisionId,
    entryDecision,
    analysisId: analysis.id,
  });

  return evaluation;
}

export function isEntryApprovedForExecution(evaluation: EntryEvaluationResult) {
  return evaluation.decision === "BUY_NOW" && evaluation.entryConfidence >= 55;
}
