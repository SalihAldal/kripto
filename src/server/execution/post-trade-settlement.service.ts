import {
  estimateFees,
  getAccountBalances,
  getOrderStatus,
  getTicker,
  placeMarketBuy,
  placeMarketBuyEmergency,
  placeMarketSell,
  placeMarketSellEmergency,
} from "@/services/binance.service";
import { getGlobalTicker, placeGlobalMarketBuy, placeGlobalMarketSell } from "@/services/binance-global.service";
import { env } from "@/lib/config";
import { publishExecutionEvent } from "@/src/server/execution/execution-event-bus";
import { calculateRealizedPnl, calculateUnrealizedPnl } from "@/src/server/execution/pnl-calculator";
import type { PositionCloseReason, TradingMode } from "@/src/server/execution/types";
import { resumeScannerWorker } from "@/src/server/scanner/scanner-worker.service";
import {
  addTradeExecution,
  closePositionRecord,
  createPnlRecord,
  createTradeOrder,
  findTradeOrderById,
  findLatestPendingCloseOrder,
  getPositionById,
  updateOrderStatus,
} from "@/src/server/repositories/execution.repository";
import { addSystemLog } from "@/src/server/repositories/log.repository";
import { getConsecutiveLossCount } from "@/src/server/repositories/risk.repository";
import { getEffectiveRiskConfig } from "@/src/server/risk";
import { executePaperCloseOrder } from "@/src/server/simulation/paper-trading.service";
import type { PlaceOrderResult } from "@/src/types/exchange";

function isRateLimitedCloseError(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return message.includes("http 429") || message.includes("too many requests") || message.includes("rate limit");
}

function isInsufficientBalanceCloseError(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return message.includes("insufficient balance") || message.includes("code=2202");
}

function isCircuitOpenCloseError(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return message.includes("circuit is open for exchange:placemarketsell") || message.includes("circuit is open for exchange:placemarketbuy");
}

function isMinNotionalCloseError(error: unknown) {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return (
    message.includes("notional below min") ||
    (message.includes("calculatevalidquantity failed") && message.includes("min"))
  );
}

function classifyCloseError(errorMessage: string) {
  const lower = errorMessage.toLowerCase();
  if (lower.includes("notional")) return "min_notional";
  if (lower.includes("step") || lower.includes("lot_size")) return "step_size";
  if (lower.includes("insufficient")) return "insufficient_balance";
  if (lower.includes("timeout")) return "timeout";
  if (lower.includes("pending close order exists")) return "open_order_conflict";
  if (lower.includes("manual")) return "manual_cancel";
  if (lower.includes("api") || lower.includes("http")) return "api_error";
  return "unknown";
}

function mapOrderStatus(raw: string): "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" {
  const upper = raw.toUpperCase();
  if (upper.includes("PARTIALLY")) return "PARTIALLY_FILLED";
  if (upper.includes("FILLED") || upper.includes("SIMULATED")) return "FILLED";
  if (upper.includes("CANCELED")) return "CANCELED";
  if (upper.includes("EXPIRED")) return "EXPIRED";
  if (upper.includes("REJECT")) return "REJECTED";
  return "NEW";
}

async function settlePendingCloseOrderStatus(input: {
  symbol: string;
  exchangeOrderId?: string;
  initialStatus: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  initialExecutedQty: number;
  mode: TradingMode;
}) {
  let latestExecutedQty = Number.isFinite(input.initialExecutedQty) && input.initialExecutedQty > 0 ? input.initialExecutedQty : 0;
  if (input.mode !== "live") return { status: input.initialStatus, executedQty: latestExecutedQty };
  if (!input.exchangeOrderId) return { status: input.initialStatus, executedQty: latestExecutedQty };
  if (input.initialStatus !== "NEW" && input.initialStatus !== "PARTIALLY_FILLED") {
    return { status: input.initialStatus, executedQty: latestExecutedQty };
  }

  // SELL-FLOW FIX: Kapanis emri NEW/PARTIALLY donerse borsadan tekrar cekip fill teyidi yap.
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    try {
      const statusRow = await getOrderStatus(input.symbol, input.exchangeOrderId);
      const executedQty = Number((statusRow as Record<string, unknown>).executedQty ?? 0);
      if (Number.isFinite(executedQty) && executedQty > 0) {
        latestExecutedQty = Math.max(latestExecutedQty, executedQty);
      }
      const raw = String((statusRow as Record<string, unknown>).status ?? "");
      const mapped = mapOrderStatus(raw);
      if (mapped !== "NEW" && mapped !== "PARTIALLY_FILLED") {
        return { status: mapped, executedQty: latestExecutedQty };
      }
    } catch {
      // ignore transient errors, continue polling window
    }
  }

  return { status: input.initialStatus, executedQty: latestExecutedQty };
}

async function resolveCloseQuantity(position: Awaited<ReturnType<typeof getPositionById>>, closeSide: "BUY" | "SELL") {
  const fallback = Number(position?.quantity ?? 0);
  if (!position || !Number.isFinite(fallback) || fallback <= 0) return 0;
  const balances = await getAccountBalances().catch(() => []);
  if (balances.length === 0) return fallback;
  const asset = closeSide === "SELL" ? position.tradingPair.baseAsset : position.tradingPair.quoteAsset;
  const freeRaw = Number(
    balances.find((row) => row.asset.toUpperCase() === asset.toUpperCase())?.free ?? 0,
  );
  if (!Number.isFinite(freeRaw) || freeRaw <= 0) return closeSide === "SELL" ? 0 : fallback;
  // SELL-FLOW FIX: Komisyon ve step/lot yuvarlama etkisi icin guvenli buffer.
  const bufferedFree = Math.max(0, freeRaw * 0.9985);
  if (closeSide === "SELL") {
    // SELL-FLOW FIX: Giriste komisyonla azalmis olabilecek net adedi baz al.
    const netFromEntry = Math.max(0, fallback * (1 - (env.BINANCE_TAKER_FEE_RATE ?? 0.001)));
    return Math.max(0, Math.min(netFromEntry > 0 ? netFromEntry : fallback, bufferedFree));
  }
  const estimatedQuoteNeed = position.quantity * position.entryPrice;
  if (!Number.isFinite(estimatedQuoteNeed) || estimatedQuoteNeed <= 0) return fallback;
  const ratio = bufferedFree / estimatedQuoteNeed;
  const scaledQty = position.quantity * Math.max(0, Math.min(1, ratio));
  return Math.max(0, Math.min(fallback, scaledQty > 0 ? scaledQty : fallback));
}

export async function settleOpenPosition(input: {
  executionId: string;
  positionId: string;
  reason: PositionCloseReason;
  mode: TradingMode;
}) {
  const position = await getPositionById(input.positionId);
  if (!position || position.status !== "OPEN") {
    return { closed: false, reason: "Position not found or already closed." };
  }

  const symbol = position.tradingPair.symbol;
  const venue = String(
    ((position.metadata as Record<string, unknown> | null)?.executionVenue as string | undefined) ?? "BINANCE_TR",
  );
  const isGlobalVenue = venue === "BINANCE_GLOBAL";
  const closeSide = position.side === "LONG" ? "SELL" : "BUY";
  const closeQty = await resolveCloseQuantity(position, closeSide);
  const effectiveCloseQty = Number.isFinite(closeQty) && closeQty > 0 ? closeQty : position.quantity;
  const ticker = isGlobalVenue ? await getGlobalTicker(symbol) : await getTicker(symbol);
  const exitPrice = ticker.price;
  const targetPrice = Number(
    ((position.metadata as Record<string, unknown> | null)?.takeProfitPrice ?? 0),
  );

  const pendingCloseOrder = await findLatestPendingCloseOrder({
    positionId: position.id,
    side: closeSide,
  });
  if (pendingCloseOrder) {
    // SELL-FLOW FIX: Duplicate sell/close order olusmasini engelle.
    publishExecutionEvent({
      executionId: input.executionId,
      symbol,
      stage: "settlement",
      status: "RUNNING",
      message: `${symbol} icin bekleyen kapanis emri zaten var, yeni emir atlanacak`,
      level: "WARN",
      context: {
        positionId: position.id,
        pendingOrderId: pendingCloseOrder.id,
        exchangeOrderId: pendingCloseOrder.exchangeOrderId,
        pendingStatus: pendingCloseOrder.status,
      },
    });
    return {
      closed: false,
      reason: "Pending close order exists",
      pendingOrderId: pendingCloseOrder.id,
    };
  }

  const finalizeBalanceMismatchClose = async (errorMessage: string) => {
    await closePositionRecord({
      positionId: position.id,
      closePrice: exitPrice,
      realizedPnl: 0,
      feeTotal: position.feeTotal ?? 0,
      metadata: {
        closeReason: input.reason,
        closeMode: "BALANCE_MISMATCH_AUTO_CLOSE",
        closeError: errorMessage,
      },
    });
    await createPnlRecord({
      userId: position.userId,
      tradingPairId: position.tradingPairId,
      positionId: position.id,
      realizedPnl: 0,
      unrealizedPnl: 0,
      grossPnl: 0,
      netPnl: 0,
      feeTotal: position.feeTotal ?? 0,
      slippageCost: 0,
      roePercent: 0,
      notes: `Balance mismatch auto-close: ${input.reason}`,
      metadata: {
        mode: input.mode,
        symbol,
        closeError: errorMessage,
        skipExchangeCloseOrder: true,
      },
    });
    await addSystemLog({
      level: "WARN",
      source: "execution-settlement",
      message: `${symbol} balance mismatch auto-close applied`,
      context: { positionId: position.id, reason: input.reason, error: errorMessage },
    }).catch(() => null);
    publishExecutionEvent({
      executionId: input.executionId,
      symbol,
      stage: "settlement",
      status: "SUCCESS",
      message: `${symbol} bakiye uyumsuzlugu nedeniyle sistemsel olarak kapatildi`,
      level: "WARN",
      context: { positionId: position.id, reason: input.reason, closeError: errorMessage, balanceMismatchAutoClose: true },
    });
    resumeScannerWorker();
    return {
      closed: true,
      positionId: position.id,
      closeOrderId: undefined,
      pnl: {
        realizedPnl: 0,
        grossPnl: 0,
        netPnl: 0,
        feeTotal: position.feeTotal ?? 0,
        slippageCost: 0,
        roePercent: 0,
      },
      closeReason: input.reason,
    };
  };

  if (closeSide === "SELL" && (!Number.isFinite(closeQty) || closeQty <= 0)) {
    return finalizeBalanceMismatchClose("No base asset available for SELL close");
  }

  publishExecutionEvent({
    executionId: input.executionId,
    symbol,
    stage: "settlement",
    status: "RUNNING",
    message: `${symbol} pozisyonu kapatiliyor (${input.reason})`,
    level: "TRADE",
    context: {
      positionId: input.positionId,
      closeSide,
      selectedCoin: symbol,
      buyEntryPrice: position.entryPrice,
      targetSellPrice: targetPrice > 0 ? targetPrice : undefined,
      requestedSellQty: Number(effectiveCloseQty.toFixed(8)),
      maxQtyFromBalance: Number(closeQty.toFixed(8)),
      venue,
      reason: input.reason,
    },
  });

  let closeOrder: PlaceOrderResult | null = null;
  if (input.mode === "paper") {
    closeOrder = await executePaperCloseOrder({
      userId: position.userId,
      symbol,
      side: closeSide,
      quantity: effectiveCloseQty,
      price: exitPrice,
      quoteAsset: position.tradingPair.quoteAsset,
      baseAsset: position.tradingPair.baseAsset,
    });
  } else {
    let lastError: unknown = null;
    let attemptedQty = effectiveCloseQty;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        closeOrder =
          closeSide === "BUY"
            ? isGlobalVenue
              ? await placeGlobalMarketBuy(symbol, attemptedQty, input.mode === "dry-run")
              : await placeMarketBuy(symbol, attemptedQty, input.mode === "dry-run")
            : isGlobalVenue
              ? await placeGlobalMarketSell(symbol, attemptedQty, input.mode === "dry-run")
              : await placeMarketSell(symbol, attemptedQty, input.mode === "dry-run");
        lastError = null;
        publishExecutionEvent({
          executionId: input.executionId,
          symbol,
          stage: "settlement",
          status: "RUNNING",
          message: `${symbol} kapanis emri olusturuldu`,
          level: "INFO",
          context: {
            positionId: position.id,
            orderType: "MARKET",
            side: closeSide,
            quantity: Number(attemptedQty.toFixed(8)),
            exchangeOrderId: closeOrder.orderId,
            exchangeStatus: closeOrder.status,
            filledQty: Number(closeOrder.executedQty ?? 0),
          },
        });
        break;
      } catch (error) {
        lastError = error;
        if (!isGlobalVenue && isCircuitOpenCloseError(error)) {
          try {
            closeOrder =
              closeSide === "BUY"
                ? await placeMarketBuyEmergency(symbol, attemptedQty, input.mode === "dry-run")
                : await placeMarketSellEmergency(symbol, attemptedQty, input.mode === "dry-run");
            lastError = null;
            break;
          } catch (emergencyError) {
            lastError = emergencyError;
          }
        }
        if (isInsufficientBalanceCloseError(lastError) && attempt < 2) {
          const refreshed = await resolveCloseQuantity(position, closeSide);
          if (Number.isFinite(refreshed) && refreshed > 0 && refreshed < attemptedQty) {
            attemptedQty = Number(refreshed.toFixed(8));
            continue;
          }
          attemptedQty = Number((attemptedQty * 0.85).toFixed(8));
          if (attemptedQty > 0) continue;
        }
        if (isInsufficientBalanceCloseError(lastError)) {
          return finalizeBalanceMismatchClose((lastError as Error)?.message ?? "Insufficient balance on close");
        }
        if (isMinNotionalCloseError(lastError)) {
          // Exchange rejects tiny remainder (dust) closes. Do not block the engine with a forever-open position.
          const fallbackPnl = calculateRealizedPnl({
            side: position.side,
            entryPrice: position.entryPrice,
            exitPrice,
            quantity: effectiveCloseQty,
            openFee: position.feeTotal ?? 0,
            closeFee: 0,
            slippageCost: 0,
          });
          await closePositionRecord({
            positionId: position.id,
            closePrice: exitPrice,
            realizedPnl: fallbackPnl.realizedPnl,
            feeTotal: fallbackPnl.feeTotal,
            metadata: {
              closeReason: input.reason,
              roePercent: fallbackPnl.roePercent,
              closeMode: "DUST_AUTO_CLOSE",
              closeError: (lastError as Error)?.message ?? "Notional below min",
            },
          });
          await createPnlRecord({
            userId: position.userId,
            tradingPairId: position.tradingPairId,
            positionId: position.id,
            realizedPnl: fallbackPnl.realizedPnl,
            unrealizedPnl: 0,
            grossPnl: fallbackPnl.grossPnl,
            netPnl: fallbackPnl.netPnl,
            feeTotal: fallbackPnl.feeTotal,
            slippageCost: fallbackPnl.slippageCost,
            roePercent: fallbackPnl.roePercent,
            notes: `Dust auto-close: ${input.reason}`,
            metadata: {
              mode: input.mode,
              symbol,
              skipExchangeCloseOrder: true,
              closeError: (lastError as Error)?.message ?? "Notional below min",
            },
          });
          await addSystemLog({
            level: "WARN",
            source: "execution-settlement",
            message: `${symbol} dust auto-close applied (min notional)`,
            context: { positionId: position.id, reason: input.reason, error: (lastError as Error)?.message ?? "unknown" },
          }).catch(() => null);
          publishExecutionEvent({
            executionId: input.executionId,
            symbol,
            stage: "settlement",
            status: "SUCCESS",
            message: `${symbol} dust pozisyon min notional nedeniyle sistemsel olarak kapatildi`,
            level: "WARN",
            context: {
              positionId: position.id,
              reason: input.reason,
              closeError: (lastError as Error)?.message ?? "Notional below min",
              dustAutoClose: true,
            },
          });
          resumeScannerWorker();
          return {
            closed: true,
            positionId: position.id,
            closeOrderId: undefined,
            pnl: fallbackPnl,
            closeReason: input.reason,
          };
        }
        if (!isRateLimitedCloseError(error) || attempt >= 2) {
          await addSystemLog({
            level: "WARN",
            source: "execution-settlement",
            message: `${symbol} close order failed: ${(error as Error)?.message ?? "unknown"}`,
            context: { positionId: position.id, attempt: attempt + 1, side: closeSide },
          }).catch(() => null);
          publishExecutionEvent({
            executionId: input.executionId,
            symbol,
            stage: "settlement",
            status: "FAILED",
            message: `${symbol} pozisyonu kapatilamadi`,
            level: "ERROR",
            context: {
              positionId: position.id,
              error: (error as Error)?.message ?? "unknown",
              sellOrderRejectedReason: (error as Error)?.message ?? "unknown",
              sellOrderRejectedCode: classifyCloseError((error as Error)?.message ?? "unknown"),
              attemptedQty: Number(attemptedQty.toFixed(8)),
            },
          });
          resumeScannerWorker();
          return { closed: false, reason: "Close order failed" };
        }
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      }
    }
    if (!closeOrder) {
      publishExecutionEvent({
        executionId: input.executionId,
        symbol,
        stage: "settlement",
        status: "FAILED",
        message: `${symbol} pozisyonu kapatilamadi`,
        level: "ERROR",
        context: { positionId: position.id, error: (lastError as Error)?.message ?? "unknown" },
      });
      resumeScannerWorker();
      return { closed: false, reason: "Close order failed" };
    }
  }

  const settledCloseOrder = await settlePendingCloseOrderStatus({
    symbol,
    exchangeOrderId: closeOrder.orderId,
    initialStatus: mapOrderStatus(closeOrder.status),
    initialExecutedQty: Number(closeOrder.executedQty ?? 0),
    mode: input.mode,
  });
  const normalizedCloseStatus = settledCloseOrder.status;
  const finalCloseQty =
    Number.isFinite(settledCloseOrder.executedQty) && settledCloseOrder.executedQty > 0
      ? settledCloseOrder.executedQty
      : Number(closeOrder.executedQty ?? 0) > 0
        ? Number(closeOrder.executedQty)
        : effectiveCloseQty;
  if (normalizedCloseStatus !== "FILLED") {
    // SELL-FLOW FIX: Fill teyidi olmadan pozisyonu CLOSED yapma; pending close order olarak kaydet.
    const pendingCloseRecord = await createTradeOrder({
      userId: position.userId,
      exchangeConnectionId: position.exchangeConnectionId,
      tradingPairId: position.tradingPairId,
      positionId: position.id,
      side: closeSide,
      type: "MARKET",
      quantity: Number(effectiveCloseQty.toFixed(8)),
      price: exitPrice,
      status: normalizedCloseStatus,
      clientOrderId: closeOrder.clientOrderId,
      exchangeOrderId: closeOrder.orderId,
      submittedAt: new Date(),
      avgExecutionPrice: exitPrice,
      fee: 0,
      feeCurrency: position.tradingPair.quoteAsset,
      slippage: 0,
      metadata: {
        closeReason: input.reason,
        mode: input.mode,
        linkedPositionId: position.id,
        pendingCloseOrder: true,
      },
    });
    await addTradeExecution({
      tradeOrderId: pendingCloseRecord.id,
      status: "PENDING",
      executionPrice: exitPrice,
      executedQty: Number(closeOrder.executedQty ?? 0),
      quoteQty: Number(((Number(closeOrder.executedQty ?? 0) || 0) * exitPrice).toFixed(8)),
      fee: 0,
      slippage: 0,
      executionRef: closeOrder.orderId,
      metadata: {
        mode: input.mode,
        reason: input.reason,
        exchangeStatus: closeOrder.status,
      },
    });
    publishExecutionEvent({
      executionId: input.executionId,
      symbol,
      stage: "settlement",
      status: "RUNNING",
      message: `${symbol} kapanis emri fill bekliyor (${normalizedCloseStatus})`,
      level: "WARN",
      context: {
        positionId: position.id,
        closeOrderId: pendingCloseRecord.id,
        exchangeOrderId: closeOrder.orderId,
        orderStatus: normalizedCloseStatus,
        filledQty: Number(closeOrder.executedQty ?? 0),
        closeNotExecutedReason: "Order not filled yet",
        closeNotExecutedCode: "target_not_reached_or_waiting_fill",
      },
    });
    resumeScannerWorker();
    return {
      closed: false,
      reason: "Close order pending fill",
      closeOrderId: pendingCloseRecord.id,
      orderStatus: normalizedCloseStatus,
    };
  }

  const closeFeeEst = await estimateFees(symbol, closeSide, finalCloseQty, exitPrice);
  const closeFee = closeFeeEst.estimatedTakerFee;
  const openFee = position.feeTotal ?? 0;
  const slippageCost = Number(((closeOrder.price ? Math.abs(closeOrder.price - exitPrice) : 0) * finalCloseQty).toFixed(8));

  const pnl = calculateRealizedPnl({
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice,
    quantity: finalCloseQty,
    openFee,
    closeFee,
    slippageCost,
  });

  const createdCloseOrder = await createTradeOrder({
    userId: position.userId,
    exchangeConnectionId: position.exchangeConnectionId,
    tradingPairId: position.tradingPairId,
    positionId: position.id,
    side: closeSide,
    type: "MARKET",
    quantity: finalCloseQty,
    price: exitPrice,
    status: "FILLED",
    clientOrderId: closeOrder.clientOrderId,
    exchangeOrderId: closeOrder.orderId,
    submittedAt: new Date(),
    executedAt: new Date(),
    avgExecutionPrice: exitPrice,
    fee: closeFee,
    feeCurrency: position.tradingPair.quoteAsset,
    slippage: slippageCost,
    metadata: {
      closeReason: input.reason,
      mode: input.mode,
      linkedPositionId: position.id,
    },
  });

  await addTradeExecution({
    tradeOrderId: createdCloseOrder.id,
    status: "SUCCESS",
    executionPrice: exitPrice,
    executedQty: finalCloseQty,
    quoteQty: Number((finalCloseQty * exitPrice).toFixed(8)),
    fee: closeFee,
    slippage: slippageCost,
    executionRef: closeOrder.orderId,
    metadata: { mode: input.mode, reason: input.reason },
  });

  await closePositionRecord({
    positionId: position.id,
    closePrice: exitPrice,
    realizedPnl: pnl.realizedPnl,
    feeTotal: pnl.feeTotal,
    metadata: {
      closeReason: input.reason,
      roePercent: pnl.roePercent,
    },
  });

  await createPnlRecord({
    userId: position.userId,
    tradingPairId: position.tradingPairId,
    positionId: position.id,
    tradeOrderId: createdCloseOrder.id,
    realizedPnl: pnl.realizedPnl,
    unrealizedPnl: 0,
    grossPnl: pnl.grossPnl,
    netPnl: pnl.netPnl,
    feeTotal: pnl.feeTotal,
    slippageCost: pnl.slippageCost,
    roePercent: pnl.roePercent,
    notes: `Position closed: ${input.reason}`,
    metadata: { mode: input.mode },
  });

  await addSystemLog({
    level: "INFO",
    source: "execution-settlement",
    message: `${symbol} position closed (${input.reason}) pnl=${pnl.netPnl}`,
    context: {
      positionId: position.id,
      closeOrderId: createdCloseOrder.id,
      mode: input.mode,
      outcome: pnl.netPnl >= 0 ? "WIN" : "LOSS",
      lossScenario: pnl.netPnl < 0 ? input.reason : undefined,
      ruleTags: Array.isArray((position.metadata as Record<string, unknown> | null)?.ruleTags)
        ? (position.metadata as Record<string, unknown>).ruleTags
        : [],
    },
  }).catch(() => null);

  publishExecutionEvent({
    executionId: input.executionId,
    symbol,
    stage: "settlement",
    status: "SUCCESS",
    message: `${symbol} pozisyon kapandi. Net PnL=${pnl.netPnl.toFixed(4)}`,
    level: "TRADE",
    context: {
      positionId: position.id,
      pnl,
      tradeSummary: {
        symbol,
        side: position.side,
        entryPrice: position.entryPrice,
        exitPrice,
        quantity: finalCloseQty,
        netPnl: pnl.netPnl,
        closeReason: input.reason,
      },
      sellOrder: {
        type: "MARKET",
        quantity: finalCloseQty,
        orderId: closeOrder.orderId,
        status: normalizedCloseStatus,
        fillConfirmed: true,
      },
    },
  });
  resumeScannerWorker();

  if (pnl.netPnl < 0 && !env.EXECUTION_REENTRY_AFTER_LOSS) {
    const effectiveRisk = await getEffectiveRiskConfig(position.userId).catch(() => null);
    const consecutiveLosses = await getConsecutiveLossCount(position.userId).catch(() => 0);
    const reachedBreaker = Boolean(
      effectiveRisk && consecutiveLosses >= effectiveRisk.consecutiveLossBreaker,
    );
    if (reachedBreaker) {
      publishExecutionEvent({
        executionId: input.executionId,
        symbol,
        stage: "risk-gate",
        status: "RUNNING",
        message: "Consecutive loss breaker tespit edildi (telemetry-only, auto-pause kapali)",
        level: "WARN",
        context: { consecutiveLosses, breaker: effectiveRisk?.consecutiveLossBreaker },
      });
    }
  }

  return {
    closed: true,
    positionId: position.id,
    closeOrderId: createdCloseOrder.id,
    pnl,
    closeReason: input.reason,
  };
}

export async function syncUnrealizedPnl(positionId: string) {
  const position = await getPositionById(positionId);
  if (!position || position.status !== "OPEN") return null;
  const ticker = await getTicker(position.tradingPair.symbol);
  const unrealized = calculateUnrealizedPnl(position.side, position.entryPrice, ticker.price, position.quantity);
  return { positionId, markPrice: ticker.price, unrealizedPnl: unrealized };
}

export async function getTradeOrderStatusSummary(orderId: string) {
  const row = await findTradeOrderById(orderId);
  if (!row) return null;
  return {
    orderId: row.id,
    symbol: row.tradingPair.symbol,
    status: row.status,
    side: row.side,
    type: row.type,
    quantity: row.quantity,
    price: row.price,
    avgExecutionPrice: row.avgExecutionPrice,
    positionId: row.positionId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function markOrderAsCanceled(orderId: string, reason = "Manual cancel") {
  await updateOrderStatus({
    orderId,
    status: "CANCELED",
    canceledAt: new Date(),
    rejectReason: reason,
  });
}
