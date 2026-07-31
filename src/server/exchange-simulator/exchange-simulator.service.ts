import { getOrderBook, getTicker } from "@/services/binance.service";
import { validateSimulationFilters } from "@/src/server/exchange-simulator/exchange-filter-engine";
import { calculateFillsFees, totalFeesFromFills } from "@/src/server/exchange-simulator/fee-simulator.service";
import {
  buildExecutionComparison,
  buildSlippageBreakdown,
  scoreExecutionQuality,
} from "@/src/server/exchange-simulator/execution-quality.service";
import { applyLatencyDelay, simulateLatency } from "@/src/server/exchange-simulator/latency-simulator";
import { averageFillPrice, newSimulationOrderId, splitIntoPartialFills } from "@/src/server/exchange-simulator/partial-fill-engine";
import {
  applyFallbackSlippage,
  buildSyntheticLevels,
  computeDynamicSlippageBps,
  computeSlippagePct,
  computeSpreadPct,
  walkOrderBook,
} from "@/src/server/exchange-simulator/slippage-engine";
import type { MarketSimulationInput, MarketSimulationResult } from "@/src/server/exchange-simulator/exchange-simulator.types";
import { ACTIVE_ORDER_TYPE, DEFAULT_EXCHANGE } from "@/src/server/exchange-simulator/exchange-simulator.types";
import { persistExecutionSimulation } from "@/src/server/exchange-simulator/exchange-simulator.repository";

function round8(value: number) {
  return Number(value.toFixed(8));
}

export async function simulateMarketExecution(input: MarketSimulationInput): Promise<MarketSimulationResult> {
  const startedAt = Date.now();
  const latency = simulateLatency();
  const orderType = input.orderType ?? ACTIVE_ORDER_TYPE;
  if (orderType !== "MARKET") {
    return rejectSimulation(input, "Only MARKET orders are active", startedAt, latency);
  }

  const ticker = await getTicker(input.symbol).catch(() => null);
  const referencePrice =
    input.priceHint > 0
      ? input.priceHint
      : Number(ticker?.price ?? 0);
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) {
    return rejectSimulation(input, "Reference price unavailable", startedAt, latency);
  }

  let targetQty = input.quantity;
  if (input.quoteOrderQty && input.quoteOrderQty > 0 && input.side === "BUY") {
    targetQty = input.quoteOrderQty / referencePrice;
  }
  targetQty = round8(Math.max(0, targetQty));
  if (targetQty <= 0) {
    return rejectSimulation(input, "Invalid quantity", startedAt, latency);
  }

  const filterCheck = await validateSimulationFilters({ ...input, quantity: targetQty }, referencePrice);
  if (!filterCheck.ok) {
    return rejectSimulation(input, filterCheck.rejectReason, startedAt, latency);
  }
  targetQty = filterCheck.filter.adjustedQuantity;

  const orderBook = await getOrderBook(input.symbol, 50).catch(() => ({ bids: [], asks: [] }));
  const bestBid = orderBook.bids[0]?.price ?? referencePrice * 0.9995;
  const bestAsk = orderBook.asks[0]?.price ?? referencePrice * 1.0005;
  const spreadPct = input.spreadPercent ?? computeSpreadPct(bestBid, bestAsk);
  const slippageBps = computeDynamicSlippageBps({
    side: input.side,
    referencePrice,
    quantity: targetQty,
    spreadPercent: spreadPct,
    bidDepth: input.bidDepth,
    askDepth: input.askDepth,
    atr: input.atr,
    volatilityPercent: input.volatilityPercent,
    volumeQuote: input.volumeQuote,
    aggressiveBuyPct: input.aggressiveBuyPct,
    aggressiveSellPct: input.aggressiveSellPct,
  });

  const levels =
    input.side === "BUY"
      ? orderBook.asks.length > 0
        ? orderBook.asks
        : buildSyntheticLevels(referencePrice, "BUY", targetQty)
      : orderBook.bids.length > 0
        ? orderBook.bids
        : buildSyntheticLevels(referencePrice, "SELL", targetQty);

  let walk = walkOrderBook({
    side: input.side,
    quantity: targetQty,
    levels,
    referencePrice: input.side === "BUY" ? bestAsk : bestBid,
    impactSlippageBpsPerLevel: slippageBps,
  });

  if (walk.executedQty <= 0) {
    const fallbackPrice = applyFallbackSlippage(referencePrice, input.side, slippageBps);
    walk = {
      fills: [{ quantity: targetQty, price: fallbackPrice }],
      executedQty: targetQty,
      remainingQty: 0,
      avgFillPrice: fallbackPrice,
      bestPrice: referencePrice,
      worstPrice: fallbackPrice,
    };
  }

  await applyLatencyDelay(latency);
  const actualDelayMs = Date.now() - startedAt;

  const partialFills = splitIntoPartialFills({
    side: input.side,
    fills: walk.fills,
    referencePrice,
    startTimeMs: startedAt,
    latencyPerFillMs: Math.max(8, Math.floor(latency.matchingMs / Math.max(1, walk.fills.length))),
  });
  const feeFills = calculateFillsFees(walk.fills, "TAKER").map((fill, index) => ({
    ...fill,
    slippagePct: partialFills[index]?.slippagePct ?? computeSlippagePct(referencePrice, fill.price, input.side),
    filledAt: partialFills[index]?.filledAt ?? new Date().toISOString(),
  }));
  const totalFees = totalFeesFromFills(feeFills);
  const avgFillPrice = averageFillPrice(feeFills);
  const fillRatio = targetQty > 0 ? walk.executedQty / targetQty : 0;
  const depth = input.side === "BUY" ? input.askDepth ?? 0 : input.bidDepth ?? 0;
  const depthCoverage = depth > 0 ? Math.min(1, (avgFillPrice * walk.executedQty) / depth) : 0.75;

  const slippage = buildSlippageBreakdown({
    referencePrice,
    avgFillPrice,
    bestPrice: walk.bestPrice,
    worstPrice: walk.worstPrice,
    spreadPct,
    side: input.side,
  });
  const quality = scoreExecutionQuality({
    slippagePct: slippage.slippagePct,
    fillRatio,
    spreadPct,
    depthCoverage,
    latency,
  });
  const comparison = buildExecutionComparison({
    requestedPrice: referencePrice,
    executedPrice: avgFillPrice,
    bestPossiblePrice: walk.bestPrice,
    worstPossiblePrice: walk.worstPrice,
    fees: totalFees,
    executionTimeMs: actualDelayMs,
    side: input.side,
  });

  const simulationId = newSimulationOrderId("simulation");
  const orderId = newSimulationOrderId("paper");
  const status = walk.remainingQty > 0 ? "PARTIALLY_FILLED" : "FILLED";

  const result: MarketSimulationResult = {
    ok: true,
    simulationId,
    orderId,
    symbol: input.symbol.toUpperCase(),
    side: input.side,
    orderType: "MARKET",
    requestedQty: targetQty,
    executedQty: walk.executedQty,
    remainingQty: walk.remainingQty,
    requestedPrice: referencePrice,
    avgFillPrice,
    fillCount: feeFills.length,
    fills: feeFills,
    totalFees,
    totalSlippagePct: slippage.slippagePct,
    executionDurationMs: actualDelayMs,
    latency,
    quality,
    slippage,
    comparison,
    status,
    metadata: {
      exchange: input.exchange ?? DEFAULT_EXCHANGE,
      slippageBps,
      spreadPct,
      depthCoverage,
      quoteOrderQty: input.quoteOrderQty,
    },
  };

  await persistExecutionSimulation({
    executionId: input.executionId,
    userId: input.userId,
    result,
  }).catch(() => null);

  return result;
}

function rejectSimulation(
  input: MarketSimulationInput,
  rejectReason: string,
  startedAt: number,
  latency: ReturnType<typeof simulateLatency>,
): MarketSimulationResult {
  const simulationId = newSimulationOrderId("simulation-reject");
  return {
    ok: false,
    rejectReason,
    simulationId,
    orderId: newSimulationOrderId("paper-reject"),
    symbol: input.symbol.toUpperCase(),
    side: input.side,
    orderType: "MARKET",
    requestedQty: input.quantity,
    executedQty: 0,
    remainingQty: input.quantity,
    requestedPrice: input.priceHint,
    avgFillPrice: 0,
    fillCount: 0,
    fills: [],
    totalFees: 0,
    totalSlippagePct: 0,
    executionDurationMs: Date.now() - startedAt,
    latency,
    quality: {
      overallScore: 0,
      slippageScore: 0,
      liquidityScore: 0,
      spreadScore: 0,
      fillScore: 0,
      latencyScore: 0,
    },
    slippage: {
      slippagePct: 0,
      slippageBps: 0,
      bestPrice: input.priceHint,
      worstPrice: input.priceHint,
      midPrice: input.priceHint,
      spreadPct: 0,
      impactPct: 0,
    },
    comparison: {
      requestedPrice: input.priceHint,
      executedPrice: 0,
      bestPossiblePrice: input.priceHint,
      worstPossiblePrice: input.priceHint,
      slippagePct: 0,
      fees: 0,
      executionTimeMs: Date.now() - startedAt,
      improvementBps: 0,
    },
    status: "REJECTED",
    metadata: { rejectReason },
  };
}

export async function replaySimulationComparison(simulationId: string) {
  const { getSimulationById } = await import("@/src/server/exchange-simulator/exchange-simulator.repository");
  const row = await getSimulationById(simulationId);
  if (!row?.comparison) return null;
  return row.comparison;
}

// Future-ready stubs — inactive order types
export async function simulateLimitExecution(_input: MarketSimulationInput) {
  throw new Error("LIMIT orders are not active");
}

export async function simulateStopLimitExecution(_input: MarketSimulationInput) {
  throw new Error("STOP_LIMIT orders are not active");
}

export async function simulateStopMarketExecution(_input: MarketSimulationInput) {
  throw new Error("STOP_MARKET orders are not active");
}
