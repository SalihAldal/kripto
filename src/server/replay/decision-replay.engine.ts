import { logger } from "@/lib/logger";
import { REPLAY_HORIZONS } from "@/src/server/replay/replay.types";
import { buildDecisionAttribution, toAttributionRows } from "@/src/server/replay/decision-attribution.service";
import {
  createReplayJob,
  getDecisionLogForReplay,
  markReplayFailed,
  markReplayRunning,
  markReplaySkipped,
  persistReplayResult,
} from "@/src/server/replay/decision-replay.repository";
import { buildMissedOpportunityRecord } from "@/src/server/replay/missed-opportunity.service";
import { buildPricePath, computePathExtremes, priceAtTime, sliceCandlesUntil } from "@/src/server/replay/price-path.service";
import { computeReplayMetrics } from "@/src/server/replay/replay-metrics.service";
import {
  buildVerdictSummary,
  classifyReplayVerdict,
  computeMissedProfit,
} from "@/src/server/replay/replay-verdict.service";
import type { ReplayJobCadence } from "@prisma/client";

function extractPriceFromDecision(decision: Awaited<ReturnType<typeof getDecisionLogForReplay>>) {
  const raw = decision?.featureSnapshot?.raw as Record<string, unknown> | null | undefined;
  const lastPrice = Number(raw?.lastPrice ?? 0);
  if (Number.isFinite(lastPrice) && lastPrice > 0) return lastPrice;
  const marketState = decision?.marketState as Record<string, unknown> | null | undefined;
  const statePrice = Number(marketState?.lastPrice ?? 0);
  if (Number.isFinite(statePrice) && statePrice > 0) return statePrice;
  return null;
}

function extractRegime(decision: NonNullable<Awaited<ReturnType<typeof getDecisionLogForReplay>>>) {
  const marketState = decision.marketState as Record<string, unknown> | null | undefined;
  if (typeof marketState?.mode === "string") return marketState.mode;
  if (typeof marketState?.marketRegime === "string") return marketState.marketRegime;
  return null;
}

export async function replayDecision(input: { decisionId: string; cadence?: ReplayJobCadence; replayId?: string }) {
  const decision = await getDecisionLogForReplay(input.decisionId);
  if (!decision) {
    throw new Error(`DecisionLog not found: ${input.decisionId}`);
  }

  const replay =
    input.replayId != null
      ? { id: input.replayId }
      : await createReplayJob({
          decisionId: decision.decisionId,
          symbol: decision.symbol,
          originalDecision: decision.decision,
          decisionTime: decision.timestamp,
          priceAtDecision: extractPriceFromDecision(decision),
          cadence: input.cadence,
        });

  await markReplayRunning(replay.id);

  try {
    const fallbackPrice = extractPriceFromDecision(decision);
    const pricePath = await buildPricePath({
      symbol: decision.symbol,
      decisionTime: decision.timestamp,
      fallbackPrice,
    });

    if (pricePath.priceAtDecision <= 0) {
      await markReplaySkipped(replay.id, "No price data available for replay");
      return { replayId: replay.id, status: "SKIPPED" as const };
    }

    if (pricePath.candles.length === 0 && pricePath.source === "decision_log") {
      await markReplaySkipped(replay.id, "Insufficient historical price path coverage");
      return { replayId: replay.id, status: "SKIPPED" as const };
    }

    const metrics = computeReplayMetrics({
      candles: pricePath.candles,
      entryPrice: pricePath.priceAtDecision,
      decisionTime: decision.timestamp,
      marketRegimeAfter: extractRegime(decision),
    });

    const verdict = classifyReplayVerdict({
      originalDecision: decision.decision,
      executionAllowed: decision.executionAllowed,
      metrics,
      confidence: decision.confidence,
    });

    const missed = computeMissedProfit({
      originalDecision: decision.decision,
      executionAllowed: decision.executionAllowed,
      metrics,
    });

    const summary = buildVerdictSummary({
      verdict,
      symbol: decision.symbol,
      originalDecision: decision.decision,
      executionAllowed: decision.executionAllowed,
      metrics,
    });

    const historicalOutcomes = REPLAY_HORIZONS.map((horizon) => {
      const endMs = decision.timestamp.getTime() + horizon.ms;
      const slice = sliceCandlesUntil(pricePath.candles, endMs);
      const price = priceAtTime(slice, endMs, pricePath.priceAtDecision);
      const extremes = computePathExtremes(slice, pricePath.priceAtDecision);
      return {
        horizonLabel: horizon.label,
        horizonMs: horizon.ms,
        targetTime: new Date(endMs),
        priceAtHorizon: price,
        returnPct: ((price - pricePath.priceAtDecision) / pricePath.priceAtDecision) * 100,
        highSinceDecision: extremes.highest,
        lowSinceDecision: extremes.lowest,
        mfePct: extremes.mfePct,
        maePct: extremes.maePct,
        regime: extractRegime(decision),
      };
    });

    const topReject = decision.rejectReasonRows[0];
    const missedOpportunity = buildMissedOpportunityRecord({
      decisionId: decision.decisionId,
      symbol: decision.symbol,
      decisionTime: decision.timestamp,
      priceAtDecision: pricePath.priceAtDecision,
      originalDecision: decision.decision,
      executionAllowed: decision.executionAllowed,
      verdict,
      confidence: decision.confidence,
      marketRegime: extractRegime(decision),
      reasonRejected: topReject?.reason ?? decision.humanSummary,
      metrics,
    });

    const attributionFactors = buildDecisionAttribution({
      decisionId: decision.decisionId,
      verdict,
      rejectReasons: decision.rejectReasonRows,
      featureSnapshot: (decision.featureSnapshot ?? undefined) as Record<string, unknown> | undefined,
      scores: {
        scannerScore: decision.scannerScore,
        technicalScore: decision.technicalScore,
        volumeScore: decision.volumeScore,
        momentumScore: decision.momentumScore,
        trendScore: decision.trendScore,
        regimeScore: decision.regimeScore,
        riskScore: decision.riskScore,
        liquidityScore: decision.liquidityScore,
        newsScore: decision.newsScore,
        confidence: decision.confidence,
      },
      metadata: (decision.metadata as Record<string, unknown> | null) ?? undefined,
      metrics,
    });

    await persistReplayResult({
      replayId: replay.id,
      decisionId: decision.decisionId,
      evaluation: {
        verdict,
        verdictConfidence: decision.confidence,
        metrics: {
          ...metrics,
          missedProfitPct: missed.missedProfitPct,
          missedLossPct: missed.missedLossPct,
        },
        summary,
        metadata: {
          priceSource: pricePath.source,
          coveragePct: pricePath.coveragePct,
        },
      },
      historicalOutcomes,
      missedOpportunity: missedOpportunity
        ? {
            ...missedOpportunity,
            horizonBreakdown: missedOpportunity.horizonBreakdown,
          }
        : null,
      attributions: toAttributionRows(replay.id, decision.decisionId, attributionFactors),
    });

    return { replayId: replay.id, status: "COMPLETED" as const, verdict };
  } catch (error) {
    const message = (error as Error).message;
    logger.warn({ decisionId: input.decisionId, error: message }, "Decision replay failed");
    await markReplayFailed(replay.id, message);
    throw error;
  }
}

export async function enqueueDecisionForReplay(decisionId: string, cadence?: ReplayJobCadence) {
  const decision = await getDecisionLogForReplay(decisionId);
  if (!decision) return null;
  return createReplayJob({
    decisionId: decision.decisionId,
    symbol: decision.symbol,
    originalDecision: decision.decision,
    decisionTime: decision.timestamp,
    priceAtDecision: extractPriceFromDecision(decision),
    cadence,
  });
}
