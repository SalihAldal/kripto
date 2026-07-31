import { getTicker } from "@/services/binance.service";
import { buildAIInput, runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { logTradeEvent } from "@/src/server/observability/trade-event-log";
import { getPositionTracking, upsertPositionTracking } from "@/src/server/repositories/position-tracking.repository";
import { listOpenPositionsByUser, updatePositionMetadata } from "@/src/server/repositories/execution.repository";
import { notifySystemEvent } from "@/src/server/notifications/notification.service";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";

const trackers = new Map<string, NodeJS.Timeout>();
const TRACK_INTERVAL_MS = 30_000;

function computeProfitPercent(side: "LONG" | "SHORT", entryPrice: number, currentPrice: number) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return 0;
  if (side === "LONG") {
    return ((currentPrice - entryPrice) / entryPrice) * 100;
  }
  return ((entryPrice - currentPrice) / entryPrice) * 100;
}

export function ensureLivePositionTracking(userId: string) {
  if (trackers.has(userId)) return;
  const timer = setInterval(async () => {
    const openPositions = await listOpenPositionsByUser(userId).catch(() => []);
    for (const position of openPositions) {
      const symbol = position.tradingPair.symbol;
      const ticker = await getTicker(symbol).catch(() => null);
      if (!ticker) continue;
      const currentPrice = ticker.price;
      const existing = await getPositionTracking(position.id).catch(() => null);
      const highest =
        position.side === "LONG"
          ? Math.max(existing?.highestPriceAfterBuy ?? position.entryPrice, currentPrice)
          : Math.min(existing?.highestPriceAfterBuy ?? position.entryPrice, currentPrice);
      const profitPercent = computeProfitPercent(position.side, position.entryPrice, currentPrice);
      const input = await buildAIInput(symbol).catch(() => null);
      const consensus = input ? await runAIConsensusFromInput(input).catch(() => null) : null;
      const metadata = (position.metadata as Record<string, unknown> | null) ?? {};
      const runtimeStrategy = await getRuntimeStrategyParams().catch(() => null);
      const targetUpdateConfidence = Number(runtimeStrategy?.targetUpdateConfidence ?? 80);
      const scorecard = consensus?.analysisScorecard;
      const currentTarget = Number(metadata.takeProfitPrice ?? 0);
      const hasReasonableRange =
        scorecard &&
        scorecard.expectedMoveRange.min > 0 &&
        scorecard.expectedMoveRange.max > scorecard.expectedMoveRange.min &&
        scorecard.expectedMovePercent >= 0.2 &&
        scorecard.expectedMovePercent <= 15;
      let effectiveTarget = Number(metadata.takeProfitPrice ?? 0);
      if (
        scorecard &&
        scorecard.confidenceScore >= targetUpdateConfidence &&
        hasReasonableRange &&
        Number.isFinite(position.entryPrice) &&
        position.entryPrice > 0
      ) {
        const candidateTarget =
          position.side === "LONG"
            ? position.entryPrice * (1 + scorecard.targetSellPercent / 100)
            : position.entryPrice * (1 - scorecard.targetSellPercent / 100);
        const shouldRaise =
          position.side === "LONG"
            ? candidateTarget > currentTarget && candidateTarget > position.entryPrice
            : candidateTarget < currentTarget && candidateTarget < position.entryPrice;
        if (shouldRaise) {
          effectiveTarget = Number(candidateTarget.toFixed(6));
          await updatePositionMetadata(position.id, {
            takeProfitPrice: effectiveTarget,
            targetSellPercent: scorecard.targetSellPercent,
            trailingStartPercent: scorecard.trailingStartPercent,
            trailingGapPercent: scorecard.trailingGapPercent,
          }).catch(() => null);
          await logTradeEvent({
            positionId: position.id,
            symbol,
            eventType: "AI_TARGET_RAISED",
            price: currentPrice,
            aiConfidence: scorecard.confidenceScore,
            oldValue: currentTarget ? { targetSellPrice: currentTarget } : null,
            newValue: { targetSellPrice: effectiveTarget },
            reason: "ai-target-raise",
          });
          await notifySystemEvent({
            userId,
            eventType: "TARGET_RAISED",
            title: "Hedef yukseltildi",
            message: `${symbol} hedef fiyati ${effectiveTarget.toFixed(4)} seviyesine cekildi`,
            level: "INFO",
            symbol,
          });
        }
      }

      await upsertPositionTracking({
        positionId: position.id,
        symbol,
        buyPrice: position.entryPrice,
        currentPrice,
        highestPriceAfterBuy: highest,
        targetSellPrice: effectiveTarget || undefined,
        activeStopPrice: Number(metadata.stopLossPrice ?? 0) || undefined,
        trailingActive: Boolean(metadata.trailingActive ?? false),
        profitPercent,
        aiLastDecision: consensus?.finalDecision ?? null,
        lastAnalysisAt: consensus ? new Date() : null,
        positionStatus: position.status,
        metadata: {
          analysisScorecard: consensus?.analysisScorecard ?? null,
        },
      });

      if (consensus) {
        await logTradeEvent({
          positionId: position.id,
          symbol,
          eventType: "AI_ANALYSIS_RESULT",
          price: currentPrice,
          aiConfidence: consensus.finalConfidence,
          newValue: {
            decision: consensus.finalDecision,
            riskScore: consensus.finalRiskScore,
          },
          reason: consensus.explanation,
        });
      }

      if (consensus && consensus.finalDecision === "SELL" && consensus.finalRiskScore >= 75) {
        await logTradeEvent({
          positionId: position.id,
          symbol,
          eventType: "STOP_TRIGGERED",
          price: currentPrice,
          aiConfidence: consensus.finalConfidence,
          reason: "RISK_EXIT",
          newValue: {
            riskScore: consensus.finalRiskScore,
          },
        });
        await notifySystemEvent({
          userId,
          eventType: "AI_RISK",
          title: "AI risk algiladi",
          message: `${symbol} icin risk skoru yuksek (${consensus.finalRiskScore.toFixed(2)})`,
          level: "WARN",
          symbol,
        });
        const { closePositionManually } = await import("./execution-orchestrator.service");
        await closePositionManually({
          positionId: position.id,
          executionId: typeof metadata.executionId === "string" ? metadata.executionId : undefined,
          reason: "RISK_BREAKER",
        }).catch(() => null);
      }
    }
  }, TRACK_INTERVAL_MS);
  trackers.set(userId, timer);
}

export function stopLivePositionTracking(userId: string) {
  const timer = trackers.get(userId);
  if (!timer) return;
  clearInterval(timer);
  trackers.delete(userId);
}
