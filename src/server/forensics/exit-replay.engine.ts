import type { ExitReasonCode } from "@/src/server/forensics/forensic.types";
import { resolveReplayWindowEndTimestamp } from "@/src/server/forensics/exit-forensics.service";

export type ReplayCandle = {
  timestamp: number;
  high: number;
  low: number;
  close: number;
};

export type ExitReplayInput = {
  side: "LONG" | "SHORT";
  entryPrice: number;
  entryTimestamp: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  candles: ReplayCandle[];
  endTimestamp?: number;
  maxHoldMs?: number;
  lastCandleTimestamp?: number;
  sameCandlePrecedence?: "STOP_LOSS" | "TAKE_PROFIT";
};

export type ExitReplayResult = {
  exitReason: ExitReasonCode;
  exitPrice: number;
  exitTimestamp: number;
  lookAheadUsed: false;
  exitModel: "REPLAY_WINDOW";
  replayWindowEnded: boolean;
  tpLevel: number;
  slLevel: number;
  durationMs: number;
};

function crossedLongTp(candle: ReplayCandle, tp: number) {
  return candle.high >= tp;
}

function crossedLongSl(candle: ReplayCandle, sl: number) {
  return candle.low <= sl;
}

function crossedShortTp(candle: ReplayCandle, tp: number) {
  return candle.low <= tp;
}

function crossedShortSl(candle: ReplayCandle, sl: number) {
  return candle.high >= sl;
}

export function replayExitFromCandles(input: ExitReplayInput): ExitReplayResult | null {
  const precedence = input.sameCandlePrecedence ?? "STOP_LOSS";
  const lastCandleTimestamp =
    input.lastCandleTimestamp ?? input.candles[input.candles.length - 1]?.timestamp;
  const resolvedWindowEnd =
    input.maxHoldMs !== undefined
      ? resolveReplayWindowEndTimestamp({
          entryTimestamp: input.entryTimestamp,
          maxHoldMs: input.maxHoldMs,
          lastCandleTimestamp,
        })
      : undefined;
  const effectiveEndTimestamp = resolvedWindowEnd ?? input.endTimestamp;
  const eligible = input.candles
    .filter((c) => c.timestamp > input.entryTimestamp)
    .filter((c) => (effectiveEndTimestamp ? c.timestamp <= effectiveEndTimestamp : true))
    .sort((a, b) => a.timestamp - b.timestamp);

  for (const candle of eligible) {
    const tpHit =
      input.side === "LONG"
        ? crossedLongTp(candle, input.takeProfitPrice)
        : crossedShortTp(candle, input.takeProfitPrice);
    const slHit =
      input.side === "LONG"
        ? crossedLongSl(candle, input.stopLossPrice)
        : crossedShortSl(candle, input.stopLossPrice);

    if (tpHit && slHit) {
      if (precedence === "STOP_LOSS") {
        return {
          exitReason: "STOP_LOSS",
          exitPrice: input.stopLossPrice,
          exitTimestamp: candle.timestamp,
          lookAheadUsed: false,
          exitModel: "REPLAY_WINDOW",
          replayWindowEnded: false,
          tpLevel: input.takeProfitPrice,
          slLevel: input.stopLossPrice,
          durationMs: Math.max(0, candle.timestamp - input.entryTimestamp),
        };
      }
      return {
        exitReason: "TAKE_PROFIT",
        exitPrice: input.takeProfitPrice,
        exitTimestamp: candle.timestamp,
        lookAheadUsed: false,
        exitModel: "REPLAY_WINDOW",
        replayWindowEnded: false,
        tpLevel: input.takeProfitPrice,
        slLevel: input.stopLossPrice,
        durationMs: Math.max(0, candle.timestamp - input.entryTimestamp),
      };
    }
    if (slHit) {
      return {
        exitReason: "STOP_LOSS",
        exitPrice: input.stopLossPrice,
        exitTimestamp: candle.timestamp,
        lookAheadUsed: false,
        exitModel: "REPLAY_WINDOW",
        replayWindowEnded: false,
        tpLevel: input.takeProfitPrice,
        slLevel: input.stopLossPrice,
        durationMs: Math.max(0, candle.timestamp - input.entryTimestamp),
      };
    }
    if (tpHit) {
      return {
        exitReason: "TAKE_PROFIT",
        exitPrice: input.takeProfitPrice,
        exitTimestamp: candle.timestamp,
        lookAheadUsed: false,
        exitModel: "REPLAY_WINDOW",
        replayWindowEnded: false,
        tpLevel: input.takeProfitPrice,
        slLevel: input.stopLossPrice,
        durationMs: Math.max(0, candle.timestamp - input.entryTimestamp),
      };
    }
  }

  if (effectiveEndTimestamp) {
    const last = eligible[eligible.length - 1];
    const timeExit =
      input.maxHoldMs !== undefined
        ? classifyTimeExit({
            entryTimestamp: input.entryTimestamp,
            nowTimestamp: effectiveEndTimestamp,
            maxHoldMs: input.maxHoldMs,
          })
        : null;
    return {
      exitReason: timeExit ?? "END_OF_REPLAY",
      exitPrice: last?.close ?? input.entryPrice,
      exitTimestamp: effectiveEndTimestamp,
      lookAheadUsed: false,
      exitModel: "REPLAY_WINDOW",
      replayWindowEnded: timeExit === null,
      tpLevel: input.takeProfitPrice,
      slLevel: input.stopLossPrice,
      durationMs: Math.max(0, effectiveEndTimestamp - input.entryTimestamp),
    };
  }
  return null;
}

export function classifyTimeExit(input: {
  entryTimestamp: number;
  nowTimestamp: number;
  maxHoldMs: number;
}) {
  if (input.nowTimestamp - input.entryTimestamp >= input.maxHoldMs) {
    return "TIME_EXIT" as const;
  }
  return null;
}
