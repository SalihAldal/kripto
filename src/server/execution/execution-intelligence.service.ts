import { computeActualSlippage, estimateSlippage, validateSlippage } from "@/src/server/execution-engine-v2/slippage-guard.service";
import { scoreExecutionQuality } from "@/src/server/exchange-simulator/execution-quality.service";
import { normalizeMarketRegimeLabel } from "@/src/server/scanner/regime-intelligence.service";

export type ExecutionFillStatus =
  | "FULL_FILL"
  | "PARTIAL_FILL"
  | "CANCELLED"
  | "EXPIRED"
  | "REJECTED"
  | "PENDING";

export type ExecutionTelemetry = {
  executionId: string;
  symbol: string;
  side: "BUY" | "SELL";
  signalTimestamp?: string;
  decisionTimestamp: string;
  orderTimestamp: string;
  exchangeResponseTimestamp?: string;
  fillTimestamp?: string;
  exchangeResponseTimeMs?: number;
  fillTimeMs?: number;
  decisionToOrderMs?: number;
  expectedPrice: number;
  fillPrice: number;
  slippagePct: number;
  spreadPct: number;
  bidDepth?: number;
  askDepth?: number;
  liquidity24h?: number;
  depthCoverage?: number;
  requestedQty: number;
  filledQty: number;
  fillRatio: number;
  fillStatus: ExecutionFillStatus;
  partialFill: boolean;
  cancelled: boolean;
  expired: boolean;
  rejected: boolean;
  retryAttempt?: number;
  retryCount?: number;
  marketRegime?: string;
  orderType: string;
  urgency?: "normal" | "high" | "emergency";
  qualityScore?: number;
  metadata?: Record<string, unknown>;
};

export type ExecutionAggregateKpis = {
  executionCount: number;
  successRate: number;
  rejectionRate: number;
  partialFillRate: number;
  averageSlippagePct: number;
  averageFillTimeMs: number;
  averageLatencyMs: number;
  averageQualityScore: number;
  profitFactor?: number;
  maxDrawdown?: number;
};

export type PreSubmitExecutionDecision = {
  allowed: boolean;
  reason?: string;
  estimatedSlippagePct: number;
  depthCoverage: number;
  spreadPct: number;
};

function round(value: number, decimals = 4) {
  return Number(value.toFixed(decimals));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function classifyFillStatus(input: {
  orderStatus: string;
  requestedQty: number;
  filledQty: number;
}): ExecutionFillStatus {
  const status = String(input.orderStatus ?? "").toUpperCase();
  const requested = Math.max(0, Number(input.requestedQty ?? 0));
  const filled = Math.max(0, Number(input.filledQty ?? 0));
  if (status.includes("REJECT")) return "REJECTED";
  if (status.includes("CANCEL")) return "CANCELLED";
  if (status.includes("EXPIRE")) return "EXPIRED";
  if (filled <= 0) return status.includes("NEW") ? "PENDING" : "REJECTED";
  if (requested > 0 && filled + 1e-8 < requested * 0.995) return "PARTIAL_FILL";
  return "FULL_FILL";
}

export function resolveAdaptiveRetryPolicy(input: {
  errorMessage?: string;
  attempt: number;
  marketRegime?: string;
  urgency?: "normal" | "high" | "emergency";
}) {
  const message = String(input.errorMessage ?? "").toLowerCase();
  const canonical = normalizeMarketRegimeLabel(input.marketRegime ?? "RANGE_SIDEWAYS");
  const volatile =
    canonical === "HIGH_VOLATILITY_CHAOS" ||
    canonical === "NEWS_DRIVEN_UNSTABLE" ||
    message.includes("timeout") ||
    message.includes("429");
  const maxAttempts = input.urgency === "emergency" ? 3 : volatile ? 2 : 2;
  const backoffMs = volatile ? 1200 : message.includes("429") || message.includes("rate") ? 1500 : 900;
  const retryable =
    message.includes("429") ||
    message.includes("timeout") ||
    message.includes("temporarily") ||
    message.includes("econnreset") ||
    message.includes("network") ||
    message.includes("min notional");
  return {
    maxAttempts,
    backoffMs,
    shouldRetry: retryable && input.attempt + 1 < maxAttempts,
  };
}

export function evaluatePreSubmitExecution(input: {
  side: "BUY" | "SELL";
  notional: number;
  bidDepth?: number;
  askDepth?: number;
  spreadPercent?: number;
  liquidity24h?: number;
  liquidityScore?: number;
  orderType?: string;
  urgency?: "normal" | "high" | "emergency";
  marketRegime?: string;
}): PreSubmitExecutionDecision {
  const bidDepth = Number(input.bidDepth ?? 0);
  const askDepth = Number(input.askDepth ?? 0);
  const depth = input.side === "BUY" ? askDepth : bidDepth;
  const spreadPct = Number(input.spreadPercent ?? 0);
  const depthCoverage = depth > 0 ? clamp(input.notional / depth, 0, 10) : 0;
  const impactSlippagePct = depth > 0 ? round((input.notional / depth) * 100) : 100;
  const estimatedSlippagePct = estimateSlippage({
    spreadPercent: spreadPct,
    liquidityScore: input.liquidityScore ?? 60,
    orderType: input.orderType ?? "MARKET",
    urgency: input.urgency ?? "normal",
  });
  const slippageCheck = validateSlippage(Math.max(estimatedSlippagePct, impactSlippagePct));
  const liquidityWeak = depth > 0 && input.notional > depth * 1.5;
  if (depth <= 0) {
    return {
      allowed: false,
      reason: "Order book depth unavailable",
      estimatedSlippagePct,
      depthCoverage,
      spreadPct,
    };
  }
  if (liquidityWeak) {
    return {
      allowed: false,
      reason: "Insufficient order book depth for notional",
      estimatedSlippagePct,
      depthCoverage,
      spreadPct,
    };
  }
  if (impactSlippagePct > 0.35) {
    return {
      allowed: false,
      reason: `Estimated impact slippage ${impactSlippagePct.toFixed(3)}% exceeds 0.35%`,
      estimatedSlippagePct: impactSlippagePct,
      depthCoverage,
      spreadPct,
    };
  }
  if (!slippageCheck.allowed) {
    return {
      allowed: false,
      reason: slippageCheck.reason,
      estimatedSlippagePct,
      depthCoverage,
      spreadPct,
    };
  }
  return { allowed: true, estimatedSlippagePct, depthCoverage, spreadPct };
}

export function buildExecutionTelemetry(input: {
  executionId: string;
  symbol: string;
  side: "BUY" | "SELL";
  signalTimestamp?: string;
  decisionTimestamp: string | number;
  orderTimestamp: string | number;
  exchangeResponseTimestamp?: string | number;
  fillTimestamp?: string | number;
  expectedPrice: number;
  fillPrice: number;
  spreadPercent?: number;
  bidDepth?: number;
  askDepth?: number;
  liquidity24h?: number;
  depthCoverage?: number;
  requestedQty: number;
  filledQty: number;
  orderStatus: string;
  orderType?: string;
  marketRegime?: string;
  urgency?: "normal" | "high" | "emergency";
  retryAttempt?: number;
  retryCount?: number;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}): ExecutionTelemetry {
  const decisionMs = new Date(input.decisionTimestamp).getTime();
  const orderMs = new Date(input.orderTimestamp).getTime();
  const exchangeMs = input.exchangeResponseTimestamp
    ? new Date(input.exchangeResponseTimestamp).getTime()
    : undefined;
  const fillMs = input.fillTimestamp ? new Date(input.fillTimestamp).getTime() : undefined;
  const slippagePct = computeActualSlippage(input.expectedPrice, input.fillPrice, input.side);
  const fillStatus = classifyFillStatus({
    orderStatus: input.orderStatus,
    requestedQty: input.requestedQty,
    filledQty: input.filledQty,
  });
  const fillRatio =
    input.requestedQty > 0 ? round(clamp(input.filledQty / input.requestedQty, 0, 1), 4) : 0;
  const quality = scoreExecutionQuality({
    slippagePct,
    fillRatio,
    spreadPct: Number(input.spreadPercent ?? 0),
    depthCoverage: Number(input.depthCoverage ?? 0),
    latency: {
      networkMs: round((input.latencyMs ?? Math.max(0, (fillMs ?? orderMs) - orderMs)) * 0.35),
      exchangeMs: round((input.latencyMs ?? Math.max(0, (fillMs ?? orderMs) - orderMs)) * 0.45),
      queueMs: round((input.latencyMs ?? 0) * 0.1),
      matchingMs: round((input.latencyMs ?? 0) * 0.1),
      totalMs: round(input.latencyMs ?? Math.max(0, (fillMs ?? orderMs) - orderMs)),
    },
  });
  return {
    executionId: input.executionId,
    symbol: input.symbol,
    side: input.side,
    signalTimestamp: input.signalTimestamp,
    decisionTimestamp: new Date(input.decisionTimestamp).toISOString(),
    orderTimestamp: new Date(input.orderTimestamp).toISOString(),
    exchangeResponseTimestamp: exchangeMs ? new Date(exchangeMs).toISOString() : undefined,
    fillTimestamp: fillMs ? new Date(fillMs).toISOString() : undefined,
    exchangeResponseTimeMs: exchangeMs ? round(exchangeMs - orderMs) : undefined,
    fillTimeMs: fillMs ? round(fillMs - orderMs) : input.latencyMs,
    decisionToOrderMs: round(orderMs - decisionMs),
    expectedPrice: input.expectedPrice,
    fillPrice: input.fillPrice,
    slippagePct,
    spreadPct: round(Number(input.spreadPercent ?? 0)),
    bidDepth: input.bidDepth,
    askDepth: input.askDepth,
    liquidity24h: input.liquidity24h,
    depthCoverage: input.depthCoverage,
    requestedQty: input.requestedQty,
    filledQty: input.filledQty,
    fillRatio,
    fillStatus,
    partialFill: fillStatus === "PARTIAL_FILL",
    cancelled: fillStatus === "CANCELLED",
    expired: fillStatus === "EXPIRED",
    rejected: fillStatus === "REJECTED",
    retryAttempt: input.retryAttempt,
    retryCount: input.retryCount,
    marketRegime: input.marketRegime ? normalizeMarketRegimeLabel(input.marketRegime) : undefined,
    orderType: input.orderType ?? "MARKET",
    urgency: input.urgency,
    qualityScore: quality.overallScore,
    metadata: input.metadata,
  };
}

export function simulateLabExecutionQuality(input: {
  side: "BUY" | "SELL";
  entryPrice: number;
  positionSize: number;
  spreadPercent?: number;
  bidDepth?: number;
  askDepth?: number;
  liquidity24h?: number;
  marketRegime?: string;
  volatilityPercent?: number;
  signalTimestamp?: string;
  decisionTimestamp?: string;
}): ExecutionTelemetry {
  const spreadPct = Number(input.spreadPercent ?? 0.08 + Math.random() * 0.12);
  const depth = input.side === "BUY" ? Number(input.askDepth ?? 0) : Number(input.bidDepth ?? 0);
  const depthCoverage = depth > 0 ? clamp(input.positionSize / depth, 0, 1) : 0.4;
  const regime = normalizeMarketRegimeLabel(input.marketRegime ?? "RANGE_SIDEWAYS");
  const regimeLatencyBoost =
    regime === "HIGH_VOLATILITY_CHAOS" ? 180 : regime === "LOW_VOLUME_DEAD_MARKET" ? 140 : 80;
  const decisionTs = input.decisionTimestamp ?? new Date(Date.now() - 1200).toISOString();
  const orderTs = new Date(new Date(decisionTs).getTime() + 180 + Math.floor(Math.random() * 420)).toISOString();
  const fillTs = new Date(new Date(orderTs).getTime() + regimeLatencyBoost + Math.floor(Math.random() * 260)).toISOString();
  const estimated = estimateSlippage({
    spreadPercent: spreadPct,
    liquidityScore: depthCoverage * 100,
    orderType: "MARKET",
    urgency: "normal",
  });
  const impact = depth > 0 ? round((input.positionSize / depth) * 100, 4) : estimated * 0.5;
  const slippagePct = round(Math.max(estimated, impact * 0.01, spreadPct * 0.05), 4);
  const fillPrice =
    input.side === "BUY"
      ? round(input.entryPrice * (1 + slippagePct / 100), 8)
      : round(input.entryPrice * (1 - slippagePct / 100), 8);
  const qty = input.positionSize / Math.max(input.entryPrice, 1);
  return buildExecutionTelemetry({
    executionId: `sim_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    symbol: "SIM",
    side: input.side,
    signalTimestamp: input.signalTimestamp ?? decisionTs,
    decisionTimestamp: decisionTs,
    orderTimestamp: orderTs,
    exchangeResponseTimestamp: fillTs,
    fillTimestamp: fillTs,
    expectedPrice: input.entryPrice,
    fillPrice,
    spreadPercent: spreadPct,
    bidDepth: input.bidDepth,
    askDepth: input.askDepth,
    liquidity24h: input.liquidity24h,
    depthCoverage,
    requestedQty: qty,
    filledQty: qty,
    orderStatus: "FILLED",
    orderType: "MARKET",
    marketRegime: input.marketRegime,
    metadata: { source: "simulation-lab" },
  });
}

export function aggregateExecutionKpis(
  rows: ExecutionTelemetry[],
  pnlByExecutionId?: Map<string, number>,
): ExecutionAggregateKpis {
  if (!rows.length) {
    return {
      executionCount: 0,
      successRate: 0,
      rejectionRate: 0,
      partialFillRate: 0,
      averageSlippagePct: 0,
      averageFillTimeMs: 0,
      averageLatencyMs: 0,
      averageQualityScore: 0,
    };
  }
  const successes = rows.filter((r) => r.fillStatus === "FULL_FILL" || r.fillStatus === "PARTIAL_FILL");
  const rejections = rows.filter((r) => r.rejected);
  const partials = rows.filter((r) => r.partialFill);
  const avg = (values: number[]) =>
    values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const pnls = pnlByExecutionId
    ? rows.map((r) => pnlByExecutionId.get(r.executionId) ?? 0)
    : [];
  const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0));
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const pnl of pnls) {
    equity += pnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return {
    executionCount: rows.length,
    successRate: round((successes.length / rows.length) * 100, 2),
    rejectionRate: round((rejections.length / rows.length) * 100, 2),
    partialFillRate: round((partials.length / rows.length) * 100, 2),
    averageSlippagePct: avg(rows.map((r) => r.slippagePct)),
    averageFillTimeMs: avg(rows.map((r) => r.fillTimeMs ?? 0)),
    averageLatencyMs: avg(rows.map((r) => r.exchangeResponseTimeMs ?? r.fillTimeMs ?? 0)),
    averageQualityScore: avg(rows.map((r) => r.qualityScore ?? 0)),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : grossProfit > 0 ? 999 : 0,
    maxDrawdown: pnls.length ? round(maxDrawdown, 4) : undefined,
  };
}
