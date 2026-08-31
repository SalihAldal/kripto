import type { ExitReasonCode } from "@/src/server/forensics/forensic.types";
import type { PositionCloseReason } from "@/src/server/execution/types";

export type ExitModelKind = "POSITION_MONITOR" | "REPLAY_WINDOW" | "MANUAL_TIMEOUT";

export type ExitForensicSnapshot = {
  exitModel: ExitModelKind;
  exitReason: ExitReasonCode;
  entryPrice: number;
  exitPrice: number;
  entryTimestamp: string;
  exitTimestamp: string;
  durationMs: number;
  holdDurationMs?: number;
  tpLevel?: number | null;
  slLevel?: number | null;
  strategyExit?: boolean;
  strategyExitReason?: string | null;
  timeExitReason?: string | null;
  normalizedCloseReason?: string | null;
  closeReasonAlias?: string | null;
  priceAtMonitorTick?: number | null;
  decisionTimestamp?: string | null;
  monitorPrecedenceRule?: string;
  replayPrecedenceRule?: "STOP_LOSS" | "TAKE_PROFIT";
  realizedGrossPnL?: number;
  closeReason?: PositionCloseReason | string | null;
  replayWindowEnded?: boolean;
};

const POSITION_MONITOR_REASON_MAP: Partial<Record<PositionCloseReason, ExitReasonCode>> = {
  TAKE_PROFIT: "TAKE_PROFIT",
  STOP_LOSS: "STOP_LOSS",
  TIMEOUT: "TIME_EXIT",
  MANUAL_CLOSE: "TIME_EXIT",
  MOMENTUM_FADE: "STRATEGY_EXIT",
  REVERSE_SIGNAL: "STRATEGY_EXIT",
  EARLY_PROFIT_PROTECT: "STRATEGY_EXIT",
  TRAILING_PROFIT_LOCK: "STRATEGY_EXIT",
};

function normalizeTimeoutReason(reason: PositionCloseReason) {
  if (reason === "TIMEOUT" || reason === "MANUAL_CLOSE") {
    return {
      normalizedCloseReason: "SYSTEM_TIMEOUT",
      closeReasonAlias: reason === "MANUAL_CLOSE" ? "MANUAL_TIMEOUT_COMPAT_ALIAS" : null,
    };
  }
  return {
    normalizedCloseReason: reason,
    closeReasonAlias: null,
  };
}

export function mapPositionMonitorExit(input: {
  closeReason: PositionCloseReason;
  entryPrice: number;
  exitPrice: number;
  entryTimestamp: string | Date;
  exitTimestamp?: string | Date;
  takeProfitPrice?: number | null;
  stopLossPrice?: number | null;
  side: "LONG" | "SHORT";
  quantity: number;
  openFee?: number;
  closeFee?: number;
  decisionTimestamp?: string | Date;
  priceAtMonitorTick?: number;
}): ExitForensicSnapshot {
  const entryMs = new Date(input.entryTimestamp).getTime();
  const exitMs = new Date(input.exitTimestamp ?? Date.now()).getTime();
  const exitReason = POSITION_MONITOR_REASON_MAP[input.closeReason] ?? "STRATEGY_EXIT";
  const gross =
    input.side === "LONG"
      ? (input.exitPrice - input.entryPrice) * input.quantity
      : (input.entryPrice - input.exitPrice) * input.quantity;
  const timeoutNorm = normalizeTimeoutReason(input.closeReason);

  return {
    exitModel: input.closeReason === "MANUAL_CLOSE" ? "MANUAL_TIMEOUT" : "POSITION_MONITOR",
    exitReason,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    entryTimestamp: new Date(entryMs).toISOString(),
    exitTimestamp: new Date(exitMs).toISOString(),
    durationMs: Math.max(0, exitMs - entryMs),
    holdDurationMs: Math.max(0, exitMs - entryMs),
    tpLevel: input.takeProfitPrice ?? null,
    slLevel: input.stopLossPrice ?? null,
    strategyExit: exitReason === "STRATEGY_EXIT",
    strategyExitReason: exitReason === "STRATEGY_EXIT" ? input.closeReason : null,
    timeExitReason: exitReason === "TIME_EXIT" ? "SYSTEM_TIMEOUT" : null,
    normalizedCloseReason: timeoutNorm.normalizedCloseReason,
    closeReasonAlias: timeoutNorm.closeReasonAlias,
    priceAtMonitorTick: Number.isFinite(Number(input.priceAtMonitorTick)) ? Number(input.priceAtMonitorTick) : null,
    decisionTimestamp: input.decisionTimestamp ? new Date(input.decisionTimestamp).toISOString() : null,
    monitorPrecedenceRule: "POSITION_MONITOR_EVAL_ORDER_V1",
    realizedGrossPnL: Number(gross.toFixed(8)),
    closeReason: input.closeReason,
    replayWindowEnded: false,
  };
}

export function mapReplayWindowExit(input: {
  exitReason: ExitReasonCode;
  entryPrice: number;
  exitPrice: number;
  entryTimestamp: number;
  exitTimestamp: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  replayWindowEnded: boolean;
  replayPrecedenceRule?: "STOP_LOSS" | "TAKE_PROFIT";
}): ExitForensicSnapshot {
  return {
    exitModel: "REPLAY_WINDOW",
    exitReason: input.exitReason,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    entryTimestamp: new Date(input.entryTimestamp).toISOString(),
    exitTimestamp: new Date(input.exitTimestamp).toISOString(),
    durationMs: Math.max(0, input.exitTimestamp - input.entryTimestamp),
    holdDurationMs: Math.max(0, input.exitTimestamp - input.entryTimestamp),
    tpLevel: input.takeProfitPrice,
    slLevel: input.stopLossPrice,
    strategyExit: input.exitReason === "STRATEGY_EXIT",
    strategyExitReason: input.exitReason === "STRATEGY_EXIT" ? "REPLAY_CLASSIFIED_STRATEGY_EXIT" : null,
    timeExitReason: input.exitReason === "TIME_EXIT" ? "REPLAY_MAX_HOLD_EXCEEDED" : null,
    replayPrecedenceRule: input.replayPrecedenceRule ?? "STOP_LOSS",
    replayWindowEnded: input.replayWindowEnded,
    closeReason: input.exitReason,
  };
}

export function resolveReplayWindowEndTimestamp(input: {
  entryTimestamp: number;
  maxHoldMs: number;
  lastCandleTimestamp?: number;
}) {
  const windowEnd = input.entryTimestamp + Math.max(30_000, input.maxHoldMs);
  if (input.lastCandleTimestamp && input.lastCandleTimestamp > input.entryTimestamp) {
    return Math.max(windowEnd, input.lastCandleTimestamp);
  }
  return windowEnd;
}
