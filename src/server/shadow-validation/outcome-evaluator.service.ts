import type { ShadowDecisionVerdict } from "@prisma/client";
import { buildPricePath } from "@/src/server/replay/price-path.service";
import { REPLAY_HORIZONS } from "@/src/server/replay/replay.types";
import { isEntryDecision, isRejectDecision } from "@/src/server/shadow-validation/decision-comparison.service";

const EVAL_HORIZON = REPLAY_HORIZONS.find((row) => row.label === "1h") ?? REPLAY_HORIZONS[4];

export type OutcomeEvaluation = {
  verdict: ShadowDecisionVerdict;
  profitPct: number;
  mfePct: number;
  maePct: number;
  productionProfitPct?: number;
  profitDeltaPct?: number;
};

export async function evaluateShadowOutcome(input: {
  symbol: string;
  decisionTime: Date;
  entryPrice?: number;
  decision: string;
  productionDecision?: string;
}): Promise<OutcomeEvaluation> {
  const pricePath = await buildPricePath({
    symbol: input.symbol,
    decisionTime: input.decisionTime,
    fallbackPrice: input.entryPrice,
  });

  if (pricePath.priceAtDecision <= 0 || pricePath.candles.length === 0) {
    return { verdict: "PENDING", profitPct: 0, mfePct: 0, maePct: 0 };
  }

  const endMs = input.decisionTime.getTime() + EVAL_HORIZON.ms;
  const window = pricePath.candles.filter((row) => row.openTime <= endMs);
  const entry = pricePath.priceAtDecision;
  let highest = entry;
  let lowest = entry;
  for (const candle of window) {
    highest = Math.max(highest, candle.high);
    lowest = Math.min(lowest, candle.low);
  }
  const close = window[window.length - 1]?.close ?? entry;
  const profitPct = ((close - entry) / entry) * 100;
  const mfePct = ((highest - entry) / entry) * 100;
  const maePct = ((lowest - entry) / entry) * 100;

  const bullishMove = profitPct > 0.35;
  const bearishMove = profitPct < -0.35;
  const entrySignal = isEntryDecision(input.decision);
  const rejectSignal = isRejectDecision(input.decision);
  const prodEntry = input.productionDecision ? isEntryDecision(input.productionDecision) : false;
  const prodReject = input.productionDecision ? isRejectDecision(input.productionDecision) : false;

  let verdict: ShadowDecisionVerdict = "PENDING";
  if (entrySignal && bullishMove) verdict = "CORRECT";
  else if (entrySignal && bearishMove) verdict = "FALSE_ENTRY";
  else if (rejectSignal && bullishMove && !prodEntry) verdict = "MISSED_OPPORTUNITY";
  else if (rejectSignal && !bullishMove) verdict = "CORRECT";
  else if (entrySignal && !bullishMove && !bearishMove) verdict = "WRONG";
  else if (prodReject && entrySignal && bullishMove) verdict = "BETTER";
  else if (prodEntry && rejectSignal && bearishMove) verdict = "BETTER";
  else if (prodEntry && entrySignal && profitPct > 0 && mfePct > 0.5) verdict = input.decision === input.productionDecision ? "CORRECT" : "WORSE";

  let productionProfitPct: number | undefined;
  let profitDeltaPct: number | undefined;
  if (input.productionDecision) {
    if (isEntryDecision(input.productionDecision)) productionProfitPct = profitPct;
    else if (isRejectDecision(input.productionDecision)) productionProfitPct = -profitPct;
    else productionProfitPct = 0;
    profitDeltaPct = profitPct - (productionProfitPct ?? 0);
    if (verdict === "PENDING" && profitDeltaPct > 0.25) verdict = "BETTER";
    if (verdict === "PENDING" && profitDeltaPct < -0.25) verdict = "WORSE";
  }

  if (verdict === "PENDING") verdict = bullishMove ? (entrySignal ? "CORRECT" : "MISSED_OPPORTUNITY") : "CORRECT";

  return { verdict, profitPct, mfePct, maePct, productionProfitPct, profitDeltaPct };
}
