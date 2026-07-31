import type { DecisionVerdict } from "@prisma/client";
import type { VerdictInput } from "@/src/server/replay/replay.types";

const EVAL_MISSED_WINNER_PCT = 2;
const EVAL_MISSED_BREAKOUT_PCT = 5;
const EVAL_MISSED_PUMP_PCT = 12;
const EVAL_FALSE_BUY_DRAWDOWN_PCT = -5;
const EVAL_CORRECT_REJECT_DRAWDOWN_PCT = -3;

function isRejectDecision(decision: string, executionAllowed: boolean) {
  const normalized = decision.toUpperCase();
  if (executionAllowed) return false;
  return ["NO_TRADE", "REJECT", "HOLD"].includes(normalized);
}

export function classifyReplayVerdict(input: VerdictInput): DecisionVerdict {
  const decision = input.originalDecision.toUpperCase();
  const { metrics, executionAllowed } = input;
  const best = metrics.peakProfitPct;
  const worst = metrics.maePct;
  const ret24h = metrics.horizonReturns["24h"] ?? best;

  if (isRejectDecision(decision, executionAllowed)) {
    if (best >= EVAL_MISSED_PUMP_PCT) return "MISSED_PUMP";
    if (best >= EVAL_MISSED_BREAKOUT_PCT) return "MISSED_BREAKOUT";
    if (best >= EVAL_MISSED_WINNER_PCT) return "MISSED_WINNER";
    if (worst <= EVAL_CORRECT_REJECT_DRAWDOWN_PCT) return "CORRECT";
    if (best > 0.5) return "WRONG";
    return "PARTIALLY_CORRECT";
  }

  if (decision === "BUY" || executionAllowed) {
    if (worst <= EVAL_FALSE_BUY_DRAWDOWN_PCT && ret24h < 1) return "FALSE_BUY";
    if (ret24h >= 2) return "CORRECT";
    if (ret24h >= 0.5) return "PARTIALLY_CORRECT";
    if (worst <= -2 && ret24h < 0) return "EARLY_ENTRY";
    if (ret24h < -1) return "WRONG";
    return "PARTIALLY_CORRECT";
  }

  if (decision === "SELL") {
    if (worst >= 2) return "CORRECT";
    if (best >= 3) return "FALSE_SELL";
    if (ret24h <= -1) return "PARTIALLY_CORRECT";
    return "WRONG";
  }

  return "UNKNOWN";
}

export function buildVerdictSummary(input: VerdictInput & { verdict: DecisionVerdict; symbol: string }) {
  const { verdict, metrics, symbol } = input;
  const best = metrics.peakProfitPct.toFixed(2);
  const worst = metrics.maePct.toFixed(2);
  return `${symbol.toUpperCase()} ${input.originalDecision} replay verdict=${verdict}; peak=+${best}% trough=${worst}%.`;
}

export function computeMissedProfit(input: {
  originalDecision: string;
  executionAllowed: boolean;
  metrics: VerdictInput["metrics"];
}) {
  if (!isRejectDecision(input.originalDecision, input.executionAllowed)) {
    return { missedProfitPct: 0, missedLossPct: Math.abs(Math.min(0, input.metrics.maePct)) };
  }
  return {
    missedProfitPct: Math.max(0, input.metrics.peakProfitPct),
    missedLossPct: Math.abs(Math.min(0, input.metrics.maePct)),
  };
}
