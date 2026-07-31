import type { SpotExitType } from "@prisma/client";
import type { ExitContext, ExitScoreResult, ProfitProtectionSnapshot } from "@/src/server/exit-timing/exit-timing.types";

function clamp(v: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, v));
}

export function computeExitScore(ctx: ExitContext, protection: ProfitProtectionSnapshot): ExitScoreResult {
  const sellPressure =
    (ctx.currentLossPct > 2 ? 25 : 0) +
    (protection.drawdownFromPeakPct > 30 ? 30 : protection.drawdownFromPeakPct * 0.5) +
    (ctx.trend.exhaustion > 50 ? 20 : 0) +
    (ctx.momentum.decay > 20 ? 15 : 0) +
    (ctx.volume.distribution ? 20 : 0) +
    (ctx.support.broken ? 25 : 0) +
    (ctx.news.reversalRisk > 50 ? 15 : 0) +
    (ctx.whale.distribution > 60 ? 15 : 0);

  const continuationProbability = clamp(
    ctx.momentum.score * 0.4 + ctx.trend.score * 0.35 + ctx.volume.score * 0.25 - ctx.momentum.decay,
  );
  const reversalProbability = clamp(
    sellPressure * 0.4 + ctx.trend.exhaustion * 0.3 + ctx.news.reversalRisk * 0.3,
  );

  const holdPressure =
    continuationProbability * 0.3 +
    (ctx.currentProfitPct > 0 && ctx.currentProfitPct < 5 ? 20 : 0) +
    (ctx.trend.score > 65 && !ctx.trend.direction.includes("BEAR") ? 15 : 0);

  const exitScore = clamp(sellPressure - holdPressure * 0.3 + (ctx.currentLossPct > 3 ? 20 : 0));
  const exitConfidence = clamp(exitScore * 0.5 + reversalProbability * 0.3 + (protection.profitGivebackPct > 1 ? 15 : 0));
  const expectedRemainingUpside = clamp(continuationProbability * 0.15 + ctx.resistance.distancePct);
  const expectedDownside = clamp(reversalProbability * 0.12 + ctx.volatility.score * 0.08 + ctx.currentLossPct);
  const riskScore = clamp(expectedDownside * 0.6 + reversalProbability * 0.4);

  return {
    exitScore: Number(exitScore.toFixed(1)),
    exitConfidence: Number(exitConfidence.toFixed(1)),
    expectedRemainingUpside: Number(expectedRemainingUpside.toFixed(2)),
    expectedDownside: Number(expectedDownside.toFixed(2)),
    riskScore: Number(riskScore.toFixed(1)),
    continuationProbability: Number(continuationProbability.toFixed(1)),
    reversalProbability: Number(reversalProbability.toFixed(1)),
  };
}

export function detectExitType(
  ctx: ExitContext,
  protection: ProfitProtectionSnapshot,
  scores: ExitScoreResult,
): SpotExitType {
  if (ctx.currentLossPct > 5 && scores.riskScore > 70) return "EMERGENCY_EXIT";
  if (ctx.holdingMinutes > 24 * 60 && ctx.currentProfitPct > 0) return "TIME_EXIT";
  if (ctx.currentProfitPct >= 3 && protection.drawdownFromPeakPct > 40) return "PROFIT_TARGET";
  if (ctx.support.broken) return "SUPPORT_BREAK";
  if (ctx.trend.exhaustion > 55 && ctx.momentum.decay > 15) return "TREND_EXHAUSTION";
  if (ctx.momentum.decay > 25 || ctx.momentum.score < 35) return "MOMENTUM_LOSS";
  if (ctx.volume.distribution || ctx.whale.distribution > 65) return "DISTRIBUTION";
  if (ctx.news.reversalRisk > 60) return "NEWS_REVERSAL";
  if (ctx.support.broken || scores.reversalProbability > 60) return "BREAKDOWN";
  if (protection.profitGivebackPct > 2 && ctx.whale.distribution > 50) return "LIQUIDITY_SWEEP";
  if (ctx.currentProfitPct >= 2) return "PROFIT_TARGET";
  return "MOMENTUM_LOSS";
}