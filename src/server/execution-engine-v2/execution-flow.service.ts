import { env } from "@/lib/config";
import {
  placeMarketBuy,
  placeMarketBuyByQuote,
  placeMarketSell,
  getTicker,
} from "@/services/binance.service";
import { simulatePaperExecution } from "@/src/server/execution-management/paper-execution-simulator.service";
import { resolveUnifiedExecutionPlan } from "@/src/server/execution-management/unified-execution-pipeline.service";
import { runPreTradeSafetyValidation } from "@/src/server/execution-safety/pre-trade-validator.service";
import { validateBinanceSpotOrder } from "@/src/server/execution-engine-v2/binance-validation.service";
import { selectSafestOrderType } from "@/src/server/execution-engine-v2/order-type.selector.service";
import { estimateSlippage, validateSlippage, computeActualSlippage } from "@/src/server/execution-engine-v2/slippage-guard.service";
import {
  buildIdempotencyKey,
  checkIdempotency,
  registerIdempotency,
} from "@/src/server/execution-engine-v2/idempotency.service";
import { persistExecutionLog, updateExecutionLogVerified } from "@/src/server/execution-engine-v2/execution-engine-v2.repository";
import type { ExecutionFlowResult } from "@/src/server/execution-engine-v2/execution-engine-v2.types";
import { emitExecutionEngineV2Event, EXECUTION_ENGINE_V2_EVENT } from "@/src/server/execution-engine-v2/execution-engine-v2.events";
import { enqueueExecutionReplayForLog } from "@/src/server/execution-engine-v2/replay-bridge.service";

function parseSymbolAssets(symbol: string) {
  const upper = symbol.toUpperCase();
  if (upper.endsWith("USDT")) return { quoteAsset: "USDT", baseAsset: upper.replace("USDT", "") };
  if (upper.endsWith("TRY")) return { quoteAsset: "TRY", baseAsset: upper.replace("TRY", "") };
  return { quoteAsset: "USDT", baseAsset: upper.slice(0, -4) };
}

export async function executeApprovedSpotOrder(input: {
  executionId: string;
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  mode?: "paper" | "live" | "dry-run";
  riskApproved: boolean;
  urgency?: "normal" | "high" | "emergency";
  entryAnalysisId?: string;
  exitAnalysisId?: string;
  openPositionCount?: number;
  spreadPercent?: number;
  liquidityScore?: number;
}): Promise<ExecutionFlowResult> {
  const startedAt = Date.now();
  if (!input.riskApproved) {
    return {
      executionId: input.executionId,
      logKey: "",
      status: "REJECTED",
      filledQuantity: 0,
      averageFillPrice: 0,
      fee: 0,
      slippagePct: 0,
      latencyMs: Date.now() - startedAt,
      orderType: "MARKET",
      rejected: true,
      rejectReason: "Risk approval required",
    };
  }

  const mode = input.mode ?? (env.EXECUTION_MODE === "live" ? "live" : "paper");
  const idempotencyKey = buildIdempotencyKey({ userId: input.userId, symbol: input.symbol, side: input.side });
  const dup = await checkIdempotency(idempotencyKey);
  if (dup.duplicate) {
    return {
      executionId: dup.executionId ?? input.executionId,
      logKey: dup.logKey ?? "",
      status: "REJECTED",
      filledQuantity: 0,
      averageFillPrice: 0,
      fee: 0,
      slippagePct: 0,
      latencyMs: Date.now() - startedAt,
      orderType: "MARKET",
      rejected: true,
      rejectReason: "Duplicate order blocked by idempotency",
    };
  }

  const ticker = await getTicker(input.symbol).catch(() => null);
  const price = Number(ticker?.price ?? 0);
  if (price <= 0) throw new Error(`No price for ${input.symbol}`);

  const spread = input.spreadPercent ?? 0.1;
  const liquidity = input.liquidityScore ?? 60;
  const orderType = selectSafestOrderType({
    spreadPercent: spread,
    liquidityScore: liquidity,
    urgency: input.urgency ?? "normal",
    side: input.side,
  });

  const expectedSlippage = estimateSlippage({ spreadPercent: spread, liquidityScore: liquidity, orderType, urgency: input.urgency ?? "normal" });
  const slippageCheck = validateSlippage(expectedSlippage);
  if (!slippageCheck.allowed) {
    return {
      executionId: input.executionId,
      logKey: "",
      status: "REJECTED",
      filledQuantity: 0,
      averageFillPrice: 0,
      fee: 0,
      slippagePct: expectedSlippage,
      latencyMs: Date.now() - startedAt,
      orderType,
      rejected: true,
      rejectReason: slippageCheck.reason,
    };
  }

  const { quoteAsset, baseAsset } = parseSymbolAssets(input.symbol);
  const plan = await resolveUnifiedExecutionPlan({
    userId: input.userId,
    executionId: input.executionId,
    symbol: input.symbol,
    side: input.side,
    mode: mode === "live" ? "live" : "paper",
    estimatedEntryPrice: price,
    quoteAsset,
    baseAsset,
    openPositionCount: input.openPositionCount ?? 0,
    allowMultipleOpenPositions: !env.EXECUTION_BLOCK_WHEN_OPEN_POSITION,
  });

  if (!plan.ok) {
    return {
      executionId: input.executionId,
      logKey: "",
      status: "REJECTED",
      filledQuantity: 0,
      averageFillPrice: 0,
      fee: 0,
      slippagePct: 0,
      latencyMs: Date.now() - startedAt,
      orderType,
      rejected: true,
      rejectReason: plan.rejectReason ?? "Sizing failed",
    };
  }

  const binanceValidation = await validateBinanceSpotOrder({
    symbol: input.symbol,
    side: input.side,
    quantity: input.side === "SELL" ? plan.quantity : undefined,
    quoteOrderQty: input.side === "BUY" ? plan.quoteSpend : undefined,
    price,
  });

  if (!binanceValidation.ok) {
    return {
      executionId: input.executionId,
      logKey: "",
      status: "REJECTED",
      filledQuantity: 0,
      averageFillPrice: 0,
      fee: 0,
      slippagePct: 0,
      latencyMs: Date.now() - startedAt,
      orderType,
      rejected: true,
      rejectReason: binanceValidation.rejectReasons.join("; "),
    };
  }

  if (mode === "live") {
    const safety = await runPreTradeSafetyValidation({
      userId: input.userId,
      executionId: input.executionId,
      symbol: input.symbol,
      side: input.side,
      quantity: binanceValidation.quantity,
      priceHint: price,
      quoteAsset,
      baseAsset,
      quoteSpend: input.side === "BUY" ? plan.quoteSpend : undefined,
      openPositionCount: input.openPositionCount ?? 0,
      allowMultipleOpenPositions: !env.EXECUTION_BLOCK_WHEN_OPEN_POSITION,
      mode: "live",
      spreadPercent: spread,
    });
    if (!safety.passed) {
      return {
        executionId: input.executionId,
        logKey: "",
        status: "REJECTED",
        filledQuantity: 0,
        averageFillPrice: 0,
        fee: 0,
        slippagePct: 0,
        latencyMs: Date.now() - startedAt,
        orderType,
        rejected: true,
        rejectReason: safety.rejectReason ?? "Safety validation failed",
      };
    }
  }

  const log = await persistExecutionLog({
    executionId: input.executionId,
    userId: input.userId,
    symbol: input.symbol,
    side: input.side,
    orderType,
    mode,
    quantity: binanceValidation.quantity,
    quoteSpend: plan.quoteSpend,
    requestedPrice: price,
    status: "SUBMITTED",
    idempotencyKey,
    entryAnalysisId: input.entryAnalysisId,
    exitAnalysisId: input.exitAnalysisId,
    riskApproved: true,
    metadata: { expectedSlippage, filters: binanceValidation.filters },
  });

  registerIdempotency(idempotencyKey, input.executionId);

  let filledQty = 0;
  let fillPrice = price;
  let fee = 0;
  let exchangeResponse: Record<string, unknown> | undefined;

  try {
    if (mode === "paper" || mode === "dry-run") {
      const paper = await simulatePaperExecution({
        userId: input.userId,
        executionId: input.executionId,
        symbol: input.symbol,
        side: input.side,
        estimatedPrice: price,
        quoteAsset,
        baseAsset,
        openPositionCount: input.openPositionCount ?? 0,
        allowMultipleOpenPositions: !env.EXECUTION_BLOCK_WHEN_OPEN_POSITION,
        quoteOrderQty: input.side === "BUY" ? plan.quoteSpend : undefined,
        requestedQuantity: input.side === "SELL" ? binanceValidation.quantity : undefined,
        spreadPercent: spread,
      });
      filledQty = paper.quantity;
      fillPrice = paper.fillPrice;
      fee = paper.fee;
    } else {
      const placed =
        input.side === "BUY"
          ? plan.quoteSpend && plan.quoteSpend > 0
            ? await placeMarketBuyByQuote(input.symbol, plan.quoteSpend, false)
            : await placeMarketBuy(input.symbol, binanceValidation.quantity, false)
          : await placeMarketSell(input.symbol, binanceValidation.quantity, false);
      filledQty = Number(placed.executedQty ?? binanceValidation.quantity);
      fillPrice = Number(placed.price ?? price);
      fee = Number(placed.metadata?.fee ?? 0);
      exchangeResponse = placed as unknown as Record<string, unknown>;
    }
  } catch (error) {
    await updateExecutionLogVerified(log.logKey, { status: "FAILED", metadata: { error: (error as Error).message } });
    throw error;
  }

  const slippagePct = computeActualSlippage(price, fillPrice, input.side);
  const latencyMs = Date.now() - startedAt;

  await updateExecutionLogVerified(log.logKey, {
    status: "VERIFIED",
    averageFillPrice: fillPrice,
    filledQuantity: filledQty,
    fee,
    slippagePct,
    metadata: { orderType, mode },
  });

  if (mode === "live" && env.LIVE_TRADING_PLATFORM_ENABLED) {
    void import("@/src/server/live-trading/live-execution-audit.service")
      .then(({ auditLiveExecution }) =>
        auditLiveExecution({
          userId: input.userId,
          executionId: input.executionId,
          logKey: log.logKey,
          symbol: input.symbol,
          side: input.side,
          requestedQty: binanceValidation.quantity,
          executedQty: filledQty,
          requestedPrice: price,
          fillPrice,
          commission: fee,
          slippagePct,
          latencyMs,
          decisionId: input.entryAnalysisId,
          orderRequest: {
            orderType,
            quantity: binanceValidation.quantity,
            quoteSpend: plan.quoteSpend,
            side: input.side,
            symbol: input.symbol,
          },
          exchangeResponse,
          executionResult: "FILLED",
        }),
      )
      .catch(() => null);
  }

  void enqueueExecutionReplayForLog(log.logKey, input.executionId, input.symbol);

  emitExecutionEngineV2Event(EXECUTION_ENGINE_V2_EVENT.ORDER_EXECUTED, {
    executionId: input.executionId,
    logKey: log.logKey,
    side: input.side,
    slippagePct,
    latencyMs,
  });

  return {
    executionId: input.executionId,
    logKey: log.logKey,
    status: "VERIFIED",
    filledQuantity: filledQty,
    averageFillPrice: fillPrice,
    fee,
    slippagePct,
    latencyMs,
    orderType,
  };
}
