import type { ExitVerdict, HoldDuration } from "@prisma/client";
import type { ExitScoreResult, ProfitProtectionSnapshot } from "@/src/server/exit-timing/exit-timing.types";
import type { ExitContext } from "@/src/server/exit-timing/exit-timing.types";
import { HOLD_DURATION_MS } from "@/src/server/exit-timing/exit-timing.types";

export function resolveExitVerdict(
  ctx: ExitContext,
  protection: ProfitProtectionSnapshot,
  scores: ExitScoreResult,
): { verdict: ExitVerdict; holdDuration?: HoldDuration; reevaluateAt?: Date; reasons: string[] } {
  const reasons: string[] = [];

  if (ctx.currentLossPct > 5 || scores.riskScore > 75 || ctx.support.broken) {
    reasons.push("Emergency exit conditions met");
    return { verdict: "SELL", reasons };
  }

  if (scores.exitConfidence >= 72 && scores.exitScore >= 70) {
    if (protection.drawdownFromPeakPct > 35) reasons.push("Significant profit giveback from peak");
    if (scores.reversalProbability > 55) reasons.push("Reversal probability elevated");
    if (ctx.volume.distribution) reasons.push("Distribution detected");
    return { verdict: "SELL", reasons: reasons.length ? reasons : ["Exit score threshold met"] };
  }

  if (scores.continuationProbability > 55 && protection.drawdownFromPeakPct < 25 && ctx.currentLossPct < 2) {
    let holdDuration: HoldDuration = "MINUTES_15";
    if (scores.continuationProbability > 70) holdDuration = "MINUTES_30";
    if (ctx.currentProfitPct > 5 && scores.continuationProbability > 65) holdDuration = "HOUR_1";
    if (ctx.trend.score > 70 && ctx.momentum.score > 60) holdDuration = "HOURS_4";

    const reevaluateAt = new Date(Date.now() + HOLD_DURATION_MS[holdDuration]);
    reasons.push(`Trend continuation likely — hold and re-evaluate`);
    return { verdict: "HOLD", holdDuration, reevaluateAt, reasons };
  }

  if (scores.exitScore >= 55) {
    reasons.push("Moderate exit pressure — monitor closely");
    return {
      verdict: "HOLD",
      holdDuration: "MINUTES_5",
      reevaluateAt: new Date(Date.now() + HOLD_DURATION_MS.MINUTES_5),
      reasons,
    };
  }

  reasons.push("No exit signal — holding position");
  return {
    verdict: "HOLD",
    holdDuration: "MINUTES_15",
    reevaluateAt: new Date(Date.now() + HOLD_DURATION_MS.MINUTES_15),
    reasons,
  };
}

export async function processHoldReevaluations() {
  const { getPendingHoldReevaluations } = await import("@/src/server/exit-timing/exit-timing.repository");
  const { analyzeExitTiming } = await import("@/src/server/exit-timing/exit-analysis.service");
  const pending = await getPendingHoldReevaluations();
  const results = [];
  for (const analysis of pending) {
    const result = await analyzeExitTiming({ symbol: analysis.symbol, positionId: analysis.positionId ?? undefined });
    results.push(result);
  }
  return { reevaluated: results.length, results };
}
