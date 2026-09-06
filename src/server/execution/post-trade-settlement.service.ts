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
import { bridgeClosedTradePnl } from "@/src/server/forensics/forensic-bridge.service";
import { mapPositionMonitorExit } from "@/src/server/forensics/exit-forensics.service";
import { calculateRealizedPnl, calculateUnrealizedPnl } from "@/src/server/execution/pnl-calculator";
import type { PositionCloseReason, TradingMode } from "@/src/server/execution/types";
import { resumeScannerWorker } from "@/src/server/scanner/scanner-worker.service";
import { logTradeEvent } from "@/src/server/observability/trade-event-log";
import { buildSetupFeatureSnapshot } from "@/src/server/metrics/setup-feature-utils";
import { notifySystemEvent } from "@/src/server/notifications/notification.service";
import { runDeepPostTradeAnalysis } from "@/src/server/trading-core/self-learning/deep-post-trade-analysis";
import { getHistoricalStrategyRegimeExpectancy, persistLearningTrade } from "@/src/server/trading-core/self-learning/learning-store";
import { collectLearningMarketEvidence } from "@/src/server/trading-core/self-learning/market-evidence-archive";
import { buildDynamicLearningWeight } from "@/src/server/trading-core/self-learning/dynamic-learning-weight";
import {
  addTradeExecution,
  closePositionRecord,
  createPnlRecord,
  createTradeOrder,
  findTradeOrderById,
  getPositionById,
  updateOrderStatus,
} from "@/src/server/repositories/execution.repository";
import { addSystemLog } from "@/src/server/repositories/log.repository";
import { getConsecutiveLossCount } from "@/src/server/repositories/risk.repository";
import { getEffectiveRiskConfig } from "@/src/server/risk";
import { executePaperCloseOrderViaSimulator } from "@/src/server/exchange-simulator/paper-exchange-adapter.service";
import { runPreTradeSafetyValidation } from "@/src/server/execution-safety/pre-trade-validator.service";
import { recordExecutionFailure } from "@/src/server/execution-safety/recovery-engine.service";
import type { PlaceOrderResult } from "@/src/types/exchange";
import { ensureSingleActiveExitOrder } from "@/src/server/execution/order-manager.service";
import { feedbackLoopEngine } from "@/src/server/trading-core/feedback-loop";
import { resolveBinanceTakerFeeRate } from "@/src/server/execution/fee-profile";
import { classifyNetExitOutcome, isSuccessfulNetExit } from "@/src/server/execution/profit-thresholds";
import { calibrateAIAnalysisFromTrade } from "@/src/server/ai/ai-analysis-memory.service";
import { persistOrchestrationEnvelope } from "@/src/server/orchestration";
import { persistPaperCloseFillForSettlement } from "@/src/server/execution/paper-close-persistence.service";
import { applyCanonicalPartialSettlementFill } from "@/src/server/execution/canonical-settlement-fill.service";
import type { SettlementFillResult } from "@/src/server/execution/settlement-fill-result";
import { createHash } from "node:crypto";

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

function optionalNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function resolveFeeCurrency(input: {
  feeAsset: "BASE" | "QUOTE" | "UNKNOWN";
  baseAsset: string;
  quoteAsset: string;
  closeOrderMetadata?: Record<string, unknown>;
}) {
  const explicit = String(input.closeOrderMetadata?.feeCurrency ?? "").trim().toUpperCase();
  if (explicit) return explicit;
  if (input.feeAsset === "QUOTE") return input.quoteAsset;
  if (input.feeAsset === "BASE") return input.baseAsset;
  return null;
}

function buildCanonicalFillIdentity(input: {
  exchangeConnectionId: string;
  symbol: string;
  exchangeOrderId?: string;
  clientOrderId?: string;
  filledQuantity: number;
  fillPrice: number;
  fee: number;
  filledAtMs: number;
}) {
  return createHash("sha256")
    .update(
      [
        "fill-v1",
        input.exchangeConnectionId,
        input.symbol,
        input.exchangeOrderId ?? "",
        input.clientOrderId ?? "",
        input.filledQuantity.toFixed(8),
        input.fillPrice.toFixed(8),
        input.fee.toFixed(8),
        String(input.filledAtMs),
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 32);
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

function resolveOpenFee(position: NonNullable<Awaited<ReturnType<typeof getPositionById>>>) {
  const positionFee = Number(position.feeTotal ?? 0);
  if (Number.isFinite(positionFee) && positionFee > 0) return positionFee;
  const openSide = position.side === "LONG" ? "BUY" : "SELL";
  const orderFee = (position.tradeOrders ?? [])
    .filter((order) => order.side === openSide && order.status === "FILLED")
    .reduce((acc, order) => acc + Number(order.fee ?? 0), 0);
  if (Number.isFinite(orderFee) && orderFee > 0) return Number(orderFee.toFixed(8));
  const metadata = (position.metadata as Record<string, unknown> | null) ?? {};
  const metadataFee = Number(metadata.buyFee ?? metadata.openFee ?? 0);
  return Number.isFinite(metadataFee) && metadataFee > 0 ? metadataFee : 0;
}

async function recordFeedbackLearning(input: {
  position: NonNullable<Awaited<ReturnType<typeof getPositionById>>>;
  symbol: string;
  exitPrice: number;
  realizedPnl: number;
  returnPercent: number;
  closeReason: PositionCloseReason;
  mode: TradingMode;
}) {
  if (input.mode !== "paper") return null;
  const metadata = (input.position.metadata as Record<string, unknown> | null) ?? {};
  const setupSnapshot = buildSetupFeatureSnapshot(metadata);
  const maxDurationSec = Number(metadata.maxDurationSec ?? 0);
  const horizon =
    maxDurationSec > 0 && maxDurationSec <= 600
      ? "SCALP_5M"
      : maxDurationSec > 0 && maxDurationSec <= 900
        ? "INTRADAY_15M"
        : maxDurationSec > 0 && maxDurationSec <= 1800
          ? "SHORT_30M"
          : maxDurationSec > 0 && maxDurationSec <= 3600
            ? "INTRADAY_1H"
            : maxDurationSec > 0 && maxDurationSec <= 14400
              ? "INTRADAY_4H"
              : "SESSION";
  const strategy = `${setupSnapshot.marketRegimeStrategy ?? "PAPER_LEARNING"}:${horizon}`;
  const botId = String(metadata.botId ?? "paper-learning-lane");
  const tradeId = input.position.id;

  try {
    feedbackLoopEngine.openTrade({
      tradeId,
      botId,
      strategy,
      symbol: input.symbol,
      side: input.position.side === "LONG" ? "BUY" : "SELL",
      entryPrice: input.position.entryPrice,
      quantity: input.position.quantity,
      openedAt: input.position.openedAt.toISOString(),
      market: {
        marketRegime: setupSnapshot.marketRegime,
        spreadPercent: Number(metadata.spreadPercent ?? NaN),
        volatilityPercent: Number(metadata.volatilityPercent ?? NaN),
        orderbookImbalancePercent: Number(metadata.orderBookImbalance ?? NaN),
      },
      strategySnapshot: {
        strategy,
        confidenceScore: Number(metadata.aiConfidence ?? metadata.confidence ?? NaN),
        minScore: Number(metadata.qualityMinimumRequiredScore ?? NaN),
        params: {
          qualityScore: Number(metadata.qualityScore ?? 0),
          maxDurationSec: Number(metadata.maxDurationSec ?? 0),
          targetProfitPercent: Number(metadata.takeProfitPercent ?? metadata.targetProfitPercent ?? 0),
          stopLossPercent: Number(metadata.stopLossPercent ?? 0),
          learningLane: Boolean(metadata.learningLane ?? false),
        },
      },
    });
    const report = await feedbackLoopEngine.closeTrade({
      tradeId,
      exitPrice: input.exitPrice,
      realizedPnl: input.realizedPnl,
      returnPercent: input.returnPercent,
      closedAt: new Date().toISOString(),
      exitReason: input.closeReason,
      applyLearning: true,
    });
    const closedAt = new Date();
    const holdSec = Math.max(0, Math.round((closedAt.getTime() - input.position.openedAt.getTime()) / 1000));
    const marketEvidence = await collectLearningMarketEvidence(input.symbol);
    const evidenceNumericRows: Array<[string, number | undefined, string, number]> = [
      ["fundingRate", marketEvidence.summary.fundingRate, "futures", 1.1],
      ["openInterest", marketEvidence.summary.openInterest, "futures", 0.9],
      ["liquidationImbalance", marketEvidence.summary.liquidationImbalance, "futures", 1.1],
      ["liquidationBuyNotional", marketEvidence.summary.liquidationBuyNotional, "futures", 0.7],
      ["liquidationSellNotional", marketEvidence.summary.liquidationSellNotional, "futures", 0.7],
      ["marketEvidenceVolumeSpikeRatio", marketEvidence.summary.volumeSpikeRatio, "volume", 0.8],
      ["marketEvidenceBuySellRatio", marketEvidence.summary.buySellRatio, "flow", 0.9],
      ["macroUncertaintyLevel", marketEvidence.summary.macroUncertaintyLevel, "news", 0.8],
    ];
    const evidenceNumericFeatures = evidenceNumericRows
      .filter((row): row is [string, number, string, number] => Number.isFinite(row[1]))
      .map(([key, value, category, weight]) => ({ key, value: Number(value.toFixed(6)), category, weight }));
    const combinedNumericFeatures = [...setupSnapshot.numericFeatures, ...evidenceNumericFeatures];
    const historicalRegimeExpectancy = await getHistoricalStrategyRegimeExpectancy({
      strategy,
      marketRegime: setupSnapshot.marketRegime,
    }).catch(() => undefined);
    const deepAnalysis = await runDeepPostTradeAnalysis({
      symbol: input.symbol,
      side: input.position.side === "LONG" ? "BUY" : "SELL",
      strategy,
      entryLogic: setupSnapshot.entryType,
      outcome: report.learningReport.outcome,
      entryPrice: input.position.entryPrice,
      exitPrice: input.exitPrice,
      returnPercent: input.returnPercent,
      realizedPnl: input.realizedPnl,
      targetProfitPercent: optionalNumber(metadata.takeProfitPercent ?? metadata.targetProfitPercent),
      stopLossPercent: optionalNumber(metadata.stopLossPercent),
      maxDurationSec: optionalNumber(metadata.maxDurationSec),
      holdSec,
      closeReason: input.closeReason,
      marketRegime: setupSnapshot.marketRegime,
      historicalRegimeExpectancyPercent: historicalRegimeExpectancy?.expectancyPercent,
      qualityScore: setupSnapshot.qualityScore,
      criticGrade: report.learningReport.postTradeCritic.grade,
      criticVerdict: report.learningReport.postTradeCritic.verdict,
      patternStatus: report.learningReport.pattern.status,
      features: setupSnapshot.features,
      numericFeatures: combinedNumericFeatures,
      marketEvidence,
      metadata,
    });
    const learningWeight = buildDynamicLearningWeight({
      marketRegime: setupSnapshot.marketRegime,
      regimeConfidence: optionalNumber(metadata.marketRegimeConfidenceScore),
      volatilityPercent: optionalNumber(metadata.volatilityPercent),
      fakeSpikeScore: optionalNumber(metadata.fakeSpikeScore ?? metadata.fakeBreakoutRiskScore),
      pumpRisk: optionalNumber(metadata.pumpRisk),
      spreadPercent: optionalNumber(metadata.spreadPercent),
      liquidityDepth: optionalNumber(metadata.effectiveLiquidity24h ?? metadata.volume24h),
      mtfAlignment: optionalNumber(metadata.mtfAlignmentScore),
      setupQuality: setupSnapshot.qualityScore,
      slippageSeverity: optionalNumber(metadata.slippagePercent ?? metadata.slippage),
      executionQuality: optionalNumber(metadata.executionQualityScore),
      aiConfidence: optionalNumber(metadata.aiConfidence ?? metadata.confidence),
      criticConfidence: deepAnalysis.confidence,
      anomalyScore: optionalNumber(metadata.manipulationRiskScore),
      deepAnalysis,
      critic: report.learningReport.postTradeCritic,
      numericFeatures: combinedNumericFeatures,
      metadata,
    });
    const deepFeatures = deepAnalysis.learningTags.map((tag) => `deep:${tag}`);
    const learningWeightFeatures = [
      `learning_weight:${learningWeight.label.toLowerCase()}`,
      `learning_weight_regime:${String(setupSnapshot.marketRegime ?? "unknown").toLowerCase()}`,
    ];
    const evidenceFeatures = [
      marketEvidence.summary.fundingRate !== undefined ? `funding:${marketEvidence.summary.fundingRate >= 0 ? "positive" : "negative"}` : "",
      marketEvidence.summary.openInterest !== undefined ? "oi:available" : "oi:missing",
      marketEvidence.summary.liquidationImbalance !== undefined
        ? `liquidation:${Math.abs(marketEvidence.summary.liquidationImbalance) >= 0.35 ? "imbalanced" : "balanced"}`
        : "liquidation:missing",
      `news:${String(marketEvidence.summary.newsSentiment).toLowerCase()}`,
      marketEvidence.summary.macroHighImpactNews ? "macro:high_impact_news" : "macro:no_high_impact_news",
    ].filter(Boolean);
    const dbLearning = await persistLearningTrade({
      userId: input.position.userId,
      tradingPairId: input.position.tradingPairId,
      positionId: input.position.id,
      tradeId,
      symbol: input.symbol,
      mode: input.mode,
      side: input.position.side === "LONG" ? "BUY" : "SELL",
      strategy,
      horizon: setupSnapshot.horizon,
      outcome: report.learningReport.outcome,
      entryPrice: input.position.entryPrice,
      exitPrice: input.exitPrice,
      quantity: input.position.quantity,
      realizedPnl: input.realizedPnl,
      returnPercent: input.returnPercent,
      targetProfitPercent: optionalNumber(metadata.takeProfitPercent ?? metadata.targetProfitPercent),
      stopLossPercent: optionalNumber(metadata.stopLossPercent),
      maxDurationSec: optionalNumber(metadata.maxDurationSec),
      holdSec,
      closeReason: input.closeReason,
      marketRegime: setupSnapshot.marketRegime,
      qualityScore: setupSnapshot.qualityScore,
      patternKey: setupSnapshot.patternKey || report.learningReport.pattern.patternKey,
      features: [...setupSnapshot.features, ...deepFeatures, ...evidenceFeatures, ...learningWeightFeatures],
      numericFeatures: combinedNumericFeatures,
      critic: report.learningReport.postTradeCritic,
      tpslSuggestion: report.learningReport.tpslSuggestion,
      deepAnalysis,
      learningWeight: learningWeight.weight,
      learningWeightProfile: learningWeight,
      marketEvidence,
      metadata: {
        setupSnapshot,
        learningReport: report.learningReport,
        deepAnalysis,
        learningWeight,
        marketEvidence,
        decisionFeatureSnapshot: (metadata.decisionFeatureSnapshot as Record<string, unknown> | undefined) ?? undefined,
      },
      openedAt: input.position.openedAt,
      closedAt,
    });
    return { ...report, dbLearning };
  } catch (error) {
    return { error: (error as Error)?.message ?? "feedback learning failed" };
  }
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

async function resolveCloseQuantity(
  position: Awaited<ReturnType<typeof getPositionById>>,
  closeSide: "BUY" | "SELL",
  mode: TradingMode,
) {
  const fallback = Number(position?.quantity ?? 0);
  if (!position || !Number.isFinite(fallback) || fallback <= 0) return 0;
  if (mode === "paper") return fallback;
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
    const netFromEntry = Math.max(0, fallback * (1 - resolveBinanceTakerFeeRate()));
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
  variantDEnabled?: boolean;
  baselineComparableExitReason?: string | null;
  actualVariantDExitReason?: string | null;
  requestedCloseQuantity?: number;
  settlementFillId?: string;
  pr04DecisionKind?: string;
  pr04PartialLegId?: string | null;
  decisionPrice?: number | null;
  expectedExitStateVersion?: number;
}) {
  const position = await getPositionById(input.positionId);
  if (!position || position.status !== "OPEN") {
    return { closed: false, reason: "Position not found or already closed." };
  }
  const positionMeta = (position.metadata as Record<string, unknown> | null) ?? {};
  const partialFills = Array.isArray(positionMeta.partialCloseFills)
    ? (positionMeta.partialCloseFills as Array<Record<string, unknown>>)
    : [];
  if (input.settlementFillId && partialFills.some((row) => row.fillId === input.settlementFillId)) {
    return {
      closed: false,
      partial: false,
      reason: "Duplicate settlement fill suppressed",
      duplicate: true,
    };
  }
  const decisionTimestamp = new Date().toISOString();
  const variantTelemetryMeta = {
    variantDEnabled: Boolean(input.variantDEnabled),
    baselineComparableExitReason: input.baselineComparableExitReason ?? null,
    actualVariantDExitReason: input.actualVariantDExitReason ?? null,
  };

  const symbol = position.tradingPair.symbol;
  const venue = String(
    (positionMeta.executionVenue as string | undefined) ?? "BINANCE_TR",
  );
  const isGlobalVenue = venue === "BINANCE_GLOBAL";
  const closeSide = position.side === "LONG" ? "SELL" : "BUY";
  const resolvedCloseQty = await resolveCloseQuantity(position, closeSide, input.mode);
  const requestedQty =
    input.requestedCloseQuantity != null && Number.isFinite(input.requestedCloseQuantity)
      ? Number(input.requestedCloseQuantity)
      : null;
  const effectiveCloseQty = requestedQty != null && requestedQty > 0
    ? Math.min(requestedQty, position.quantity, resolvedCloseQty > 0 ? resolvedCloseQty : position.quantity)
    : Number.isFinite(resolvedCloseQty) && resolvedCloseQty > 0
      ? resolvedCloseQty
      : position.quantity;
  const isPartialClose =
    requestedQty != null && requestedQty > 0 && effectiveCloseQty < Number(position.quantity);
  const ticker = isGlobalVenue ? await getGlobalTicker(symbol) : await getTicker(symbol);
  const exitPrice = ticker.price;
  const targetPrice = Number(
    ((position.metadata as Record<string, unknown> | null)?.takeProfitPrice ?? 0),
  );

  const pendingGate = await ensureSingleActiveExitOrder({
    executionId: input.executionId,
    positionId: position.id,
    symbol,
    side: closeSide,
  });
  if (!pendingGate.allowed) {
    return {
      closed: false,
      reason: "Pending close order exists",
      pendingOrderId: pendingGate.pending?.id,
    };
  }

  const recordClosedTradeForensics = (inputForensics: {
    reason: PositionCloseReason;
    closePrice: number;
    quantity: number;
    openFee: number;
    closeFee: number;
    slippageCost?: number;
    decisionTimestamp?: string;
  }) => {
    const exitForensicsSnapshot = mapPositionMonitorExit({
      closeReason: inputForensics.reason,
      entryPrice: position.entryPrice,
      exitPrice: inputForensics.closePrice,
      entryTimestamp: position.openedAt,
      exitTimestamp: new Date(),
      takeProfitPrice: Number(positionMeta.takeProfitPrice ?? positionMeta.targetSellPrice ?? 0) || null,
      stopLossPrice: Number(positionMeta.stopLossPrice ?? 0) || null,
      side: position.side,
      quantity: inputForensics.quantity,
      openFee: inputForensics.openFee,
      closeFee: inputForensics.closeFee,
      decisionTimestamp: inputForensics.decisionTimestamp ?? decisionTimestamp,
      priceAtMonitorTick: inputForensics.closePrice,
    });
    bridgeClosedTradePnl({
      tradeId: position.id,
      positionId: position.id,
      symbol,
      side: position.side,
      entryPrice: position.entryPrice,
      exitPrice: inputForensics.closePrice,
      quantity: inputForensics.quantity,
      entryFee: inputForensics.openFee,
      exitFee: inputForensics.closeFee,
      slippageCost: inputForensics.slippageCost ?? 0,
      exitReason: exitForensicsSnapshot.exitReason,
      exitModel: exitForensicsSnapshot.exitModel,
      exitForensics: exitForensicsSnapshot,
    });
    return exitForensicsSnapshot;
  };

  const finalizeBalanceMismatchClose = async (errorMessage: string) => {
    const openFee = resolveOpenFee(position);
    const settledQty = Number.isFinite(effectiveCloseQty) && effectiveCloseQty > 0 ? effectiveCloseQty : position.quantity;
    recordClosedTradeForensics({
      reason: input.reason,
      closePrice: exitPrice,
      quantity: settledQty,
      openFee,
      closeFee: 0,
      slippageCost: 0,
    });
    await closePositionRecord({
      positionId: position.id,
      closePrice: exitPrice,
      realizedPnl: 0,
      feeTotal: openFee,
      metadata: {
        closeReason: input.reason,
        closeMode: "BALANCE_MISMATCH_AUTO_CLOSE",
        closeError: errorMessage,
        ...variantTelemetryMeta,
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
      feeTotal: openFee,
      slippageCost: 0,
      roePercent: 0,
      notes: `Balance mismatch auto-close: ${input.reason}`,
      metadata: {
        mode: input.mode,
        symbol,
        closeError: errorMessage,
        skipExchangeCloseOrder: true,
        ...variantTelemetryMeta,
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
        feeTotal: openFee,
        slippageCost: 0,
        roePercent: 0,
      },
      closeReason: input.reason,
    };
  };

  if (input.mode !== "paper" && closeSide === "SELL" && (!Number.isFinite(resolvedCloseQty) || resolvedCloseQty <= 0)) {
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
      maxQtyFromBalance: Number(resolvedCloseQty.toFixed(8)),
      venue,
      reason: input.reason,
    },
  });

  let closeOrder: PlaceOrderResult | null = null;
  const closeSafety = await runPreTradeSafetyValidation({
    executionId: input.executionId,
    userId: position.userId,
    symbol,
    side: closeSide,
    mode: input.mode,
    quantity: effectiveCloseQty,
    priceHint: exitPrice,
    quoteAsset: position.tradingPair.quoteAsset,
    baseAsset: position.tradingPair.baseAsset,
    openPositionCount: 1,
    allowMultipleOpenPositions: false,
    orderType: "MARKET",
    spreadPercent: Number(positionMeta.spreadPercent ?? 0),
    volatilityPercent: Number(positionMeta.volatilityPercent ?? 0),
    atr: Number(positionMeta.atr ?? 0),
  }).catch(() => null);
  if (closeSafety && !closeSafety.passed) {
    await recordExecutionFailure({
      executionId: input.executionId,
      userId: position.userId,
      symbol,
      side: closeSide,
      reason: closeSafety.rejectReason ?? "Close safety validation failed",
      stage: closeSafety.blockedBy,
    }).catch(() => null);
    publishExecutionEvent({
      executionId: input.executionId,
      symbol,
      stage: "settlement",
      status: "FAILED",
      message: `Close safety blocked: ${closeSafety.rejectReason ?? "unknown"}`,
      level: "WARN",
    });
    resumeScannerWorker();
    return { closed: false, reason: closeSafety.rejectReason ?? "Close safety validation failed" };
  }
  if (input.mode === "paper") {
    closeOrder = await executePaperCloseOrderViaSimulator({
      userId: position.userId,
      executionId: input.executionId,
      symbol,
      side: closeSide,
      quantity: effectiveCloseQty,
      priceHint: exitPrice,
      quoteAsset: position.tradingPair.quoteAsset,
      baseAsset: position.tradingPair.baseAsset,
      bidDepth: Number(positionMeta.bidDepth ?? 0),
      askDepth: Number(positionMeta.askDepth ?? 0),
      spreadPercent: Number(positionMeta.spreadPercent ?? 0),
      atr: Number(positionMeta.atr ?? 0),
      volatilityPercent: Number(positionMeta.volatilityPercent ?? 0),
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
          const refreshed = await resolveCloseQuantity(position, closeSide, input.mode);
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
            openFee: resolveOpenFee(position),
            closeFee: 0,
            slippageCost: 0,
          });
          recordClosedTradeForensics({
            reason: input.reason,
            closePrice: exitPrice,
            quantity: effectiveCloseQty,
            openFee: resolveOpenFee(position),
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
              ...variantTelemetryMeta,
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
              ...variantTelemetryMeta,
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
        pr04DecisionKind: input.pr04DecisionKind ?? null,
        pr04PartialLegId: input.pr04PartialLegId ?? null,
        exitIntentId: input.settlementFillId ?? null,
        linkedPositionId: position.id,
        pendingCloseOrder: true,
        ...variantTelemetryMeta,
      },
    });
    await logTradeEvent({
      positionId: position.id,
      symbol,
      eventType: "NEW_SELL_ORDER_CREATED",
      price: exitPrice,
      newValue: {
        orderId: pendingCloseRecord.id,
        status: normalizedCloseStatus,
        reason: input.reason,
      },
      reason: input.reason,
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
        ...variantTelemetryMeta,
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

  const closeFillPrice = Number(closeOrder.price ?? 0) > 0 ? Number(closeOrder.price) : exitPrice;
  const closeFeeFromOrder = Number((closeOrder.metadata as Record<string, unknown> | undefined)?.fee ?? 0);
  const closeFeeEst = await estimateFees(symbol, closeSide, finalCloseQty, closeFillPrice);
  const closeFee = Number.isFinite(closeFeeFromOrder) && closeFeeFromOrder > 0 ? closeFeeFromOrder : closeFeeEst.estimatedTakerFee;
  const openFee = resolveOpenFee(position);
  const slippageCostAttribution = Number((closeOrder.metadata as Record<string, unknown> | undefined)?.slippagePct ?? 0);
  const spreadCostAttribution = Number((closeOrder.metadata as Record<string, unknown> | undefined)?.spreadCostQuote ?? 0);
  // Fill price already includes spread/slippage effect. Avoid double-counting in net PnL.
  const slippageCost = 0;

  const pnl = calculateRealizedPnl({
    side: position.side,
    entryPrice: position.entryPrice,
    exitPrice: closeFillPrice,
    quantity: finalCloseQty,
    openFee: isPartialClose ? openFee * (finalCloseQty / Math.max(position.quantity, finalCloseQty)) : openFee,
    closeFee,
    slippageCost,
  });

  const pr04Meta = {
    pr04DecisionKind: input.pr04DecisionKind ?? null,
    pr04PartialLegId: input.pr04PartialLegId ?? null,
    settlementFillId: input.settlementFillId ?? null,
    partialClose: isPartialClose,
  };

  const filledAtMs = Number(
    (closeOrder.metadata as Record<string, unknown> | undefined)?.filledAtMs ??
      (closeOrder.metadata as Record<string, unknown> | undefined)?.executedAtMs ??
      Date.now(),
  );
  const normalizedFeeAsset = (() => {
    const raw = String((closeOrder.metadata as Record<string, unknown> | undefined)?.feeAsset ?? "QUOTE")
      .trim()
      .toUpperCase();
    if (raw === "BASE" || raw === "QUOTE") return raw;
    return "UNKNOWN";
  })() as "BASE" | "QUOTE" | "UNKNOWN";
  const canonicalSettlementFillId = buildCanonicalFillIdentity({
    exchangeConnectionId: position.exchangeConnectionId,
    symbol,
    exchangeOrderId: closeOrder.orderId,
    clientOrderId: closeOrder.clientOrderId,
    filledQuantity: finalCloseQty,
    fillPrice: closeFillPrice,
    fee: closeFee,
    filledAtMs,
  });
  const canonical = await applyCanonicalPartialSettlementFill({
    positionId: position.id,
    settlementFillId: canonicalSettlementFillId,
    userId: position.userId,
    exchangeConnectionId: position.exchangeConnectionId,
    tradingPairId: position.tradingPairId,
    quoteAsset: position.tradingPair.quoteAsset,
    positionSide: position.side,
    closeSide,
    fillPrice: closeFillPrice,
    filledQuantity: finalCloseQty,
    closeFee,
    feeAsset: normalizedFeeAsset,
    feeCurrency: resolveFeeCurrency({
      feeAsset: normalizedFeeAsset,
      baseAsset: position.tradingPair.baseAsset,
      quoteAsset: position.tradingPair.quoteAsset,
      closeOrderMetadata: (closeOrder.metadata as Record<string, unknown> | undefined) ?? undefined,
    }),
    openFeePortion: openFee * (finalCloseQty / Math.max(position.quantity, finalCloseQty)),
    clientOrderId: closeOrder.clientOrderId ?? `client-${input.positionId}`,
    exchangeOrderId: closeOrder.orderId ?? `ex-${input.positionId}`,
    closeReason: input.reason,
    mode: input.mode,
    orderTerminal: true,
    orderRemainingQuantity: 0,
    fillAtMs: filledAtMs,
    exitStateUpdate:
      typeof input.expectedExitStateVersion === "number" && input.pr04DecisionKind
        ? {
            expectedStateVersion: input.expectedExitStateVersion,
            decisionKind: input.pr04DecisionKind as
              | "NONE"
              | "STRUCTURAL_STOP"
              | "TAKE_PROFIT"
              | "PARTIAL_TAKE_PROFIT"
              | "TRAILING_STOP"
              | "TIME_EXIT"
              | "SETUP_INVALIDATION"
              | "RISK_OVERRIDE"
              | "MANUAL_CLOSE",
            partialLegId: input.pr04PartialLegId ?? null,
          }
        : undefined,
    metadata: {
      closeReason: input.reason,
      exitIntentId: input.settlementFillId ?? null,
      ...pr04Meta,
      ...variantTelemetryMeta,
    },
  });
  resumeScannerWorker();
  if (canonical.status !== "APPLIED" && canonical.status !== "ALREADY_APPLIED") {
    return {
      ...canonical,
      closed: false,
      partial: false,
      reason: canonical.reason ?? "Canonical settlement failed",
    };
  }

  const settledQty = canonical.executedQuantity ?? finalCloseQty;
  const settledFillPrice = canonical.fillPrice ?? closeFillPrice;
  const settledFillFee = canonical.fillFee ?? closeFee;
  const settledFeeAsset = canonical.feeAsset ?? normalizedFeeAsset;
  const persistedOrder = canonical.tradeOrderId ? await findTradeOrderById(canonical.tradeOrderId) : null;
  if (!persistedOrder) {
    return {
      ...canonical,
      closed: false,
      partial: false,
      reason: "Canonical settlement order record missing",
    };
  }

  if (canonical.partial || !canonical.positionClosed || isPartialClose) {
    return {
      ...canonical,
      closed: false,
      partial: true,
      filledQuantity: settledQty,
      fillPrice: settledFillPrice,
      fillFee: settledFillFee,
      feeAsset: settledFeeAsset,
      remainingQuantity: canonical.positionRemainingQuantity,
      closeOrderId: persistedOrder.id,
    } satisfies SettlementFillResult & {
      closed: boolean;
      partial: boolean;
      filledQuantity: number | null;
      fillPrice: number | null;
      fillFee: number | null;
      feeAsset: "BASE" | "QUOTE" | "UNKNOWN" | null;
      remainingQuantity: number | null;
      closeOrderId?: string;
      reason?: string;
    };
  }

  const exitForensicsSnapshot = recordClosedTradeForensics({
    reason: input.reason,
    closePrice: settledFillPrice,
    quantity: settledQty,
    openFee,
    closeFee: settledFillFee,
    slippageCost: spreadCostAttribution,
    decisionTimestamp,
  });
  const createdCloseOrder = persistedOrder;
  let paperClosePersistence: { persisted: boolean; skipped: boolean; reason?: string } = {
    persisted: false,
    skipped: false,
  };
  const closeSimulationId = String(
    (closeOrder.metadata as Record<string, unknown> | undefined)?.simulationId ??
      (closeOrder as { simulationId?: unknown }).simulationId ??
      "",
  ).trim();
  if (input.mode === "paper") {
    paperClosePersistence = await persistPaperCloseFillForSettlement({
      executionId: input.executionId,
      userId: position.userId,
      symbol,
      quantity: finalCloseQty,
      avgFillPrice: closeFillPrice,
      fee: closeFee,
      simulationId: closeSimulationId || null,
      campaignId: String(positionMeta.campaignId ?? ""),
      candidateId: String(positionMeta.candidateId ?? ""),
      orderId: createdCloseOrder.id,
      positionId: position.id,
      runId: String(positionMeta.runId ?? ""),
      roundId: String(positionMeta.roundId ?? ""),
    });
  }

  await logTradeEvent({
    positionId: position.id,
    symbol,
    eventType: "SELL_COMPLETED",
    price: exitPrice,
    newValue: {
      closeOrderId: createdCloseOrder.id,
      quantity: finalCloseQty,
      closeReason: input.reason,
    },
    reason: input.reason,
  });
  await notifySystemEvent({
    userId: position.userId,
    eventType: "SELL",
    title: "SELL islemi",
    message: `${symbol} satildi (neden=${input.reason})`,
    level: "INFO",
    symbol,
  });

  await logTradeEvent({
    positionId: position.id,
    symbol,
    eventType: "PNL_CALCULATED",
    price: exitPrice,
    newValue: {
      netPnl: pnl.netPnl,
      realizedPnl: pnl.realizedPnl,
      feeTotal: pnl.feeTotal,
    },
    reason: input.reason,
  });
  const setupSnapshot = buildSetupFeatureSnapshot(positionMeta);
  const outcome = classifyNetExitOutcome(pnl.roePercent);
  const feedbackLearning = await recordFeedbackLearning({
    position,
    symbol,
    exitPrice,
    realizedPnl: pnl.realizedPnl,
    returnPercent: pnl.roePercent,
    closeReason: input.reason,
    mode: input.mode,
  });
  await calibrateAIAnalysisFromTrade({
    userId: position.userId,
    symbol,
    side: position.side,
    maxDurationSec: optionalNumber(positionMeta.maxDurationSec),
    marketRegime: setupSnapshot.marketRegime,
    strategy: setupSnapshot.marketRegimeStrategy,
    confidence: optionalNumber(positionMeta.aiConfidence ?? positionMeta.confidence),
    returnPercent: pnl.roePercent,
    executionId: String(positionMeta.executionId ?? input.executionId),
    closeReason: input.reason,
    metadata: positionMeta,
  });
  const postTradeOrchestration = await persistOrchestrationEnvelope({
    decision: {
      userId: position.userId,
      idempotencyKey: `orch:POST_TRADE:${position.id}`,
      executionId: input.executionId,
      tradeId: position.id,
      positionId: position.id,
      symbol,
      mode: input.mode,
      decisionStage: "POST_TRADE",
      action: isSuccessfulNetExit(pnl.roePercent) ? "ALLOW" : pnl.roePercent <= -1 ? "SUPPRESS" : "CAUTION",
      strategy: setupSnapshot.marketRegimeStrategy ?? "UNKNOWN_STRATEGY",
      marketRegime: setupSnapshot.marketRegime,
      regimeLifecyclePhase: String(positionMeta.regimeLifecyclePhase ?? "UNKNOWN"),
      confidenceOriginal: optionalNumber(positionMeta.aiConfidence ?? positionMeta.confidence),
      confidenceAdjusted: optionalNumber(positionMeta.orchestrationConfidenceAdjusted ?? positionMeta.aiConfidence ?? positionMeta.confidence),
      confidencePenalty: optionalNumber(positionMeta.orchestrationConfidencePenalty) ?? 0,
      riskMultiplier: optionalNumber(positionMeta.orchestrationRiskMultiplier) ?? 1,
      suppressionScore: optionalNumber(positionMeta.orchestrationSuppressionScore) ?? (pnl.roePercent < 0 ? 65 : 20),
      orchestrationScore: optionalNumber(positionMeta.orchestrationScore) ?? Math.max(0, 70 + pnl.roePercent * 4),
      uncertaintyScore: optionalNumber(positionMeta.orchestrationUncertaintyScore) ?? 0,
      edgeHealthScore: optionalNumber(positionMeta.orchestrationEdgeHealthScore),
      clusterRiskScore: optionalNumber(positionMeta.orchestrationClusterRiskScore),
      vetoLayer: pnl.roePercent < 0 ? "POST_TRADE_FORENSIC" : undefined,
      vetoReasons: pnl.roePercent < 0 ? [`Loss outcome after ${input.reason}`] : [],
      reasonMap: {
        postTrade: [
          `outcome=${outcome}`,
          `roe=${pnl.roePercent.toFixed(4)}`,
          `closeReason=${input.reason}`,
        ],
      },
      forensicReport: {
        pnl,
        outcome,
        setupSnapshot,
        feedbackLearning,
        closeOrderId: createdCloseOrder.id,
      },
      adaptiveActions: pnl.roePercent < 0
        ? [
            {
              actionType: "RISK_REDUCTION",
              scope: "symbol",
              targetKey: symbol,
              reason: "Post-trade loss reduced near-term risk appetite",
              confidence: Math.min(92, Math.abs(pnl.roePercent) * 20 + 45),
              sizeMultiplier: 0.82,
              riskMultiplier: 0.86,
            },
          ]
        : [],
      metadata: {
        positionMeta,
        createdCloseOrderId: createdCloseOrder.id,
        feedbackLearning,
      },
    },
  });
  await logTradeEvent({
    positionId: position.id,
    symbol,
    eventType: "SETUP_OUTCOME_RECORDED",
    price: exitPrice,
    newValue: {
      outcome,
      netPnl: pnl.netPnl,
      marketRegime: setupSnapshot.marketRegime,
      strategy: setupSnapshot.marketRegimeStrategy,
      entryType: setupSnapshot.entryType,
      confirmationStatus: setupSnapshot.confirmationStatus,
      qualityScore: setupSnapshot.qualityScore,
      qualityTier: setupSnapshot.qualityTier,
      ruleTags: setupSnapshot.ruleTags,
      features: setupSnapshot.features,
      feedbackLearning:
        feedbackLearning && "learningReport" in feedbackLearning
          ? {
              outcome: feedbackLearning.learningReport.outcome,
              setupStatus: feedbackLearning.setupStats.status,
              adaptiveConfidenceScore: feedbackLearning.setupStats.adaptiveConfidenceScore,
            }
          : feedbackLearning,
      postTradeOrchestration,
    },
    reason: input.reason,
  });

  await addSystemLog({
    level: "INFO",
    source: "execution-settlement",
    message: `${symbol} position closed (${input.reason}) pnl=${pnl.netPnl}`,
    context: {
      positionId: position.id,
      closeOrderId: createdCloseOrder.id,
      mode: input.mode,
      outcome,
      successfulNetExit: isSuccessfulNetExit(pnl.roePercent),
      minimumNetRoePercent: 0.5,
      lossScenario: pnl.netPnl < 0 ? input.reason : undefined,
      ruleTags: Array.isArray((position.metadata as Record<string, unknown> | null)?.ruleTags)
        ? (position.metadata as Record<string, unknown>).ruleTags
        : [],
      feedbackLearning:
        feedbackLearning && "learningReport" in feedbackLearning
          ? {
              outcome: feedbackLearning.learningReport.outcome,
              setupStatus: feedbackLearning.setupStats.status,
            }
          : feedbackLearning,
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
      userId: position.userId,
      campaignId: String(positionMeta.campaignId ?? ""),
      runId: String(positionMeta.runId ?? ""),
      roundId: String(positionMeta.roundId ?? ""),
      candidateId: String(positionMeta.candidateId ?? ""),
      closeSimulationId: closeSimulationId || null,
      paperFillPersisted: paperClosePersistence.persisted,
      paperFillPersistenceSkipped: paperClosePersistence.skipped,
      paperFillPersistenceReason: paperClosePersistence.reason ?? null,
      pnl,
      tradeSummary: {
        symbol,
        side: position.side,
        entryPrice: position.entryPrice,
        exitPrice,
        quantity: finalCloseQty,
        netPnl: pnl.netPnl,
        roePercent: pnl.roePercent,
        outcome,
        successfulNetExit: isSuccessfulNetExit(pnl.roePercent),
        closeReason: input.reason,
        feedbackLearning:
          feedbackLearning && "learningReport" in feedbackLearning
            ? {
                outcome: feedbackLearning.learningReport.outcome,
                setupStatus: feedbackLearning.setupStats.status,
                adaptiveConfidenceScore: feedbackLearning.setupStats.adaptiveConfidenceScore,
              }
            : feedbackLearning,
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
    status: "APPLIED",
    positionId: position.id,
    settlementFillId: canonicalSettlementFillId,
    tradeOrderId: createdCloseOrder.id,
    executionRef: closeOrder.orderId,
    executedQuantity: settledQty,
    fillPrice: settledFillPrice,
    fillFee: settledFillFee,
    feeAsset: settledFeeAsset,
    orderTerminal: true,
    orderRemainingQuantity: 0,
    positionRemainingQuantity: 0,
    positionClosed: true,
    partial: false,
    closed: true,
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
