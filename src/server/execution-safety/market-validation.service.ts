import { getExchangeInfo } from "@/services/binance.service";
import { getCircuitSnapshot } from "@/src/server/resilience/circuit-breaker";
import type { PreTradeSafetyInput, SafetyValidationStageResult } from "@/src/server/execution-safety/execution-safety.types";

const exchangeInfoCache = { at: 0, symbols: new Map<string, string>() };

export async function validateMarketSafety(input: PreTradeSafetyInput): Promise<SafetyValidationStageResult> {
  const reasons: string[] = [];
  const symbol = input.symbol.toUpperCase();

  const circuits = getCircuitSnapshot();
  const openCircuits = circuits.filter((row) => row.state === "OPEN");
  if (openCircuits.some((row) => row.key.includes("placeMarket") || row.key.includes("getTicker"))) {
    reasons.push("Exchange circuit breaker active");
  }

  const volatility = input.volatilityPercent ?? 0;
  if (volatility > 12) {
    reasons.push("Extreme volatility — market freeze recommended");
  }

  const now = Date.now();
  if (now - exchangeInfoCache.at > 60_000) {
    const info = await getExchangeInfo().catch(() => null);
    exchangeInfoCache.symbols.clear();
    if (info?.symbols) {
      for (const row of info.symbols) {
        exchangeInfoCache.symbols.set(row.symbol.toUpperCase(), row.status);
      }
      exchangeInfoCache.at = now;
    }
  }

  const status = exchangeInfoCache.symbols.get(symbol);
  if (status && status !== "TRADING") {
    reasons.push(`Symbol status is ${status}`);
  }
  if (exchangeInfoCache.symbols.size > 0 && !status) {
    reasons.push("Symbol not found in exchange info");
  }

  return {
    stage: "MARKET",
    passed: reasons.length === 0,
    reasons,
    metadata: {
      symbolStatus: status ?? "UNKNOWN",
      openCircuitCount: openCircuits.length,
      volatility,
    },
  };
}
