import type { HealthCheckResult } from "@/src/server/discovery/discovery.types";
import type { MarketContext } from "@/src/types/scanner";

const HARD_REJECT_REASONS = new Set([
  "EXCHANGE_OFFLINE",
  "TRADING_HALTED",
  "BROKEN_SYMBOL",
  "MAINTENANCE",
  "MISSING_CANDLES",
  "CORRUPTED_DATA",
  "INVALID_SYMBOL",
  "Market data degraded",
]);

function normalizeReason(reason: string) {
  return reason.trim().toUpperCase().replace(/\s+/g, "_");
}

export function evaluateMarketHealth(input: {
  symbol: string;
  context?: MarketContext | null;
  exchangeOnline?: boolean;
}): HealthCheckResult {
  const { symbol, context } = input;
  const exchangeOnline = input.exchangeOnline ?? true;

  if (!exchangeOnline) {
    return {
      symbol,
      healthy: false,
      rejectReason: "EXCHANGE_OFFLINE",
      exchangeOnline: false,
      candlesOk: false,
      dataQualityScore: 0,
    };
  }

  if (!context) {
    return {
      symbol,
      healthy: false,
      rejectReason: "MISSING_CANDLES",
      exchangeOnline: true,
      candlesOk: false,
      dataQualityScore: 0,
    };
  }

  const reasons = context.rejectReasons ?? [];
  const hardReject = reasons.find((reason) => {
    const normalized = normalizeReason(reason);
    return (
      HARD_REJECT_REASONS.has(reason) ||
      HARD_REJECT_REASONS.has(normalized) ||
      normalized.includes("MAINTENANCE") ||
      normalized.includes("HALTED") ||
      normalized.includes("INVALID")
    );
  });

  const lastPrice = context.lastPrice ?? 0;
  const candlesOk = lastPrice > 0 && Number.isFinite(lastPrice);
  const corrupted = !candlesOk || !Number.isFinite(context.volume24h);

  if (hardReject) {
    return {
      symbol,
      healthy: false,
      rejectReason: normalizeReason(hardReject),
      exchangeOnline: true,
      candlesOk,
      dataQualityScore: 0,
      metadata: { rejectReasons: reasons },
    };
  }

  if (corrupted) {
    return {
      symbol,
      healthy: false,
      rejectReason: "CORRUPTED_DATA",
      exchangeOnline: true,
      candlesOk: false,
      dataQualityScore: 0,
      metadata: { rejectReasons: reasons },
    };
  }

  let dataQualityScore = 100;
  if (context.spreadPercent > 0.5) dataQualityScore -= 10;
  if (context.volume24h <= 0) dataQualityScore -= 30;
  if (reasons.length > 0) dataQualityScore -= Math.min(25, reasons.length * 5);

  return {
    symbol,
    healthy: true,
    exchangeOnline: true,
    candlesOk: true,
    dataQualityScore: Math.max(0, Math.min(100, dataQualityScore)),
    metadata: { softReasons: reasons },
  };
}

export function filterHealthyOnly<T extends { symbol: string; context?: MarketContext | null }>(
  rows: T[],
  exchangeOnline = true,
): Array<T & { health: HealthCheckResult }> {
  return rows
    .map((row) => ({
      ...row,
      health: evaluateMarketHealth({ symbol: row.symbol, context: row.context, exchangeOnline }),
    }))
    .filter((row) => row.health.healthy);
}
