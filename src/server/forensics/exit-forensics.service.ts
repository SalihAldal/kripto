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
  tpLevel?: number | null;
  slLevel?: number | null;
  strategyExit?: boolean;
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
  SMART_EXIT: "STRATEGY_EXIT",
};

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
}): ExitForensicSnapshot {
  const entryMs = new Date(input.entryTimestamp).getTime();
  const exitMs = new Date(input.exitTimestamp ?? Date.now()).getTime();
  const exitReason = POSITION_MONITOR_REASON_MAP[input.closeReason] ?? "STRATEGY_EXIT";
  const gross =
    input.side === "LONG"
      ? (input.exitPrice - input.entryPrice) * input.quantity
      : (input.entryPrice - input.exitPrice) * input.quantity;
  const fees = Number(input.openFee ?? 0) + Number(input.closeFee ?? 0);

  return {
    exitModel: input.closeReason === "MANUAL_CLOSE" ? "MANUAL_TIMEOUT" : "POSITION_MONITOR",
    exitReason,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    entryTimestamp: new Date(entryMs).toISOString(),
    exitTimestamp: new Date(exitMs).toISOString(),
    durationMs: Math.max(0, exitMs - entryMs),
    tpLevel: input.takeProfitPrice ?? null,
    slLevel: input.stopLossPrice ?? null,
    strategyExit: exitReason === "STRATEGY_EXIT",
    realizedGrossPnL: Number((gross - fees).toFixed(8)),
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
}): ExitForensicSnapshot {
  return {
    exitModel: "REPLAY_WINDOW",
    exitReason: input.exitReason,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    entryTimestamp: new Date(input.entryTimestamp).toISOString(),
    exitTimestamp: new Date(input.exitTimestamp).toISOString(),
    durationMs: Math.max(0, input.exitTimestamp - input.entryTimestamp),
    tpLevel: input.takeProfitPrice,
    slLevel: input.stopLossPrice,
    strategyExit: input.exitReason === "STRATEGY_EXIT",
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
