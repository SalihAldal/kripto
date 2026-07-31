import { env } from "@/lib/config";
import {
  persistShadowTrade,
  closeShadowTrade,
  persistShadowPerformance,
  countClosedShadowTrades,
  listClosedShadowTrades,
} from "@/src/server/decision-engine-v2/decision-engine-v2.repository";
import { predictDecisionEngineV2, persistPredictionAsObserveOnlyDecision } from "@/src/server/decision-engine-v2/prediction.service";
import { getDecisionLogByDecisionId } from "@/src/server/repositories/decision-log.repository";
import type { ShadowDecisionCapture } from "@/src/server/shadow-validation/shadow-validation.types";
import { emitDecisionEngineV2Event, DECISION_ENGINE_V2_EVENT } from "@/src/server/decision-engine-v2/decision-engine-v2.events";

const ML_ENGINE_ID = "decision-engine-v2";
const RULE_BASELINE_ENGINE_ID = "decision-engine-v1";

function extractPrice(decision: NonNullable<Awaited<ReturnType<typeof getDecisionLogByDecisionId>>>) {
  const raw = decision.featureSnapshot?.raw as Record<string, unknown> | null | undefined;
  const fromRaw = Number(raw?.lastPrice ?? 0);
  if (Number.isFinite(fromRaw) && fromRaw > 0) return fromRaw;
  const marketState = decision.marketState as Record<string, unknown> | null | undefined;
  const fromState = Number(marketState?.lastPrice ?? 0);
  return Number.isFinite(fromState) && fromState > 0 ? fromState : undefined;
}

export async function runDecisionEngineV2ShadowAdapter(decisionId: string): Promise<ShadowDecisionCapture | null> {
  const decision = await getDecisionLogByDecisionId(decisionId);
  if (!decision) return null;

  const prediction = await predictDecisionEngineV2({
    symbol: decision.symbol,
    decisionId,
    featureSnapshot: decision.featureSnapshot as never,
    scannerScore: decision.scannerScore,
    momentumScore: decision.momentumScore,
    metadata: decision.metadata as Record<string, unknown> | null,
    persist: true,
  });

  const entryPrice = extractPrice(decision);
  const stopDistance = Math.max(prediction.expectedRisk, 0.5);
  const targetDistance = Math.max(prediction.expectedReturn, stopDistance * 1.5);

  await persistShadowTrade({
    decisionId,
    engineId: ML_ENGINE_ID,
    modelId: prediction.modelId !== "fallback" ? prediction.modelId : undefined,
    symbol: decision.symbol,
    decision: prediction.decision,
    entryPrice,
    metadata: {
      confidence: prediction.confidence,
      expectedReturn: prediction.expectedReturn,
      expectedRisk: prediction.expectedRisk,
      modelVersion: prediction.modelVersion,
      inferenceTimeMs: prediction.inferenceTimeMs,
    },
  });

  await persistPredictionAsObserveOnlyDecision({
    decisionId: `s2de_${decisionId}`,
    symbol: decision.symbol,
    prediction,
  });

  return {
    decisionId,
    symbol: decision.symbol,
    engineId: ML_ENGINE_ID,
    engineMode: "SHADOW",
    decision: prediction.decision,
    confidence: prediction.confidence,
    entryPrice,
    targetPrice: entryPrice ? entryPrice * (1 + targetDistance / 100) : undefined,
    stopPrice: entryPrice ? entryPrice * (1 - stopDistance / 100) : undefined,
    reasoning: prediction.reason,
    productionDecision: decision.decision,
    payload: {
      adapter: "decision-engine-v2",
      rawProbabilities: prediction.rawProbabilities,
      calibratedProbabilities: prediction.calibratedProbabilities,
      expectedHoldingMinutes: prediction.expectedHoldingMinutes,
      expectedMaxDrawdown: prediction.expectedMaxDrawdown,
      expectedMaxProfit: prediction.expectedMaxProfit,
      modelId: prediction.modelId,
      modelVersion: prediction.modelVersion,
    },
  };
}

export async function evaluateShadowTradesForEngine(engineId: string, limit = 50) {
  const { listPendingShadowEvaluations, updateShadowDecisionEvaluation } = await import(
    "@/src/server/shadow-validation/shadow-validation.repository"
  );
  const { evaluateShadowOutcome } = await import("@/src/server/shadow-validation/outcome-evaluator.service");

  const pending = await listPendingShadowEvaluations(limit);
  let evaluated = 0;

  for (const row of pending.filter((r) => r.engineId === engineId)) {
    const outcome = await evaluateShadowOutcome({
      symbol: row.symbol,
      decisionTime: row.capturedAt,
      entryPrice: row.entryPrice ?? undefined,
      decision: row.decision,
      productionDecision: row.productionDecision ?? undefined,
    });
    if (outcome.verdict === "PENDING") continue;

    await updateShadowDecisionEvaluation({
      decisionId: row.decisionId,
      engineId: row.engineId,
      verdict: outcome.verdict,
      profitPct: outcome.profitPct,
      metadata: { mfePct: outcome.mfePct, maePct: outcome.maePct, profitDeltaPct: outcome.profitDeltaPct },
    });

    const trades = await import("@/src/server/db/prisma").then(({ prisma }) =>
      prisma.shadowTrade.findFirst({
        where: { decisionId: row.decisionId, engineId, status: "OPEN" },
      }),
    );
    if (trades && row.entryPrice) {
      const exitPrice = row.entryPrice * (1 + (outcome.profitPct ?? 0) / 100);
      await closeShadowTrade(trades.tradeKey, exitPrice, outcome.profitPct ?? 0);
    }
    evaluated += 1;
  }

  return { evaluated };
}

export async function calculateShadowPerformanceReport(input?: { engineId?: string; days?: number }) {
  const engineId = input?.engineId ?? ML_ENGINE_ID;
  const days = input?.days ?? 30;
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - days * 24 * 60 * 60 * 1000);

  const trades = await listClosedShadowTrades(engineId, 2000);
  const inPeriod = trades.filter((t) => t.closedAt && t.closedAt >= periodStart && t.closedAt <= periodEnd);
  const returns = inPeriod.map((t) => Number(t.virtualPnlPct ?? 0)).filter((v) => Number.isFinite(v));
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const winRate = returns.length > 0 ? (wins.length / returns.length) * 100 : 0;
  const grossProfit = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? grossProfit : 0;
  const expectancy = returns.length > 0 ? returns.reduce((s, v) => s + v, 0) / returns.length : 0;
  const mean = expectancy;
  const variance =
    returns.length > 1 ? returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1) : 0;
  const sharpe = Math.sqrt(variance) > 0 ? (mean / Math.sqrt(variance)) * Math.sqrt(252) : 0;

  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const r of returns) {
    equity += r;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }

  const rejectedTrades = inPeriod.filter((t) => t.decision === "NO_TRADE").length;
  const missedTrades = 0;

  const record = await persistShadowPerformance({
    engineId,
    periodStart,
    periodEnd,
    winRate: Number(winRate.toFixed(4)),
    profitFactor: Number(profitFactor.toFixed(4)),
    expectancy: Number(expectancy.toFixed(4)),
    sharpe: Number(sharpe.toFixed(4)),
    maxDrawdown: Number(maxDrawdown.toFixed(4)),
    missedTrades,
    rejectedTrades,
    expectedProfit: Number(grossProfit.toFixed(4)),
    actualProfit: Number((grossProfit - grossLoss).toFixed(4)),
    sampleSize: returns.length,
    metadata: { days },
  });

  emitDecisionEngineV2Event(DECISION_ENGINE_V2_EVENT.SHADOW_PERFORMANCE_UPDATED, {
    engineId,
    sampleSize: returns.length,
    profitFactor: record.profitFactor,
  });

  return record;
}

export async function compareRuleVsMlShadow(days = 30) {
  const [ml, rule] = await Promise.all([
    calculateShadowPerformanceReport({ engineId: ML_ENGINE_ID, days }),
    calculateShadowPerformanceReport({ engineId: RULE_BASELINE_ENGINE_ID, days }),
  ]);

  return {
    ruleEngineId: RULE_BASELINE_ENGINE_ID,
    mlEngineId: ML_ENGINE_ID,
    winRateDelta: ml.winRate - rule.winRate,
    profitFactorDelta: ml.profitFactor - rule.profitFactor,
    expectancyDelta: ml.expectancy - rule.expectancy,
    maxDrawdownDelta: ml.maxDrawdown - rule.maxDrawdown,
    avgHoldingMinutesDelta: 0,
    tradeQualityDelta: ml.profitFactor - rule.profitFactor,
    ml,
    rule,
  };
}

export { ML_ENGINE_ID, RULE_BASELINE_ENGINE_ID };

export async function getMlShadowTradeCount() {
  return countClosedShadowTrades(ML_ENGINE_ID);
}
