import { analyzeExitTiming } from "@/src/server/exit-timing/exit-analysis.service";
import { enqueueExitTimingJob } from "@/src/server/exit-timing/exit-timing-queue";
import type { ExitEvaluationResult } from "@/src/server/execution-engine-v2/execution-engine-v2.types";
import { mapExitVerdictToDecision } from "@/src/server/execution-engine-v2/execution-engine-v2.types";
import { emitExecutionEngineV2Event, EXECUTION_ENGINE_V2_EVENT } from "@/src/server/execution-engine-v2/execution-engine-v2.events";

export async function evaluateExitForOpenPosition(input: {
  positionId: string;
  symbol?: string;
}): Promise<ExitEvaluationResult> {
  const result = await analyzeExitTiming({ positionId: input.positionId, symbol: input.symbol });
  const { analysis, protection, scores, verdict } = result;

  const emergency =
    analysis.currentLossPct > 5 ||
    scores.riskScore > 75 ||
    (protection.drawdownFromPeakPct > 50 && analysis.currentProfitPct > 2);

  const exitDecision = mapExitVerdictToDecision(verdict.verdict, {
    emergency,
    lossPct: analysis.currentLossPct,
    riskScore: scores.riskScore,
  });

  if (exitDecision === "HOLD" && analysis.reevaluateAt) {
    void enqueueExitTimingJob({ type: "HOLD_REEVALUATE" }).catch(() => null);
  }

  const profitProtectionScore = Math.max(
    0,
    100 - protection.profitGivebackPct - protection.drawdownFromPeakPct * 0.5,
  );

  const evaluation: ExitEvaluationResult = {
    decision: exitDecision,
    exitConfidence: scores.exitConfidence,
    expectedRemainingUpside: scores.expectedRemainingUpside,
    expectedDownside: scores.expectedDownside,
    profitProtectionScore,
    analysisId: analysis.id,
    reevaluateAt: analysis.reevaluateAt?.toISOString(),
    reasons: verdict.reasons,
    maximumUnrealizedProfit: protection.maximumProfitPct,
    currentProfit: analysis.currentProfitPct,
    profitGiveback: protection.profitGivebackPct,
  };

  emitExecutionEngineV2Event(EXECUTION_ENGINE_V2_EVENT.EXIT_EVALUATED, {
    positionId: input.positionId,
    symbol: analysis.symbol,
    exitDecision,
    analysisId: analysis.id,
  });

  return evaluation;
}

export function shouldExecuteExit(evaluation: ExitEvaluationResult) {
  return evaluation.decision === "SELL_NOW" || evaluation.decision === "EMERGENCY_EXIT";
}
