import { evaluatePreTradeRisk, type PreTradeRiskInput } from "@/src/server/risk/risk-evaluation.service";

export type CanonicalRiskVerdict = "ALLOW" | "REJECT";

export type CanonicalRiskDecision = {
  verdict: CanonicalRiskVerdict;
  reasonCodes: string[];
  reasons: string[];
  metrics: Record<string, number | string | boolean | null>;
  timestamp: string;
};

export type CanonicalRiskInput = PreTradeRiskInput & {
  lastPrice?: number;
  dataAgeMs?: number;
  dataUnavailable?: boolean;
  syntheticData?: boolean;
  staleDataMaxAgeMs?: number;
};

const REASON_CODE_RULES: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /paused/i, code: "RISK_SYSTEM_PAUSED" },
  { pattern: /spread/i, code: "RISK_SPREAD_TOO_HIGH" },
  { pattern: /liquidity/i, code: "RISK_LOW_LIQUIDITY" },
  { pattern: /daily loss/i, code: "RISK_DAILY_LOSS_LIMIT" },
  { pattern: /weekly loss/i, code: "RISK_WEEKLY_LOSS_LIMIT" },
  { pattern: /max open/i, code: "RISK_MAX_EXPOSURE" },
  { pattern: /api breaker/i, code: "RISK_API_BREAKER" },
  { pattern: /volatil/i, code: "RISK_ABNORMAL_VOLATILITY" },
  { pattern: /stop-loss/i, code: "RISK_STOP_LOSS_REQUIRED" },
  { pattern: /risk per trade/i, code: "RISK_PER_TRADE_EXCEEDED" },
  { pattern: /regime/i, code: "RISK_REGIME_BLOCKED" },
  { pattern: /confidence/i, code: "SIGNAL_LOW_CONFIDENCE" },
  { pattern: /expected profit/i, code: "SIGNAL_LOW_EXPECTED_PROFIT" },
  { pattern: /slippage/i, code: "RISK_SLIPPAGE_TOO_HIGH" },
];

export function mapRiskReasonToCode(reason: string): string {
  const hit = REASON_CODE_RULES.find((rule) => rule.pattern.test(reason));
  return hit?.code ?? "RISK_UNSPECIFIED";
}

export function mapRiskReasonsToCodes(reasons: string[]): string[] {
  return [...new Set(reasons.map(mapRiskReasonToCode))];
}

export async function evaluateCanonicalRiskDecision(input: CanonicalRiskInput): Promise<CanonicalRiskDecision> {
  const timestamp = new Date().toISOString();
  const reasonCodes: string[] = [];
  const reasons: string[] = [];

  if (input.dataUnavailable) {
    reasonCodes.push("RISK_DATA_UNAVAILABLE");
    reasons.push("Real market data unavailable");
  }
  if (input.syntheticData) {
    reasonCodes.push("RISK_SYNTHETIC_DATA");
    reasons.push("Synthetic market data is forbidden on the trading hot-path");
  }
  if (typeof input.lastPrice === "number" && (!Number.isFinite(input.lastPrice) || input.lastPrice <= 0)) {
    reasonCodes.push("RISK_INVALID_PRICE");
    reasons.push("Invalid last price");
  }
  const maxAge = input.staleDataMaxAgeMs ?? 120_000;
  if (typeof input.dataAgeMs === "number" && Number.isFinite(input.dataAgeMs) && input.dataAgeMs > maxAge) {
    reasonCodes.push("RISK_STALE_DATA");
    reasons.push("Market data is stale");
  }

  const preTrade = await evaluatePreTradeRisk(input);
  reasons.push(...preTrade.reasons);
  reasonCodes.push(...mapRiskReasonsToCodes(preTrade.reasons));

  const uniqueCodes = [...new Set(reasonCodes)];
  const uniqueReasons = [...new Set(reasons)];

  return {
    verdict: uniqueCodes.length > 0 ? "REJECT" : "ALLOW",
    reasonCodes: uniqueCodes,
    reasons: uniqueReasons,
    metrics: {
      confidencePercent: input.confidencePercent,
      spreadPercent: input.spreadPercent,
      liquidity24h: input.liquidity24h,
      volatilityPercent: input.volatilityPercent,
      lastPrice: input.lastPrice ?? null,
      dataAgeMs: input.dataAgeMs ?? null,
      paused: preTrade.paused,
    },
    timestamp,
  };
}
