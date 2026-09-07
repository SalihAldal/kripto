import type { KlineItem } from "@/src/types/exchange";

/** Matches analysis-orchestrator stale guard — do not relax without explicit contract change. */
export const AI_KLINE_MIN_COUNT = 20;
export const AI_KLINE_MAX_AGE_SEC = 180;
export const AI_KLINE_DEFAULT_INTERVAL_MS = 60_000;

export type KlineStaleReasonCode =
  | "KLINE_COUNT_INSUFFICIENT"
  | "KLINE_TOO_OLD"
  | "KLINE_TIMESTAMP_INVALID"
  | "KLINE_SOURCE_UNAVAILABLE"
  | "KLINE_REFRESH_FAILED"
  | "KLINE_INTERVAL_MISMATCH";

export type KlineInputAssessment = {
  fresh: boolean;
  reasonCode: KlineStaleReasonCode | null;
  count: number;
  lastOpenTime: number | null;
  lastCloseTime: number | null;
  ageSec: number | null;
  intervalMs: number;
};

export function normalizeKlineCloseTimeMs(closeTime: number): number | null {
  if (!Number.isFinite(closeTime) || closeTime <= 0) return null;
  if (closeTime < 1e12) return closeTime * 1000;
  return closeTime;
}

export function assessKlineInput(input: {
  klines: KlineItem[];
  nowMs: number;
  intervalMs?: number;
}): KlineInputAssessment {
  const intervalMs = input.intervalMs ?? AI_KLINE_DEFAULT_INTERVAL_MS;
  const klines = input.klines ?? [];
  const count = klines.length;
  const last = count > 0 ? klines[count - 1] : null;
  const rawClose = last?.closeTime ?? 0;
  const rawOpen = last?.openTime ?? 0;

  if (rawClose > 0 && rawClose < 1e12 && rawOpen > 0 && rawOpen < 1e12) {
    const normalizedClose = normalizeKlineCloseTimeMs(rawClose)!;
    const ageSec = Math.floor((input.nowMs - normalizedClose) / 1000);
    if (count < AI_KLINE_MIN_COUNT) {
      return {
        fresh: false,
        reasonCode: "KLINE_COUNT_INSUFFICIENT",
        count,
        lastOpenTime: rawOpen * 1000,
        lastCloseTime: normalizedClose,
        ageSec,
        intervalMs,
      };
    }
    if (ageSec > AI_KLINE_MAX_AGE_SEC) {
      return {
        fresh: false,
        reasonCode: "KLINE_TOO_OLD",
        count,
        lastOpenTime: rawOpen * 1000,
        lastCloseTime: normalizedClose,
        ageSec,
        intervalMs,
      };
    }
    return {
      fresh: true,
      reasonCode: null,
      count,
      lastOpenTime: rawOpen * 1000,
      lastCloseTime: normalizedClose,
      ageSec,
      intervalMs,
    };
  }

  const lastCloseTime = normalizeKlineCloseTimeMs(rawClose);
  const lastOpenTime = normalizeKlineCloseTimeMs(rawOpen);
  const ageSec = lastCloseTime ? Math.floor((input.nowMs - lastCloseTime) / 1000) : null;

  if (count < AI_KLINE_MIN_COUNT) {
    return {
      fresh: false,
      reasonCode: "KLINE_COUNT_INSUFFICIENT",
      count,
      lastOpenTime,
      lastCloseTime,
      ageSec,
      intervalMs,
    };
  }

  if (lastCloseTime === null) {
    return {
      fresh: false,
      reasonCode: "KLINE_TIMESTAMP_INVALID",
      count,
      lastOpenTime,
      lastCloseTime,
      ageSec,
      intervalMs,
    };
  }

  if (ageSec !== null && ageSec > AI_KLINE_MAX_AGE_SEC) {
    return {
      fresh: false,
      reasonCode: "KLINE_TOO_OLD",
      count,
      lastOpenTime,
      lastCloseTime,
      ageSec,
      intervalMs,
    };
  }

  return {
    fresh: true,
    reasonCode: null,
    count,
    lastOpenTime,
    lastCloseTime,
    ageSec,
    intervalMs,
  };
}

export function buildKlineStaleMessage(assessment: KlineInputAssessment): string {
  if (assessment.fresh) return "Kline input fresh";
  return `Kline data missing or stale (${assessment.reasonCode ?? "UNKNOWN"}; count=${assessment.count}; ageSec=${assessment.ageSec ?? "n/a"})`;
}
