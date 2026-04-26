import { env } from "@/lib/config";
import type { PositionCloseReason } from "@/src/server/execution/types";

export type SmartExitEvaluationResult = {
  initialTp: number;
  adaptiveTp: number;
  trailingSuggestion: {
    enabled: boolean;
    activationProfitPercent: number;
    drawdownPercent: number;
    lockMode: "AGGRESSIVE" | "BALANCED" | "WIDE";
  };
  earlyExitTrigger:
    | "NONE"
    | "MOMENTUM_FADE"
    | "REVERSAL_CANDLE"
    | "VOLUME_DROPOFF"
    | "REGIME_SHIFT"
    | "REVERSE_SIGNAL";
  exitConfidence: number;
  exitSummary: string;
  closeReason: PositionCloseReason | null;
};

export type SmartExitEngineState = {
  lastAdaptiveTp: number;
  peakProfitPercent: number;
  lastRegime: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function evaluateSmartExitEngine(input: {
  side: "LONG" | "SHORT";
  entryPrice: number;
  markPrice: number;
  initialTp: number;
  state: SmartExitEngineState;
  shortMomentumPercent: number;
  shortFlowImbalance: number;
  shortCandleSignal: number;
  spreadPercent: number;
  volatilityPercent: number;
  volume24h: number;
  marketRegime: string;
  reverseSignal: boolean;
}): SmartExitEvaluationResult {
  const baseProfitTargetPercent =
    input.side === "LONG"
      ? ((input.initialTp - input.entryPrice) / Math.max(input.entryPrice, 0.00000001)) * 100
      : ((input.entryPrice - input.initialTp) / Math.max(input.entryPrice, 0.00000001)) * 100;
  const currentProfitPercent =
    input.side === "LONG"
      ? ((input.markPrice - input.entryPrice) / Math.max(input.entryPrice, 0.00000001)) * 100
      : ((input.entryPrice - input.markPrice) / Math.max(input.entryPrice, 0.00000001)) * 100;
  const peakProfitPercent = Number.isFinite(input.state.peakProfitPercent)
    ? Math.max(input.state.peakProfitPercent, currentProfitPercent)
    : currentProfitPercent;

  const momentumAligned =
    input.side === "LONG"
      ? input.shortMomentumPercent > 0.2 && input.shortFlowImbalance > 0.04
      : input.shortMomentumPercent < -0.2 && input.shortFlowImbalance < -0.04;
  const momentumDead =
    input.side === "LONG"
      ? input.shortMomentumPercent <= -env.EXECUTION_MOMENTUM_FADE_THRESHOLD && input.shortFlowImbalance <= -0.03
      : input.shortMomentumPercent >= env.EXECUTION_MOMENTUM_FADE_THRESHOLD && input.shortFlowImbalance >= 0.03;
  const reversalCandle =
    input.side === "LONG"
      ? input.shortCandleSignal <= -2
      : input.shortCandleSignal >= 2;
  const volumeDrop = input.volume24h < env.SCANNER_MIN_VOLUME_24H * 1.15;
  const regimeRisky =
    input.marketRegime === "HIGH_VOLATILITY_CHAOS" ||
    input.marketRegime === "LOW_VOLUME_DEAD_MARKET" ||
    input.marketRegime === "NEWS_DRIVEN_UNSTABLE";

  let adaptiveTargetPercent = clamp(baseProfitTargetPercent, 0.25, env.EXECUTION_TARGET_MAX_PROFIT_PERCENT);
  if (momentumAligned && currentProfitPercent > baseProfitTargetPercent * 0.45) {
    adaptiveTargetPercent = clamp(baseProfitTargetPercent * 1.18, 0.25, env.EXECUTION_TARGET_MAX_PROFIT_PERCENT);
  } else if (momentumDead) {
    adaptiveTargetPercent = clamp(
      Math.max(currentProfitPercent + 0.2, baseProfitTargetPercent * 0.8),
      0.25,
      env.EXECUTION_TARGET_MAX_PROFIT_PERCENT,
    );
  }

  const rawAdaptiveTp =
    input.side === "LONG"
      ? input.entryPrice * (1 + adaptiveTargetPercent / 100)
      : input.entryPrice * (1 - adaptiveTargetPercent / 100);
  const maxJumpPercent = 0.35; // Dinamik TP adimi kisitli: kaotik ziplamayi engeller.
  const maxJumpAbs = input.entryPrice * (maxJumpPercent / 100);
  const smoothedAdaptiveTp = clamp(
    rawAdaptiveTp,
    input.state.lastAdaptiveTp - maxJumpAbs,
    input.state.lastAdaptiveTp + maxJumpAbs,
  );

  const trailingMode: SmartExitEvaluationResult["trailingSuggestion"]["lockMode"] =
    momentumAligned && !momentumDead ? "WIDE" : momentumDead || reversalCandle ? "AGGRESSIVE" : "BALANCED";
  const trailingDrawdown =
    trailingMode === "WIDE"
      ? clamp(env.EXECUTION_TRAILING_DRAWDOWN_PERCENT * 1.2, 0.2, 1.2)
      : trailingMode === "AGGRESSIVE"
        ? clamp(env.EXECUTION_TRAILING_DRAWDOWN_PERCENT * 0.7, 0.1, 1)
        : clamp(env.EXECUTION_TRAILING_DRAWDOWN_PERCENT, 0.12, 1.1);

  let earlyExitTrigger: SmartExitEvaluationResult["earlyExitTrigger"] = "NONE";
  if (input.reverseSignal) earlyExitTrigger = "REVERSE_SIGNAL";
  else if (regimeRisky && peakProfitPercent > 0.35) earlyExitTrigger = "REGIME_SHIFT";
  else if (momentumDead && currentProfitPercent > 0.25) earlyExitTrigger = "MOMENTUM_FADE";
  else if (reversalCandle && currentProfitPercent > 0.2) earlyExitTrigger = "REVERSAL_CANDLE";
  else if (volumeDrop && peakProfitPercent > 0.6 && currentProfitPercent < peakProfitPercent - 0.25) earlyExitTrigger = "VOLUME_DROPOFF";

  const exitConfidence = Number(
    clamp(
      (earlyExitTrigger !== "NONE" ? 48 : 14) +
        (input.reverseSignal ? 22 : 0) +
        (momentumDead ? 16 : 0) +
        (reversalCandle ? 14 : 0) +
        (regimeRisky ? 12 : 0) +
        (volumeDrop ? 8 : 0) +
        (input.spreadPercent > env.AI_HYBRID_MAX_SPREAD_PERCENT ? 10 : 0) +
        (input.volatilityPercent >= env.EXECUTION_BLOCK_HIGH_VOLATILITY_PERCENT ? 10 : 0),
      0,
      100,
    ).toFixed(2),
  );

  const closeReason: PositionCloseReason | null =
    earlyExitTrigger === "REVERSE_SIGNAL"
      ? "REVERSE_SIGNAL"
      : earlyExitTrigger !== "NONE"
        ? "MOMENTUM_FADE"
        : null;
  const summary =
    earlyExitTrigger === "NONE"
      ? momentumAligned
        ? "Momentum guclu; TP erken kesilmiyor, trailing genis modda."
        : "Exit izleniyor; teyit gelmeden erken kapatma yok."
      : `Erken cikis tetigi: ${earlyExitTrigger}. Kar koruma oncelikli cikis degerlendirildi.`;

  input.state.lastAdaptiveTp = Number(smoothedAdaptiveTp.toFixed(8));
  input.state.peakProfitPercent = Number(peakProfitPercent.toFixed(4));
  input.state.lastRegime = input.marketRegime;

  return {
    initialTp: Number(input.initialTp.toFixed(8)),
    adaptiveTp: Number(smoothedAdaptiveTp.toFixed(8)),
    trailingSuggestion: {
      enabled: true,
      activationProfitPercent: Number(env.EXECUTION_TRAILING_ACTIVATION_PERCENT.toFixed(4)),
      drawdownPercent: Number(trailingDrawdown.toFixed(4)),
      lockMode: trailingMode,
    },
    earlyExitTrigger,
    exitConfidence,
    exitSummary: summary,
    closeReason,
  };
}

export function buildInitialSmartExitPlan(input: {
  side: "BUY" | "SELL";
  entryPrice: number;
  takeProfitPrice: number;
}) {
  const long = input.side === "BUY";
  const baseTpPercent = long
    ? ((input.takeProfitPrice - input.entryPrice) / Math.max(input.entryPrice, 0.00000001)) * 100
    : ((input.entryPrice - input.takeProfitPrice) / Math.max(input.entryPrice, 0.00000001)) * 100;
  return {
    initialTp: Number(input.takeProfitPrice.toFixed(8)),
    adaptiveTp: Number(input.takeProfitPrice.toFixed(8)),
    trailingSuggestion: {
      enabled: true,
      activationProfitPercent: Number(env.EXECUTION_TRAILING_ACTIVATION_PERCENT.toFixed(4)),
      drawdownPercent: Number(env.EXECUTION_TRAILING_DRAWDOWN_PERCENT.toFixed(4)),
      lockMode: "BALANCED" as const,
    },
    earlyExitTrigger: "NONE" as const,
    exitConfidence: 0,
    exitSummary: `Baslangic TP hedefi %${Number(baseTpPercent.toFixed(2))}; smart exit monitor aktif.`,
  };
}
