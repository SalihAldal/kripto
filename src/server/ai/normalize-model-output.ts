import { env } from "@/lib/config";
import type { AIAnalysisInput, AIModelOutput } from "@/src/types/ai";

function safePercent(value: unknown, fallback: number) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

export function computeDirectionalProfitPercent(input: {
  side: "BUY" | "SELL";
  entryPrice: number;
  targetPrice: number | null | undefined;
}) {
  const entryPrice = Number(input.entryPrice);
  const targetPrice = Number(input.targetPrice ?? 0);
  if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(targetPrice) || targetPrice <= 0) {
    return null;
  }
  const raw =
    input.side === "BUY"
      ? ((targetPrice - entryPrice) / entryPrice) * 100
      : ((entryPrice - targetPrice) / entryPrice) * 100;
  return Number.isFinite(raw) ? Number(raw.toFixed(4)) : null;
}

export function normalizeAiModelOutput(input: {
  output: AIModelOutput;
  analysisInput: Pick<AIAnalysisInput, "lastPrice">;
  minProfitPercent?: number;
  maxDurationSec?: number;
}) {
  const lastPrice = Number(input.analysisInput.lastPrice);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;

  const minProfitPercent = safePercent(input.minProfitPercent, Math.max(0.25, env.EXECUTION_TARGET_MIN_PROFIT_PERCENT));
  const stopPercent = safePercent(input.output.metadata?.stopPercent, Math.max(0.2, minProfitPercent * 0.75));
  const decision = input.output.decision;
  const maxDurationSec = Math.max(60, Math.min(input.maxDurationSec ?? 3600, 7200));

  let targetPrice = input.output.targetPrice;
  let stopPrice = input.output.stopPrice;

  if (decision === "BUY") {
    const minTarget = lastPrice * (1 + minProfitPercent / 100);
    if (!Number.isFinite(Number(targetPrice)) || Number(targetPrice) <= lastPrice) {
      targetPrice = Number(minTarget.toFixed(8));
    }
    if (!Number.isFinite(Number(stopPrice)) || Number(stopPrice) >= lastPrice) {
      stopPrice = Number((lastPrice * (1 - stopPercent / 100)).toFixed(8));
    }
  } else if (decision === "SELL") {
    const maxTarget = lastPrice * (1 - minProfitPercent / 100);
    if (!Number.isFinite(Number(targetPrice)) || Number(targetPrice) >= lastPrice) {
      targetPrice = Number(maxTarget.toFixed(8));
    }
    if (!Number.isFinite(Number(stopPrice)) || Number(stopPrice) <= lastPrice) {
      stopPrice = Number((lastPrice * (1 + stopPercent / 100)).toFixed(8));
    }
  } else {
    targetPrice = null;
    stopPrice = null;
  }

  return {
    ...input.output,
    targetPrice: targetPrice === null ? null : Number(Number(targetPrice).toFixed(8)),
    stopPrice: stopPrice === null ? null : Number(Number(stopPrice).toFixed(8)),
    estimatedDurationSec: Math.max(30, Math.min(maxDurationSec, Math.round(input.output.estimatedDurationSec || 420))),
    metadata: {
      ...input.output.metadata,
      normalizedTargetStop: true,
      minProfitPercent,
    },
  } satisfies AIModelOutput;
}
