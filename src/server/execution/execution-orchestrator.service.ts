import { randomUUID } from "node:crypto";
import { env } from "@/lib/config";
import { logger } from "@/lib/logger";
import { pushLog } from "@/services/log.service";
import {
  calculateValidQuantity,
  cancelOrder,
  estimateFees,
  getAccountBalances,
  getTicker,
  getOrderStatus,
  placeLimitBuy,
  placeLimitSell,
  placeMarketBuy,
  placeMarketBuyByQuote,
  placeMarketSell,
  resolveExchangeSymbol,
} from "@/services/binance.service";
import {
  calculateGlobalValidQuantity,
  getGlobalTicker,
  isGlobalLeverageEnabled,
  placeGlobalMarketBuy,
  placeGlobalMarketSell,
  toGlobalLeverageSymbol,
} from "@/services/binance-global.service";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { addSystemLog } from "@/src/server/repositories/log.repository";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import {
  getScannerWorkerSnapshot,
  pauseScannerWorker,
  pauseScannerWorkerUntilResume,
  resumeScannerWorker,
  runScannerPipeline,
} from "@/src/server/scanner";
import { formatAIRequest } from "@/src/server/scanner/ai-request-formatter";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import {
  addTradeExecution,
  attachOrderToPosition,
  createPosition,
  createTradeOrder,
  createTradeSignalFromConsensus,
  ensureTradingPair,
  findTradeOrderById,
  findLatestClosedPositionBySymbol,
  getEmergencyStopState,
  getExecutionPolicySetting,
  getPositionById,
  getRuntimeExecutionContext,
  listOpenPositionsByUser,
  setEmergencyStopState,
  updateOrderStatus,
  updatePositionMarkPrice,
} from "@/src/server/repositories/execution.repository";
import { validatePreTrade } from "@/src/server/execution/order-validation.layer";
import {
  evaluatePreTradeRisk,
  evaluateRuntimeRisk,
  getEffectiveRiskConfig,
  pauseSystemByRisk,
  registerApiFailure,
  resetApiFailure,
  resumeSystem,
} from "@/src/server/risk";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import { logTradeLifecycle } from "@/src/server/observability/trade-lifecycle";
import { publishExecutionEvent } from "@/src/server/execution/execution-event-bus";
import {
  isPositionMonitorActive,
  startPositionMonitor,
  stopAllPositionMonitors,
  stopPositionMonitor,
} from "@/src/server/execution/position-monitor.service";
import { buildInitialSmartExitPlan } from "@/src/server/execution/smart-exit-engine.service";
import { settleOpenPosition, syncUnrealizedPnl } from "@/src/server/execution/post-trade-settlement.service";
import { evaluateSignalQualityGate } from "@/src/server/execution/signal-quality-gate.service";
import { evaluateSmartEntryEngine } from "@/src/server/execution/smart-entry-engine.service";
import { resolvePartialTakeProfitPlan, resolveSmartTakeProfitPercent } from "@/src/server/execution/smart-targeting.service";
import { toAppError } from "@/src/server/errors/app-error";
import { ExternalServiceError } from "@/src/server/errors";
import { evaluateAdaptiveCandidate } from "@/src/server/metrics/self-optimization.service";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";
import type { ExecuteTradeInput, ExecutionResult, PositionCloseReason, SelectedTradeOpportunity, TradingMode } from "@/src/server/execution/types";
import type { ScannerCandidate } from "@/src/types/scanner";
import {
  getIdempotentExecution,
  getSafeModeState,
  persistAnalysisState,
  setIdempotentExecution,
} from "@/src/server/recovery/failsafe-recovery.service";
import { executePaperOpenOrder } from "@/src/server/simulation/paper-trading.service";

function mapOrderStatus(raw: string): "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" {
  const upper = raw.toUpperCase();
  if (upper.includes("PARTIALLY")) return "PARTIALLY_FILLED";
  if (upper.includes("FILLED") || upper.includes("SIMULATED")) return "FILLED";
  if (upper.includes("CANCELED")) return "CANCELED";
  if (upper.includes("EXPIRED")) return "EXPIRED";
  if (upper.includes("REJECT")) return "REJECTED";
  return "NEW";
}

async function settlePendingOrderStatus(input: {
  symbol: string;
  exchangeOrderId?: string;
  initialStatus: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED";
  isMarketOrder: boolean;
  initialExecutedQty: number;
  mode: TradingMode;
}) {
  const initialExecutedQty = Number(input.initialExecutedQty ?? 0);
  let latestExecutedQty = Number.isFinite(initialExecutedQty) && initialExecutedQty > 0 ? initialExecutedQty : 0;
  if (input.mode !== "live") return { status: input.initialStatus, executedQty: latestExecutedQty };
  if (!input.exchangeOrderId) return { status: input.initialStatus, executedQty: latestExecutedQty };
  if (input.isMarketOrder && latestExecutedQty > 0) return { status: "FILLED" as const, executedQty: latestExecutedQty };
  if (input.initialStatus !== "NEW" && input.initialStatus !== "PARTIALLY_FILLED") {
    return { status: input.initialStatus, executedQty: latestExecutedQty };
  }

  // Binance TR can return NEW for a very short window even for MARKET orders.
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    try {
      const statusRow = await getOrderStatus(input.symbol, input.exchangeOrderId);
      const executedQty = Number((statusRow as Record<string, unknown>).executedQty ?? 0);
      if (Number.isFinite(executedQty) && executedQty > 0) {
        latestExecutedQty = Math.max(latestExecutedQty, executedQty);
      }
      if (input.isMarketOrder && executedQty > 0) {
        return { status: "FILLED" as const, executedQty: latestExecutedQty };
      }
      const raw = String((statusRow as Record<string, unknown>).status ?? "");
      const mapped = mapOrderStatus(raw);
      if (mapped !== "NEW" && mapped !== "PARTIALLY_FILLED") {
        return { status: mapped, executedQty: latestExecutedQty };
      }
    } catch (error) {
      logger.warn(
        {
          symbol: input.symbol,
          orderId: input.exchangeOrderId,
          attempt: i + 1,
          error: (error as Error)?.message ?? "unknown",
        },
        "Pending order polling failed",
      );
    }
  }
  // Do not force FILLED when exchange confirmation is unavailable.
  // This prevents phantom trades in UI when exchange never confirms execution.
  return { status: input.initialStatus, executedQty: latestExecutedQty };
}

function getMode(): TradingMode {
  return env.EXECUTION_MODE;
}

function resolveTpSl(entryPrice: number, side: "BUY" | "SELL", takeProfitPercent: number, stopLossPercent: number) {
  if (side === "BUY") {
    return {
      takeProfitPrice: Number((entryPrice * (1 + takeProfitPercent / 100)).toFixed(8)),
      stopLossPrice: Number((entryPrice * (1 - stopLossPercent / 100)).toFixed(8)),
    };
  }
  return {
    takeProfitPrice: Number((entryPrice * (1 - takeProfitPercent / 100)).toFixed(8)),
    stopLossPrice: Number((entryPrice * (1 + stopLossPercent / 100)).toFixed(8)),
  };
}

function isRateLimitOrCooldownErrorMessage(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("http 429") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit") ||
    lower.includes("cooldown active until") ||
    lower.includes("circuit is open for exchange:getaccountbalances")
  );
}

function isTrMinNotionalError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("code=3210") ||
    lower.includes("total volume is too low") ||
    lower.includes("notional below min")
  );
}

function resolveDurationWindowByProfit(expectedProfitPercent: number) {
  const minProfit = env.EXECUTION_TARGET_MIN_PROFIT_PERCENT;
  const highProfit = Math.max(minProfit + 0.5, env.EXECUTION_TARGET_HIGH_PROFIT_PERCENT);
  const shortWindow = env.EXECUTION_TARGET_SHORT_WINDOW_SEC;
  const longWindow = Math.max(shortWindow, env.EXECUTION_TARGET_LONG_WINDOW_SEC);
  const effective = Math.max(minProfit, Math.min(expectedProfitPercent, highProfit));
  if (effective <= minProfit) return shortWindow;
  if (effective >= highProfit) return longWindow;
  return Math.round(shortWindow + ((effective - minProfit) / Math.max(highProfit - minProfit, 0.0001)) * (longWindow - shortWindow));
}

function computeRoundTripCostPercent(leverageMultiplier: number) {
  const feePercentBase = env.BINANCE_TAKER_FEE_RATE * 100 * 2;
  const leverageCostMultiplier = leverageMultiplier > 1 ? 1.3 : 1;
  return feePercentBase * leverageCostMultiplier;
}

function validateProfitEdgeGate(input: {
  takeProfitPercent: number;
  stopLossPercent: number;
  spreadPercent: number;
  leverageMultiplier: number;
}) {
  const rrRatio =
    input.stopLossPercent > 0
      ? Number((input.takeProfitPercent / input.stopLossPercent).toFixed(4))
      : 0;
  const roundTripCostPercent = computeRoundTripCostPercent(input.leverageMultiplier);
  const rawTradingCostPercent = Math.max(0, input.spreadPercent) + roundTripCostPercent;
  const requiredMinProfitPercent = Number((rawTradingCostPercent * env.EXECUTION_MIN_EDGE_MULTIPLIER).toFixed(4));
  const passRr = rrRatio >= env.EXECUTION_MIN_RR_RATIO;
  const passEdge = input.takeProfitPercent >= requiredMinProfitPercent;
  return {
    pass: passRr && passEdge,
    rrRatio,
    requiredMinProfitPercent,
    roundTripCostPercent,
  };
}

function isUltraPrecisionConsensus(candidate: ScannerCandidate, minConfidence: number, maxRisk: number) {
  if (!env.AI_ULTRA_PRECISION_MODE) return true;
  const ai = candidate.ai;
  if (!ai) return false;
  if (ai.finalDecision !== "BUY" && ai.finalDecision !== "SELL") return false;
  if (ai.finalConfidence < minConfidence) return false;
  if (ai.finalRiskScore > maxRisk) return false;
  const outputs = ai.outputs?.filter((x) => x.ok && x.output).map((x) => x.output!.decision) ?? [];
  if (outputs.length < 3) return false;
  if (!outputs.every((x) => x === ai.finalDecision)) return false;
  const shortMomentum = Number(candidate.context.metadata.shortMomentumPercent ?? 0);
  const shortFlow = Number(candidate.context.metadata.shortFlowImbalance ?? 0);
  const aligned =
    ai.finalDecision === "BUY"
      ? shortMomentum > 0 && shortFlow > 0.05
      : shortMomentum < 0 && shortFlow < -0.05;
  if (!aligned) return false;
  return true;
}

function resolveAiTargetProfile(
  ai: ScannerCandidate["ai"] | undefined,
  lastPrice: number,
  side: "BUY" | "SELL",
) {
  const outputs = ai?.outputs
    ?.filter((x) => x.ok && x.output)
    .map((x) => x.output!)
    .filter((x) => Number.isFinite(x.targetPrice ?? NaN) && Number.isFinite(x.estimatedDurationSec) && x.estimatedDurationSec > 0);
  if (!outputs || outputs.length === 0 || !Number.isFinite(lastPrice) || lastPrice <= 0) return null;

  const directional = outputs.filter((x) => x.decision === side);
  const effective = directional.length > 0 ? directional : outputs;
  const profits = effective
    .map((x) => {
      const target = Number(x.targetPrice ?? 0);
      if (!Number.isFinite(target) || target <= 0) return null;
      const raw = side === "BUY" ? ((target - lastPrice) / lastPrice) * 100 : ((lastPrice - target) / lastPrice) * 100;
      return Number.isFinite(raw) ? raw : null;
    })
    .filter((x): x is number => Number.isFinite(x));
  const durations = effective
    .map((x) => Number(x.estimatedDurationSec))
    .filter((x) => Number.isFinite(x) && x > 0);
  if (profits.length === 0 || durations.length === 0) return null;

  const expectedProfitPercent = Number((profits.reduce((acc, x) => acc + x, 0) / profits.length).toFixed(4));
  const suggestedDurationSec = Math.round(durations.reduce((acc, x) => acc + x, 0) / durations.length);
  const allowedDurationSec = resolveDurationWindowByProfit(expectedProfitPercent);
  const minProfit = env.EXECUTION_TARGET_MIN_PROFIT_PERCENT;
  const maxProfit = env.EXECUTION_TARGET_MAX_PROFIT_PERCENT;
  const eligible =
    expectedProfitPercent >= minProfit &&
    expectedProfitPercent <= maxProfit &&
    suggestedDurationSec <= allowedDurationSec;

  return {
    expectedProfitPercent,
    suggestedDurationSec,
    allowedDurationSec,
    eligible,
  };
}

async function shouldExtendForMomentum(symbol: string, side: "LONG" | "SHORT") {
  const context = await buildMarketContext(symbol);
  const shortMomentum = Number(context.metadata.shortMomentumPercent ?? 0);
  const shortFlow = Number(context.metadata.shortFlowImbalance ?? 0);
  const score = scoreContext(context);
  if (score.status !== "QUALIFIED") return false;
  const runtimeStrategy = await getRuntimeStrategyParams();
  const aiInput = await formatAIRequest(
    context,
    {
      scannerScore: score.score,
      ...runtimeStrategy,
      openPositionCount: 0,
      hasOpenPosition: false,
      sameCoinCooldownActive: false,
      capitalRiskPercent: 0.8,
      // Bu stage'de order filter sonucu yok; AI-3 belirsizligi caution olarak gorsun.
      lotSizeOk: null,
      minNotionalOk: null,
      quantityOk: null,
      feeNetAmountOk: null,
    },
    undefined,
  );
  const ai = await runAIConsensusFromInput(aiInput);
  if (ai.rejected || ai.finalConfidence < env.EXECUTION_FAST_MIN_CONFIDENCE) return false;
  const bullish = shortMomentum > 0 && shortFlow > 0;
  const bearish = shortMomentum < 0 && shortFlow < 0;
  if (side === "LONG") return ai.finalDecision === "BUY" && bullish;
  return ai.finalDecision === "SELL" && bearish;
}

function normalizeMonitorDurationSec(raw: number) {
  const fallback = env.EXECUTION_DEFAULT_MAX_DURATION_SEC;
  const value = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  return Math.max(120, Math.min(env.EXECUTION_TARGET_LONG_WINDOW_SEC, value));
}

function buildRuleTags(input: {
  aiConfidence: number;
  aiRiskScore: number;
  spreadPercent: number;
  volatilityPercent: number;
  qualityScore: number;
}) {
  const tags: string[] = [];
  if (input.aiConfidence >= 90) tags.push("high_confidence");
  if (input.aiRiskScore <= 35) tags.push("low_risk_ai");
  if (input.spreadPercent <= 0.1) tags.push("tight_spread");
  if (input.volatilityPercent > 1.6 && input.volatilityPercent < env.EXECUTION_BLOCK_HIGH_VOLATILITY_PERCENT) tags.push("healthy_volatility");
  if (input.qualityScore >= 70) tags.push("quality_setup");
  return tags;
}

function readMarketRegimeMeta(candidate: ScannerCandidate) {
  const mode = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
  const reason = String(candidate.context.metadata.marketRegimeReason ?? "regime-not-specified");
  const strategy = String(candidate.context.metadata.marketRegimeStrategy ?? "RANGE_MEAN_REVERSION");
  const openAllowed = Boolean(candidate.context.metadata.marketRegimeOpenTradeAllowed ?? true);
  const tpMultiplier = Number(candidate.context.metadata.marketRegimeTpMultiplier ?? 1);
  const slMultiplier = Number(candidate.context.metadata.marketRegimeSlMultiplier ?? 1);
  const riskMultiplier = Number(candidate.context.metadata.marketRegimeRiskMultiplier ?? 1);
  return { mode, reason, strategy, openAllowed, tpMultiplier, slMultiplier, riskMultiplier };
}

function resolveNoTradeReasons(input: {
  candidate: ScannerCandidate;
  confidence: number;
  decision: "BUY" | "SELL" | "HOLD" | "NO_TRADE";
}) {
  const reasons: string[] = [];
  const { candidate } = input;
  const shortMomentum = Number(candidate.context.metadata.shortMomentumPercent ?? 0);
  const shortFlow = Number(candidate.context.metadata.shortFlowImbalance ?? 0);
  const marketRegime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
  const marketRegimeReason = String(candidate.context.metadata.marketRegimeReason ?? "");
  const timeframe = candidate.ai?.decisionPayload?.timeframeAnalysis;
  const roleDecisions = (candidate.ai?.roleScores ?? []).map((x) => x.decision);
  const uniqueRoleDecisions = new Set(roleDecisions.filter((x) => x === "BUY" || x === "SELL"));
  const conflictingSignals = uniqueRoleDecisions.size > 1;

  const uncertainMarket =
    marketRegime === "RANGE_SIDEWAYS" &&
    Math.abs(shortMomentum) < 0.08 &&
    Math.abs(shortFlow) < 0.03;
  if (uncertainMarket) {
    reasons.push("Piyasa belirsiz (range + dusuk momentum/akis)");
  }
  if (conflictingSignals || timeframe?.conflict || !timeframe?.trendAligned || !timeframe?.entrySuitable) {
    reasons.push("Sinyal cakismasi (AI katmanlari veya timeframe uyumsuz)");
  }
  if (candidate.context.volatilityPercent >= env.EXECUTION_BLOCK_HIGH_VOLATILITY_PERCENT) {
    reasons.push(`Volatilite asiri (${candidate.context.volatilityPercent.toFixed(3)}%)`);
  }
  if (candidate.context.volume24h < env.SCANNER_MIN_VOLUME_24H) {
    reasons.push(`Hacim dusuk (${candidate.context.volume24h.toFixed(2)})`);
  }
  if (input.decision !== "BUY" && input.decision !== "SELL") {
    reasons.push(`AI karari trade acmaya uygun degil (${input.decision})`);
  }
  if (input.confidence < env.EXECUTION_FAST_MIN_CONFIDENCE) {
    reasons.push(`Guven skoru dusuk (${input.confidence.toFixed(2)} < ${env.EXECUTION_FAST_MIN_CONFIDENCE})`);
  }
  if (marketRegime === "LOW_VOLUME_DEAD_MARKET" || marketRegime === "HIGH_VOLATILITY_CHAOS" || marketRegime === "NEWS_DRIVEN_UNSTABLE") {
    reasons.push(`Market regime korumasi aktif (${marketRegime}${marketRegimeReason ? `: ${marketRegimeReason}` : ""})`);
  }
  const noTradeModeReasons = candidate.ai?.decisionPayload?.noTradeMode?.reasonList ?? [];
  if (noTradeModeReasons.length > 0) {
    reasons.push(...noTradeModeReasons.map((x) => `No-trade mode: ${x}`));
  }
  return Array.from(new Set(reasons));
}

function evaluateSmartEntryGate(input: {
  candidate: ScannerCandidate;
  ai: ScannerCandidate["ai"];
  side: "BUY" | "SELL";
  entryPrice: number;
  takeProfitPercent: number;
  stopLossPercent: number;
}) {
  if (!env.EXECUTION_SMART_ENTRY_ENABLED) {
    return { pass: true, reason: "smart-entry-disabled", details: null };
  }
  const ai = input.ai;
  if (!ai) return { pass: false, reason: "AI unavailable for smart entry", details: null };

  const smartEntry = evaluateSmartEntryEngine({
    candidate: input.candidate,
    ai,
    side: input.side,
    entryPrice: input.entryPrice,
    takeProfitPercent: input.takeProfitPercent,
    stopLossPercent: input.stopLossPercent,
  });
  if (!smartEntry.proceed) {
    return {
      pass: false,
      reason: smartEntry.reasons[0] ?? "Smart entry engine blocked",
      details: smartEntry,
    };
  }
  return {
    pass: true,
    reason: "Smart entry engine confirmed",
    details: smartEntry,
  };
}

async function resolveDynamicExitReason(input: {
  symbol: string;
  side: "LONG" | "SHORT";
}): Promise<PositionCloseReason | null> {
  const context = await buildMarketContext(input.symbol);
  const shortMomentum = Number(context.metadata.shortMomentumPercent ?? 0);
  const shortFlow = Number(context.metadata.shortFlowImbalance ?? 0);
  const fade = env.EXECUTION_MOMENTUM_FADE_THRESHOLD;
  if (input.side === "LONG" && shortMomentum <= -fade && shortFlow <= -0.03) {
    return "MOMENTUM_FADE";
  }
  if (input.side === "SHORT" && shortMomentum >= fade && shortFlow >= 0.03) {
    return "MOMENTUM_FADE";
  }

  const runtimeStrategy = await getRuntimeStrategyParams();
  const aiInput = await formatAIRequest(
    context,
    {
      source: "dynamic-exit",
      ...runtimeStrategy,
    },
    undefined,
  );
  const ai = await runAIConsensusFromInput(aiInput);
  if (ai.rejected || ai.finalConfidence < env.EXECUTION_REVERSE_SIGNAL_MIN_CONFIDENCE) return null;
  if (input.side === "LONG" && ai.finalDecision === "SELL") return "REVERSE_SIGNAL";
  if (input.side === "SHORT" && ai.finalDecision === "BUY") return "REVERSE_SIGNAL";
  return null;
}

async function attachPositionMonitor(input: {
  executionId: string;
  userId: string;
  positionId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  openedAt: string;
  entryPrice: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  maxDurationSec: number;
  partialTpPlan?: {
    enabled?: boolean;
    firstTargetPercent?: number;
    trailingDrawdownPercent?: number;
  };
  mode: TradingMode;
  source: "OPEN" | "RECOVERY";
  smartExitState?: {
    lastAdaptiveTp: number;
    peakProfitPercent: number;
    lastRegime: string;
  };
}) {
  let lastDynamicExitCheckAt = 0;
  let reverseSignalCache: { at: number; value: boolean } = { at: 0, value: false };
  startPositionMonitor({
    executionId: input.executionId,
    positionId: input.positionId,
    symbol: input.symbol,
    side: input.side,
    openedAt: input.openedAt,
    entryPrice: input.entryPrice,
    takeProfitPrice: input.takeProfitPrice,
    stopLossPrice: input.stopLossPrice,
    maxDurationSec: input.maxDurationSec,
    partialTpPlan: input.partialTpPlan,
    extensionStepSec: env.EXECUTION_TIMEOUT_EXTENSION_STEP_SEC,
    extensionMaxSec: env.EXECUTION_TIMEOUT_EXTENSION_MAX_SEC,
    smartExit: input.smartExitState ? { state: input.smartExitState } : undefined,
    onShouldExtend: async ({ symbol: monSymbol, side: monSide }) => {
      return shouldExtendForMomentum(monSymbol, monSide);
    },
    onDynamicExit: async ({ symbol: monSymbol, side: monSide }) => {
      const now = Date.now();
      if (now - lastDynamicExitCheckAt < 20_000) return null;
      lastDynamicExitCheckAt = now;
      const dynamicReason = await resolveDynamicExitReason({
        symbol: monSymbol,
        side: monSide,
      }).catch(() => null);
      reverseSignalCache = { at: Date.now(), value: dynamicReason === "REVERSE_SIGNAL" };
      return dynamicReason;
    },
    onReadExitSignals: async ({ symbol: monSymbol, side: monSide }) => {
      const context = await buildMarketContext(monSymbol);
      const now = Date.now();
      if (now - reverseSignalCache.at > 25_000) {
        const dynamicReason = await resolveDynamicExitReason({
          symbol: monSymbol,
          side: monSide,
        }).catch(() => null);
        reverseSignalCache = { at: now, value: dynamicReason === "REVERSE_SIGNAL" };
      }
      return {
        shortMomentumPercent: Number(context.metadata.shortMomentumPercent ?? 0),
        shortFlowImbalance: Number(context.metadata.shortFlowImbalance ?? 0),
        shortCandleSignal: Number(context.shortCandleSignal ?? 0),
        spreadPercent: Number(context.spreadPercent ?? 0),
        volatilityPercent: Number(context.volatilityPercent ?? 0),
        volume24h: Number(context.volume24h ?? 0),
        marketRegime: String(context.metadata.marketRegime ?? "RANGE_SIDEWAYS"),
        reverseSignal: reverseSignalCache.value,
      };
    },
    onTick: async ({ positionId }) => {
      const live = await syncUnrealizedPnl(positionId);
      if (!live) return;
      await updatePositionMarkPrice(positionId, live.markPrice, live.unrealizedPnl).catch(() => null);
      const runtimeRisk = await evaluateRuntimeRisk({ userId: input.userId, symbol: input.symbol }).catch(() => ({ shouldClose: false as const }));
      if (runtimeRisk.shouldClose) {
        const closeResult = await settleOpenPosition({
          executionId: input.executionId,
          positionId,
          reason: "RISK_BREAKER",
          mode: input.mode,
        }).catch(() => ({ closed: false as const }));
        if (closeResult?.closed) {
          stopPositionMonitor(positionId);
        } else {
          publishExecutionEvent({
            executionId: input.executionId,
            symbol: input.symbol,
            stage: "position-monitor",
            status: "RUNNING",
            message: "Runtime risk close basarisiz, monitor tekrar deneyecek",
            level: "WARN",
            context: {
              positionId,
              reason: "RISK_BREAKER",
            },
          });
        }
        if (runtimeRisk.message && runtimeRisk.pauseSystem) {
          await pauseSystemByRisk(input.userId, runtimeRisk.message, 10).catch(() => null);
        }
      }
    },
    onClose: async ({ executionId: id, positionId, reason }) => {
      return settleOpenPosition({
        executionId: id,
        positionId,
        reason,
        mode: input.mode,
      });
      if (reason === "STOP_LOSS" && env.EXECUTION_REENTRY_AFTER_LOSS) {
        setTimeout(() => {
          void executeAnalyzeAndTrade({
            userId: input.userId,
            maxDurationSec: env.EXECUTION_DEFAULT_MAX_DURATION_SEC,
          });
        }, Math.max(0, env.EXECUTION_REENTRY_COOLDOWN_SEC) * 1000);
      }
    },
  });
  pauseScannerWorkerUntilResume();
  publishExecutionEvent({
    executionId: input.executionId,
    symbol: input.symbol,
    stage: "position-monitor",
    status: "RUNNING",
    message:
      input.source === "RECOVERY"
        ? "Acik pozisyon monitoru yeniden baglandi"
        : "Pozisyon acik, scanner gecici olarak durduruldu",
    level: "INFO",
    context: {
      positionId: input.positionId,
      openedAt: input.openedAt,
      maxDurationSec: input.maxDurationSec,
      source: input.source,
    },
  });
}

let monitorRecoveryInFlight: Promise<void> | null = null;
let lastMonitorRecoveryAt = 0;
const MONITOR_RECOVERY_MIN_INTERVAL_MS = 8_000;

export async function ensureOpenPositionMonitors(userId?: string) {
  if (Date.now() - lastMonitorRecoveryAt < MONITOR_RECOVERY_MIN_INTERVAL_MS) return;
  if (monitorRecoveryInFlight) return monitorRecoveryInFlight;

  monitorRecoveryInFlight = (async () => {
    lastMonitorRecoveryAt = Date.now();
    const { user } = await getRuntimeExecutionContext(userId);
    const openPositions = await listOpenPositionsByUser(user.id);
    for (const position of openPositions) {
      if (isPositionMonitorActive(position.id)) continue;
      const metadata = (position.metadata as Record<string, unknown> | null) ?? {};
      const executionId =
        typeof metadata.executionId === "string" && metadata.executionId.length > 0
          ? metadata.executionId
          : `recovery-${position.id}`;
      const modeRaw = String(metadata.mode ?? env.EXECUTION_MODE);
      const mode: TradingMode =
        modeRaw === "paper" || modeRaw === "live" || modeRaw === "dry-run"
          ? modeRaw
          : env.EXECUTION_MODE;
      const maxDurationSec = normalizeMonitorDurationSec(
        Number(metadata.maxDurationSec ?? env.EXECUTION_DEFAULT_MAX_DURATION_SEC),
      );
      const partialTpPlanRaw =
        typeof metadata.partialTpPlan === "object" && metadata.partialTpPlan
          ? (metadata.partialTpPlan as Record<string, unknown>)
          : undefined;
      const tpRaw = Number(metadata.takeProfitPrice ?? 0);
      const slRaw = Number(metadata.stopLossPrice ?? 0);
      const smartExitStateRaw =
        typeof metadata.smartExitState === "object" && metadata.smartExitState
          ? (metadata.smartExitState as Record<string, unknown>)
          : undefined;
      await attachPositionMonitor({
        executionId,
        userId: user.id,
        positionId: position.id,
        symbol: position.tradingPair.symbol,
        side: position.side,
        openedAt: position.openedAt.toISOString(),
        entryPrice: position.entryPrice,
        takeProfitPrice: Number.isFinite(tpRaw) && tpRaw > 0 ? tpRaw : undefined,
        stopLossPrice: Number.isFinite(slRaw) && slRaw > 0 ? slRaw : undefined,
        maxDurationSec,
        smartExitState: smartExitStateRaw
          ? {
              lastAdaptiveTp: Number(smartExitStateRaw.lastAdaptiveTp ?? tpRaw ?? position.entryPrice),
              peakProfitPercent: Number(smartExitStateRaw.peakProfitPercent ?? 0),
              lastRegime: String(smartExitStateRaw.lastRegime ?? "RANGE_SIDEWAYS"),
            }
          : {
              lastAdaptiveTp: Number.isFinite(tpRaw) && tpRaw > 0 ? tpRaw : position.entryPrice,
              peakProfitPercent: 0,
              lastRegime: "RANGE_SIDEWAYS",
            },
        partialTpPlan: partialTpPlanRaw
          ? {
              enabled: Boolean(partialTpPlanRaw.enabled),
              firstTargetPercent: Number(partialTpPlanRaw.firstTargetPercent ?? 0),
              trailingDrawdownPercent: Number(partialTpPlanRaw.trailingDrawdownPercent ?? 0),
            }
          : undefined,
        mode,
        source: "RECOVERY",
      });
    }
  })()
    .catch((error) => {
      logger.warn({ error: (error as Error).message }, "Open position monitor recovery failed");
    })
    .finally(() => {
      monitorRecoveryInFlight = null;
    });

  return monitorRecoveryInFlight;
}

async function buildOpportunityForSymbol(symbol: string): Promise<SelectedTradeOpportunity | null> {
  const context = await buildMarketContext(symbol);
  const score = scoreContext(context);
  if (score.status !== "QUALIFIED" && score.score < 24) return null;
  if (context.fakeSpikeScore > 2.2 || context.spreadPercent > 0.18) return null;
  if (Math.abs(Number(context.metadata.shortFlowImbalance ?? 0)) < 0.03) return null;

  const runtimeStrategy = await getRuntimeStrategyParams();
  const aiInput = await formatAIRequest(context, { scannerScore: score.score, ...runtimeStrategy });
  const ai = await runAIConsensusFromInput(aiInput);
  const decision = ai.finalDecision;
  if (ai.finalConfidence < env.EXECUTION_FAST_MIN_CONFIDENCE || (decision !== "BUY" && decision !== "SELL")) {
    return null;
  }
  const targetProfile = resolveAiTargetProfile(ai, context.lastPrice, decision);
  if (!targetProfile?.eligible) return null;

  const candidate: ScannerCandidate = { rank: 1, context, score, ai };
  const side = decision;
  const entryPrice = context.lastPrice;
  const takeProfitPercent = Number(
    Math.max(env.EXECUTION_TARGET_MIN_PROFIT_PERCENT, Math.min(targetProfile.expectedProfitPercent, env.EXECUTION_TARGET_MAX_PROFIT_PERCENT)).toFixed(4),
  );
  const dynamicDurationSec = Math.max(
    env.EXECUTION_TARGET_SHORT_WINDOW_SEC,
    Math.min(env.EXECUTION_TARGET_LONG_WINDOW_SEC, targetProfile.suggestedDurationSec),
  );
  const { takeProfitPrice, stopLossPrice } = resolveTpSl(
    entryPrice,
    side,
    takeProfitPercent,
    env.EXECUTION_DEFAULT_STOP_LOSS_PERCENT,
  );

  return {
    candidate,
    ai,
    symbol: context.symbol,
    side,
    quantity: 0.01,
    entryType: "MARKET",
    entryPrice,
    takeProfitPrice,
    stopLossPrice,
    maxDurationSec: dynamicDurationSec,
  };
}

function pickBestCandidate(candidates: ScannerCandidate[], requestedSymbol?: string) {
  const tradable = candidates.filter(
    (x) =>
      x.ai &&
      !x.ai.rejected &&
      (x.ai.finalDecision === "BUY" || x.ai.finalDecision === "SELL") &&
      !(env.EXECUTION_MODE === "live" && env.BINANCE_PLATFORM === "tr" && x.ai.finalDecision !== "BUY"),
  );
  const profiled = tradable
    .map((candidate) => {
      const side = candidate.ai?.finalDecision === "SELL" ? "SELL" : "BUY";
      const profile = resolveAiTargetProfile(candidate.ai, candidate.context.lastPrice, side);
      return { candidate, profile };
    })
    .filter((row) => Boolean(row.profile?.eligible));

  const rankedTradable = [...profiled]
    .sort((a, b) => {
      const aTry = a.candidate.context.symbol.toUpperCase().endsWith("TRY") ? 1 : 0;
      const bTry = b.candidate.context.symbol.toUpperCase().endsWith("TRY") ? 1 : 0;
      if (env.BINANCE_PLATFORM === "tr" && aTry !== bTry) return bTry - aTry;
      const aScore = (a.candidate.ai?.finalConfidence ?? 0) + (a.profile?.expectedProfitPercent ?? 0) * 3;
      const bScore = (b.candidate.ai?.finalConfidence ?? 0) + (b.profile?.expectedProfitPercent ?? 0) * 3;
      return bScore - aScore;
    })
    .map((row) => row.candidate);

  if (requestedSymbol) {
    const matched = rankedTradable.find((x) => x.context.symbol === requestedSymbol.toUpperCase());
    if (matched) return matched;
  }
  if (rankedTradable[0]) return rankedTradable[0];
  return undefined;
}

export async function executeAnalyzeAndTrade(input: ExecuteTradeInput): Promise<ExecutionResult> {
  const executionId = randomUUID();
  const mode = getMode();
  markHeartbeat({ service: "execution", status: "UP", message: "Execution flow started", details: { executionId } });
  await logTradeLifecycle({
    executionId,
    stage: "start",
    status: "STARTED",
    message: "Analyze and trade started",
    context: { mode, symbol: input.requestedSymbol },
  });
  publishExecutionEvent({
    executionId,
    stage: "start",
    status: "RUNNING",
    message: "Analyze and trade akisi basladi",
    level: "INFO",
    context: { mode, requestedSymbol: input.requestedSymbol },
  });

  try {
    if (env.EXECUTION_MODE === "live" && (!env.BINANCE_API_KEY || !env.BINANCE_API_SECRET)) {
      throw new ExternalServiceError("Canli islem icin Binance API key/secret eksik.");
    }
    const { user, connection } = await getRuntimeExecutionContext(input.userId);
    const safeMode = await getSafeModeState(user.id);
    if (safeMode.enabled) {
      publishExecutionEvent({
        executionId,
        stage: "safe-mode",
        status: "FAILED",
        message: "Safe mode aktif, yeni islem acilamaz",
        level: "ERROR",
        context: {
          reason: safeMode.reason,
          requireManualAck: safeMode.requireManualAck,
        },
      });
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: safeMode.reason ?? "Safe mode active",
      };
    }
    await persistAnalysisState({
      userId: user.id,
      executionId,
      symbol: input.requestedSymbol,
      stage: "start",
      status: "RUNNING",
    });
    const idempotencyKey = String(
      input.requestedSymbol ?? "auto",
    ) + `:${String(input.requestedQuoteAmountTry ?? input.requestedQuantity ?? "default")}:${mode}`;
    const existing = await getIdempotentExecution(user.id, idempotencyKey);
    if (existing && typeof existing.executionId === "string") {
      return {
        executionId: String(existing.executionId),
        mode,
        opened: Boolean(existing.opened),
        rejected: Boolean(existing.rejected),
        rejectReason: typeof existing.rejectReason === "string" ? existing.rejectReason : undefined,
        symbol: typeof existing.symbol === "string" ? existing.symbol : undefined,
        orderId: typeof existing.orderId === "string" ? existing.orderId : undefined,
        positionId: typeof existing.positionId === "string" ? existing.positionId : undefined,
      };
    }
    await ensureOpenPositionMonitors(user.id).catch(() => null);
    const emergencyStopEnabled = await getEmergencyStopState(user.id);
    if (emergencyStopEnabled) {
      publishExecutionEvent({
        executionId,
        stage: "risk-gate",
        status: "FAILED",
        message: "Emergency stop aktif, trade reddedildi",
        level: "WARN",
      });
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Emergency stop enabled",
      };
    }
    const preOpenPositions = await listOpenPositionsByUser(user.id);
    if (env.EXECUTION_BLOCK_WHEN_OPEN_POSITION && preOpenPositions.length > 0) {
      publishExecutionEvent({
        executionId,
        stage: "risk-gate",
        status: "SKIPPED",
        message: "Acik pozisyon varken yeni analiz/trade engellendi",
        level: "WARN",
        context: {
          openPositionCount: preOpenPositions.length,
          symbols: preOpenPositions.map((x) => x.tradingPair.symbol),
          rule: "single-open-position",
        },
      });
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Açık pozisyon varken yeni analiz başlatılmaz.",
      };
    }

    publishExecutionEvent({
      executionId,
      stage: "scanner",
      status: "RUNNING",
      message: "Scanner calisiyor",
      level: "INFO",
    });
    await persistAnalysisState({
      userId: user.id,
      executionId,
      symbol: input.requestedSymbol,
      stage: "scanner",
      status: "RUNNING",
    });
    const snapshot = getScannerWorkerSnapshot();
    const snapshotAgeMs = snapshot.updatedAt ? Date.now() - new Date(snapshot.updatedAt).getTime() : Number.POSITIVE_INFINITY;
    const useSnapshot = Boolean(snapshot.detailed && snapshotAgeMs < 60_000 && snapshot.detailed.candidates.length > 0);
    const scanner = useSnapshot
      ? snapshot.detailed!
      : await runScannerPipeline(user.id, { includeAi: true, persistRejected: true, persist: true });

    let selected = pickBestCandidate(scanner.candidates, input.requestedSymbol);
    if (!selected && input.requestedSymbol) {
      const custom = await buildOpportunityForSymbol(input.requestedSymbol);
      if (custom) {
        selected = custom.candidate;
      }
    }

    if (!selected || !selected.ai) {
      publishExecutionEvent({
        executionId,
        stage: "selection",
        status: "SKIPPED",
        message: "Tradeable aday bulunamadi (NO_TRADE)",
        level: "SIGNAL",
      });
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "No tradeable candidate after scanner+AI",
      };
    }

    const ai = selected.ai;
    const noTradeReasons = resolveNoTradeReasons({
      candidate: selected,
      confidence: ai.finalConfidence,
      decision: ai.finalDecision,
    });
    if (noTradeReasons.length > 0) {
      publishExecutionEvent({
        executionId,
        symbol: selected.context.symbol,
        stage: "no-trade-gate",
        status: "SKIPPED",
        message: "Piyasa kosullari nedeniyle islem acilmadi",
        level: "WARN",
        context: {
          noTradeReasons,
          confidence: ai.finalConfidence,
          decision: ai.finalDecision,
          volatilityPercent: selected.context.volatilityPercent,
          volume24h: selected.context.volume24h,
        },
      });
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `NO_TRADE: ${noTradeReasons.join(" | ")}`,
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
        details: {
          noTradeReasons,
          noTradeMode: selected.ai?.decisionPayload?.noTradeMode,
          confidence: ai.finalConfidence,
          volatilityPercent: selected.context.volatilityPercent,
          volume24h: selected.context.volume24h,
        },
      };
    }
    const marketRegime = readMarketRegimeMeta(selected);
    if (!marketRegime.openAllowed) {
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `Market regime block: ${marketRegime.mode} (${marketRegime.reason})`,
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
      };
    }
    if (marketRegime.mode === "HIGH_VOLATILITY_CHAOS" || marketRegime.mode === "NEWS_DRIVEN_UNSTABLE") {
      if (selected.context.spreadPercent > 0.12 || selected.context.fakeSpikeScore > 1.8 || ai.finalConfidence < 94) {
        return {
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: "High volatility defensive gate: spread/wick/confidence uygun degil.",
          symbol: selected.context.symbol,
          decision: ai.finalDecision,
        };
      }
    }
    if (marketRegime.mode === "STRONG_BEARISH_TREND" || marketRegime.mode === "WEAK_BEARISH_TREND") {
      const shortMomentum = Number(selected.context.metadata.shortMomentumPercent ?? 0);
      const shortFlow = Number(selected.context.metadata.shortFlowImbalance ?? 0);
      if (!(shortMomentum > 0.12 && shortFlow > 0.04 && ai.finalDecision === "BUY")) {
        return {
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: "Bear regime: sadece guclu bounce setup kabul edilir.",
          symbol: selected.context.symbol,
          decision: ai.finalDecision,
        };
      }
    }
    const qualityGate = evaluateSignalQualityGate({ candidate: selected, ai });
    if (!qualityGate.ok) {
      publishExecutionEvent({
        executionId,
        symbol: selected.context.symbol,
        stage: "quality-gate",
        status: "SKIPPED",
        message: "Kalitesiz sinyal filtrelendi",
        level: "WARN",
        context: {
          qualityScore: qualityGate.qualityScore,
          minimumRequiredScore: qualityGate.minimumRequiredScore,
          criteriaScores: qualityGate.criteriaScores,
          reasons: qualityGate.reasons,
        },
      });
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `Kalitesiz sinyal (score=${qualityGate.qualityScore}/${qualityGate.minimumRequiredScore}): ${qualityGate.reasons.join(", ")}`,
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
        details: {
          tradeQuality: {
            totalScore: qualityGate.qualityScore,
            weightedTotal: qualityGate.weightedTotal,
            minimumRequiredScore: qualityGate.minimumRequiredScore,
            criteriaScores: qualityGate.criteriaScores,
            scoreBreakdown: qualityGate.scoreBreakdown,
            confidenceTier: qualityGate.confidenceTier,
            decision: qualityGate.decision,
            whyAccepted: qualityGate.whyAccepted,
            whyRejected: qualityGate.whyRejected,
            weights: qualityGate.weights,
            openTrade: false,
            reason: qualityGate.reasons.join(", "),
          },
        },
      };
    }
    const adaptiveEval = await evaluateAdaptiveCandidate({
      userId: user.id,
      candidate: selected,
      ai,
    });
    if (!adaptiveEval.ok) {
      publishExecutionEvent({
        executionId,
        symbol: selected.context.symbol,
        stage: "adaptive-gate",
        status: "SKIPPED",
        message: "Adaptive performans filtresi tradei reddetti",
        level: "WARN",
        context: {
          adaptiveScore: adaptiveEval.score,
          reason: adaptiveEval.reason,
          components: adaptiveEval.components,
        },
      });
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: adaptiveEval.reason,
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
        details: {
          adaptiveOptimization: adaptiveEval,
        },
      };
    }
    let symbol = await resolveExchangeSymbol(selected.context.symbol);
    if (mode === "live" && env.BINANCE_PLATFORM === "tr" && symbol.endsWith("USDT")) {
      const tryCandidate = `${symbol.slice(0, -4)}TRY`;
      const resolvedTry = await resolveExchangeSymbol(tryCandidate).catch(() => tryCandidate);
      if (resolvedTry.endsWith("TRY")) {
        publishExecutionEvent({
          executionId,
          symbol,
          stage: "selection",
          status: "RUNNING",
          message: `TR platformta ${symbol} yerine ${resolvedTry} tercih edildi`,
          level: "INFO",
        });
        symbol = resolvedTry;
      }
    }
    const side = ai.finalDecision;
    if (side !== "BUY" && side !== "SELL") {
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "AI result is NO_TRADE/HOLD",
        symbol,
        decision: ai.finalDecision,
      };
    }
    if (mode === "live" && side === "SELL") {
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Spot modunda SELL acilis (short) desteklenmiyor.",
        symbol,
        decision: ai.finalDecision,
      };
    }
    if (selected.context.volatilityPercent >= env.EXECUTION_BLOCK_HIGH_VOLATILITY_PERCENT) {
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `Volatilite alarmi aktif (${selected.context.volatilityPercent.toFixed(3)}%).`,
        symbol,
        decision: ai.finalDecision,
      };
    }
    const cooldownSec = Math.max(0, env.EXECUTION_SAME_COIN_COOLDOWN_SEC);
    if (cooldownSec > 0) {
      const latestClosed = await findLatestClosedPositionBySymbol(user.id, symbol).catch(() => null);
      if (latestClosed?.closedAt) {
        const elapsedSec = Math.floor((Date.now() - latestClosed.closedAt.getTime()) / 1000);
        if (elapsedSec >= 0 && elapsedSec < cooldownSec) {
          return {
            executionId,
            mode,
            opened: false,
            rejected: true,
            rejectReason: `Ayni coin cooldown aktif (${cooldownSec - elapsedSec}s kaldi).`,
            symbol,
            decision: ai.finalDecision,
          };
        }
      }
    }

    const requestedLeverage = Number(input.leverageMultiplier ?? 1);
    const requestedLeverageSafe = Number.isFinite(requestedLeverage)
      ? Math.max(1, Math.min(20, requestedLeverage))
      : 1;
    const useGlobalLeverageVenue = mode === "live" && requestedLeverageSafe > 1 && isGlobalLeverageEnabled();
    const executionSymbol = useGlobalLeverageVenue ? toGlobalLeverageSymbol(symbol) : symbol;
    const liveDataHealthy = Boolean(selected.context.metadata.liveDataHealthy ?? true);
    if (env.AI_QUALITY_PROFILE === "elite" && !liveDataHealthy) {
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Elite quality gate: market snapshot degraded",
        symbol: executionSymbol,
        decision: ai.finalDecision,
      };
    }
    const ultraMinConfidence = useGlobalLeverageVenue
      ? env.AI_LEVERAGE_MIN_CONFIDENCE_ULTRA
      : env.AI_SPOT_MIN_CONFIDENCE_ULTRA;
    const ultraMaxRisk = useGlobalLeverageVenue
      ? env.AI_ULTRA_MAX_RISK_SCORE_LEVERAGE
      : env.AI_ULTRA_MAX_RISK_SCORE_SPOT;
    if (!isUltraPrecisionConsensus(selected, ultraMinConfidence, ultraMaxRisk)) {
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `Ultra precision gate reject (minConf=${ultraMinConfidence}, maxRisk=${ultraMaxRisk})`,
        symbol: executionSymbol,
        decision: ai.finalDecision,
      };
    }

    const policy = (await getExecutionPolicySetting(user.id)) ?? {};
    const allowMultipleOpenPositions = Boolean(
      (policy.allowMultipleOpenPositions as boolean | undefined) ?? env.EXECUTION_ALLOW_MULTI_POSITIONS,
    );
    let openPositions = await listOpenPositionsByUser(user.id);
    const effectiveRiskConfig = await getEffectiveRiskConfig(user.id).catch(() => null);
    const maxOpenPositions = Math.min(
      effectiveRiskConfig?.maxOpenPositions ?? env.EXECUTION_MAX_OPEN_POSITIONS,
      env.EXECUTION_MAX_OPEN_POSITIONS,
    );
    const requestedMaxCoins = Number(input.requestedMaxCoins ?? 1);
    const runtimeMaxOpenPositions = Math.max(
      1,
      Math.min(
        maxOpenPositions,
        5,
        Number.isFinite(requestedMaxCoins) ? Math.floor(requestedMaxCoins) : 1,
      ),
    );
    while (
      openPositions.length > 0 &&
      !env.EXECUTION_BLOCK_WHEN_OPEN_POSITION &&
      (!allowMultipleOpenPositions || openPositions.length >= runtimeMaxOpenPositions)
    ) {
      const oldest = [...openPositions].sort(
        (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime(),
      )[0];
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "pre-close",
        status: "RUNNING",
        message: `Yeni islem icin eski pozisyon kapatiliyor (${oldest.tradingPair.symbol})`,
        level: "WARN",
        context: {
          positionId: oldest.id,
          openCount: openPositions.length,
            maxOpenPositions: runtimeMaxOpenPositions,
          allowMultipleOpenPositions,
        },
      });
      const closeResult = await closePositionManually({
        positionId: oldest.id,
        executionId: randomUUID(),
        reason: "MANUAL_CLOSE",
      });
      if (!closeResult?.closed) {
        return {
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: `Open pozisyon kapanamadi (${oldest.tradingPair.symbol})`,
          symbol: executionSymbol,
          decision: ai.finalDecision,
        };
      }
      openPositions = await listOpenPositionsByUser(user.id);
    }
    const orderType = input.requestedOrderType ?? ((policy.defaultOrderType as "MARKET" | "LIMIT" | undefined) ?? "MARKET");
    const limitPrice =
      input.requestedLimitPrice ??
      (typeof policy.defaultLimitOffsetPercent === "number"
        ? Number(
            (
              selected.context.lastPrice *
              (side === "BUY"
                ? 1 - (policy.defaultLimitOffsetPercent as number) / 100
                : 1 + (policy.defaultLimitOffsetPercent as number) / 100)
            ).toFixed(8),
          )
        : undefined);

    const pair = await ensureTradingPair(executionSymbol);
    if (
      !useGlobalLeverageVenue &&
      mode === "live" &&
      env.BINANCE_PLATFORM === "tr" &&
      side === "BUY" &&
      pair.quoteAsset.toUpperCase() !== "TRY"
    ) {
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `TRY market required for all-in buy. Resolved quote=${pair.quoteAsset}`,
        symbol: executionSymbol,
        decision: ai.finalDecision,
      };
    }
    const aiTargetProfile = resolveAiTargetProfile(selected.ai, selected.context.lastPrice, side);
    if (aiTargetProfile && !aiTargetProfile.eligible) {
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `AI hedef penceresi uyumsuz (profit=${aiTargetProfile.expectedProfitPercent.toFixed(2)}%, duration=${aiTargetProfile.suggestedDurationSec}s)`,
        symbol,
        decision: ai.finalDecision,
      };
    }
    const aiSuggestedTakeProfitPercent = aiTargetProfile
      ? Number(
          Math.max(
            env.EXECUTION_TARGET_MIN_PROFIT_PERCENT,
            Math.min(aiTargetProfile.expectedProfitPercent, env.EXECUTION_TARGET_MAX_PROFIT_PERCENT),
          ).toFixed(4),
        )
      : undefined;
    const rawTakeProfitPercent =
      input.takeProfitPercent ??
      aiSuggestedTakeProfitPercent ??
      (policy.takeProfitPercent as number | undefined) ??
      env.EXECUTION_DEFAULT_TAKE_PROFIT_PERCENT;
    const regimeAdjustedTakeProfitPercent = Number(
      (
        rawTakeProfitPercent *
        (Number.isFinite(marketRegime.tpMultiplier) ? marketRegime.tpMultiplier : 1)
      ).toFixed(4),
    );
    const takeProfitPercent = resolveSmartTakeProfitPercent({
      baseTpPercent: regimeAdjustedTakeProfitPercent,
      volatilityPercent: selected.context.volatilityPercent,
      confidencePercent: ai.finalConfidence,
      expectedProfitPercent: aiTargetProfile?.expectedProfitPercent,
    });
    const baseStopLossPercent =
      input.stopLossPercent ?? (policy.stopLossPercent as number | undefined) ?? env.EXECUTION_DEFAULT_STOP_LOSS_PERCENT;
    const stopLossPercent = Number(
      (
        baseStopLossPercent *
        (Number.isFinite(marketRegime.slMultiplier) ? marketRegime.slMultiplier : 1)
      ).toFixed(4),
    );
    const rawDurationSec =
      input.maxDurationSec ??
      aiTargetProfile?.suggestedDurationSec ??
      (policy.maxDurationSec as number | undefined) ??
      env.EXECUTION_DEFAULT_MAX_DURATION_SEC;
    const maxDurationSec = Math.max(120, Math.min(env.EXECUTION_TARGET_LONG_WINDOW_SEC, rawDurationSec));
    const edgeGate = validateProfitEdgeGate({
      takeProfitPercent,
      stopLossPercent,
      spreadPercent: selected.context.spreadPercent,
      leverageMultiplier: useGlobalLeverageVenue ? requestedLeverageSafe : 1,
    });
    if (!edgeGate.pass) {
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `Edge gate reject (rr=${edgeGate.rrRatio}, minProfit=${edgeGate.requiredMinProfitPercent}%)`,
        symbol: executionSymbol,
        decision: ai.finalDecision,
        details: {
          rrRatio: edgeGate.rrRatio,
          requiredMinProfitPercent: edgeGate.requiredMinProfitPercent,
          roundTripCostPercent: edgeGate.roundTripCostPercent,
          spreadPercent: selected.context.spreadPercent,
        },
      };
    }
    if (useGlobalLeverageVenue && selected.context.volume24h < env.SCANNER_MIN_VOLUME_24H * 3) {
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Leverage liquidity gate reject (24h hacim yetersiz).",
        symbol: executionSymbol,
        decision: ai.finalDecision,
      };
    }
    publishExecutionEvent({
      executionId,
      symbol,
      stage: "selection",
      status: "RUNNING",
      message: `Pozisyon tutma suresi planlandi: ${maxDurationSec}s`,
      level: "INFO",
      context: {
        aiSuggestedDurationSec: aiTargetProfile?.suggestedDurationSec,
        aiExpectedProfitPercent: aiTargetProfile?.expectedProfitPercent,
        policyDurationSec: policy.maxDurationSec as number | undefined,
        requestedDurationSec: input.maxDurationSec,
      },
    });
    await persistAnalysisState({
      userId: user.id,
      executionId,
      symbol,
      stage: "order-submit",
      status: "RUNNING",
    });
    let estimatedEntryPrice = orderType === "LIMIT" ? limitPrice ?? selected.context.lastPrice : selected.context.lastPrice;
    if (useGlobalLeverageVenue) {
      const globalTicker = await getGlobalTicker(executionSymbol);
      estimatedEntryPrice = globalTicker.price;
    }
    const utilizationRate = Math.min(0.999, Math.max(0.1, env.EXECUTION_BALANCE_UTILIZATION_RATE));
    const fallbackQty = (policy.defaultQuantity as number | undefined) ?? 0.01;
    let candidateQty = input.requestedQuantity ?? fallbackQty;
    const requestedQuoteAmountTry = Number(input.requestedQuoteAmountTry ?? 0);
    const requestedQuoteAmountUsdt = Number(input.requestedQuoteAmountUsdt ?? 0);
    const effectiveLeverage = requestedLeverageSafe;
    const hasManualSizing =
      (Number.isFinite(input.requestedQuantity ?? NaN) && Number(input.requestedQuantity) > 0) ||
      (Number.isFinite(requestedQuoteAmountTry) && requestedQuoteAmountTry > 0) ||
      (Number.isFinite(requestedQuoteAmountUsdt) && requestedQuoteAmountUsdt > 0);

    if (useGlobalLeverageVenue && estimatedEntryPrice > 0) {
      if (!Number.isFinite(requestedQuoteAmountUsdt) || requestedQuoteAmountUsdt <= 0) {
        return {
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: "Global kaldirac icin USDT tutari girilmesi zorunlu.",
          symbol: executionSymbol,
          decision: ai.finalDecision,
        };
      }
      const effectiveNotionalUsdt = requestedQuoteAmountUsdt * effectiveLeverage;
      candidateQty = effectiveNotionalUsdt / estimatedEntryPrice;
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "sizing",
        status: "RUNNING",
        message: `Global sizing aktif: ${requestedQuoteAmountUsdt} USDT x ${effectiveLeverage}x`,
        level: "INFO",
        context: {
          venue: "BINANCE_GLOBAL",
          requestedQuoteAmountUsdt,
          requestedLeverage: requestedLeverageSafe,
          effectiveLeverage,
          estimatedEntryPrice,
          candidateQty,
        },
      });
    } else if (requestedQuoteAmountTry > 0 && estimatedEntryPrice > 0) {
      if (useGlobalLeverageVenue) {
        const usdtTryTicker = await getTicker("USDTTRY").catch(() => null);
        const usdtTry = Number(usdtTryTicker?.price ?? 0);
        if (!Number.isFinite(usdtTry) || usdtTry <= 0) {
          return {
            executionId,
            mode,
            opened: false,
            rejected: true,
            rejectReason: "USDTTRY kuru alinamadi, global kaldirac sizing yapilamadi.",
            symbol: executionSymbol,
            decision: ai.finalDecision,
          };
        }
        const marginUsdt = requestedQuoteAmountTry / usdtTry;
        const effectiveNotionalUsdt = marginUsdt * effectiveLeverage;
        candidateQty = effectiveNotionalUsdt / estimatedEntryPrice;
      } else {
        const effectiveNotionalTry = requestedQuoteAmountTry * effectiveLeverage;
        candidateQty = effectiveNotionalTry / estimatedEntryPrice;
      }
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "sizing",
        status: "RUNNING",
        message:
          useGlobalLeverageVenue
            ? `Global kaldirac sizing aktif: ${requestedQuoteAmountTry} TRY x ${effectiveLeverage}x`
            : `Tutar bazli giris aktif: ${requestedQuoteAmountTry} TRY x ${effectiveLeverage}x`,
        level: "INFO",
        context: {
          venue: useGlobalLeverageVenue ? "BINANCE_GLOBAL" : "BINANCE_TR",
          requestedQuoteAmountTry,
          requestedQuoteAmountUsdt,
          requestedLeverage: requestedLeverageSafe,
          effectiveLeverage,
          estimatedEntryPrice,
          candidateQty,
        },
      });
    }

    // Full-balance mode only applies when user did not provide manual sizing.
    if (env.EXECUTION_FULL_BALANCE_ENABLED && !hasManualSizing && !useGlobalLeverageVenue) {
      const balances = await getAccountBalances().catch(() => []);
      if (side === "BUY") {
        const quoteBalanceFree = Number(
          balances.find((row) => row.asset.toUpperCase() === pair.quoteAsset.toUpperCase())?.free ?? 0,
        );
        if (quoteBalanceFree <= 0 || estimatedEntryPrice <= 0) {
          return {
            executionId,
            mode,
            opened: false,
            rejected: true,
            rejectReason: `${pair.quoteAsset} bakiyesi okunamadi veya yetersiz.`,
            symbol: executionSymbol,
            decision: ai.finalDecision,
          };
        }
        const remainingSlots = Math.max(1, runtimeMaxOpenPositions - openPositions.length);
        const quoteSpend = (quoteBalanceFree * utilizationRate) / remainingSlots;
        candidateQty = quoteSpend / estimatedEntryPrice;
        publishExecutionEvent({
          executionId,
          symbol: executionSymbol,
          stage: "sizing",
          status: "RUNNING",
          message: `Coklu coin sizing aktif (${remainingSlots} slot, coin basi paylastirim)`,
          level: "INFO",
          context: {
            quoteAsset: pair.quoteAsset,
            quoteBalanceFree,
            utilizationRate,
            remainingSlots,
            quoteSpend,
            candidateQty,
          },
        });
      } else {
        const baseBalanceFree = Number(
          balances.find((row) => row.asset.toUpperCase() === pair.baseAsset.toUpperCase())?.free ?? 0,
        );
        if (baseBalanceFree <= 0) {
          return {
            executionId,
            mode,
            opened: false,
            rejected: true,
            rejectReason: `${pair.baseAsset} bakiyesi okunamadi veya yetersiz.`,
            symbol: executionSymbol,
            decision: ai.finalDecision,
          };
        }
        candidateQty = baseBalanceFree * utilizationRate;
        publishExecutionEvent({
          executionId,
          symbol: executionSymbol,
          stage: "sizing",
          status: "RUNNING",
          message: `All-in SELL sizing aktif (${pair.baseAsset} bakiye kullanimi)`,
          level: "INFO",
          context: {
            baseAsset: pair.baseAsset,
            baseBalanceFree,
            utilizationRate,
            candidateQty,
          },
        });
      }
    }

    const validQty = useGlobalLeverageVenue
      ? await calculateGlobalValidQuantity(executionSymbol, candidateQty)
      : await calculateValidQuantity(executionSymbol, candidateQty);
    const preValidation = useGlobalLeverageVenue
      ? {
          ok: true,
          reasons: [] as string[],
          marketPrice: estimatedEntryPrice,
          notional: Number((validQty * estimatedEntryPrice).toFixed(8)),
          adjustedQuantity: validQty,
          minNotional: undefined,
        }
      : await validatePreTrade({
          userId: user.id,
          symbol: executionSymbol,
          quantity: validQty,
          priceHint: orderType === "LIMIT" ? limitPrice : selected.context.lastPrice,
          allowMultipleOpenPositions,
          openPositionCount: openPositions.length,
          side,
        });
    if (!preValidation.ok) {
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "validation",
        status: "FAILED",
        message: `Validation fail: ${preValidation.reasons.join(", ")}`,
        level: "WARN",
      });
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: preValidation.reasons.join(", "),
        symbol: executionSymbol,
        decision: ai.finalDecision,
      };
    }

    const entryPrice = orderType === "LIMIT" ? limitPrice ?? preValidation.marketPrice : preValidation.marketPrice;
    const smartEntry = evaluateSmartEntryGate({
      candidate: selected,
      ai,
      side,
      entryPrice,
      takeProfitPercent,
      stopLossPercent,
    });
    if (!smartEntry.pass) {
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "smart-entry-gate",
        status: "SKIPPED",
        message: smartEntry.reason,
        level: "WARN",
        context: {
          entryPrice,
          side,
          takeProfitPercent,
          stopLossPercent,
          smartEntry: smartEntry.details,
        },
      });
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: smartEntry.reason,
        symbol: executionSymbol,
        decision: ai.finalDecision,
        details: {
          smartEntry: smartEntry.details,
        },
      };
    }
    const { takeProfitPrice, stopLossPrice } = resolveTpSl(entryPrice, side, takeProfitPercent, stopLossPercent);
    const initialSmartExitPlan = buildInitialSmartExitPlan({
      side,
      entryPrice,
      takeProfitPrice,
    });
    publishExecutionEvent({
      executionId,
      symbol: executionSymbol,
      stage: "sell-target",
      status: "RUNNING",
      message: "Satis hedefleri hesaplandi",
      level: "INFO",
      context: {
        selectedCoin: executionSymbol,
        entryPrice,
        takeProfitPrice,
        stopLossPrice,
        takeProfitPercent,
        stopLossPercent,
      },
    });
    const riskGate = await evaluatePreTradeRisk({
      userId: user.id,
      symbol: executionSymbol,
      confidencePercent: ai.finalConfidence,
      spreadPercent: selected.context.spreadPercent,
      liquidity24h: selected.context.volume24h,
      expectedProfitPercent: Number(Math.max(0, takeProfitPercent - stopLossPercent * 0.25).toFixed(4)),
      slippagePercent: Number(selected.context.spreadPercent.toFixed(4)),
      volatilityPercent: selected.context.volatilityPercent,
      riskPerTradePercent: Number(
        (
          (
            ((preValidation.notional * Math.max(stopLossPercent, 0)) / 100) /
            Math.max(env.RISK_TOTAL_CAPITAL_TRY, 1)
          ) * 100
        ).toFixed(4),
      ),
      stopLossConfigured: Number.isFinite(stopLossPercent) && stopLossPercent > 0,
    });
    if (!riskGate.ok) {
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "risk-gate",
        status: "FAILED",
        message: `Risk gate reject: ${riskGate.reasons.join(", ")}`,
        level: "WARN",
      });
      await addAuditLog({
        userId: user.id,
        action: "EXECUTE",
        entityType: "RiskGate",
        entityId: executionId,
        newValues: {
          symbol,
          reasons: riskGate.reasons,
        },
      }).catch(() => null);
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: riskGate.reasons.join(", "),
        symbol,
        decision: ai.finalDecision,
      };
    }

    const tradeSignal = await createTradeSignalFromConsensus({
      userId: user.id,
      tradingPairId: pair.id,
      scannerResultId: undefined,
      side,
      confidencePercent: ai.finalConfidence,
      triggerPrice: entryPrice,
      stopLossPrice,
      takeProfitPrice,
      reason: ai.explanation,
      metadata: {
        executionId,
        aiScore: ai.score,
        finalRiskScore: ai.finalRiskScore,
        qualityScore: qualityGate.qualityScore,
        qualityWeightedTotal: qualityGate.weightedTotal,
        qualityMinimumRequiredScore: qualityGate.minimumRequiredScore,
        qualityCriteriaScores: qualityGate.criteriaScores,
        qualityScoreBreakdown: qualityGate.scoreBreakdown,
        qualityConfidenceTier: qualityGate.confidenceTier,
        qualityDecision: qualityGate.decision,
        qualityWhyAccepted: qualityGate.whyAccepted,
        qualityWhyRejected: qualityGate.whyRejected,
        qualityWeights: qualityGate.weights,
        qualityStrengths: qualityGate.strengths,
        qualityReasons: qualityGate.reasons,
        smartEntry: smartEntry.details,
        adaptiveOptimization: adaptiveEval,
        decisionPayload: ai.decisionPayload,
      },
    });

    publishExecutionEvent({
      executionId,
      symbol,
      stage: "order-submit",
      status: "RUNNING",
      message: `${mode} modunda ${side} emir gonderiliyor`,
      level: "TRADE",
      context: { orderType, quantity: preValidation.adjustedQuantity },
    });
    pauseScannerWorker(25_000);
    const baseQty = preValidation.adjustedQuantity;

    const placeWithQty = async (qty: number) => {
      if (mode === "paper") {
        return executePaperOpenOrder({
          userId: user.id,
          symbol: executionSymbol,
          side,
          quantity: qty,
          price: entryPrice,
          quoteAsset: pair.quoteAsset,
          baseAsset: pair.baseAsset,
        });
      }
      if (useGlobalLeverageVenue) {
        if (side === "BUY") {
          return placeGlobalMarketBuy(executionSymbol, qty, false);
        }
        return placeGlobalMarketSell(executionSymbol, qty, false);
      }
      if (side === "BUY") {
        if (orderType === "MARKET" && env.EXECUTION_FULL_BALANCE_ENABLED) {
          const balances = await getAccountBalances().catch(() => []);
          const quoteBalanceFree = Number(
            balances.find((row) => row.asset.toUpperCase() === pair.quoteAsset.toUpperCase())?.free ?? 0,
          );
          const quoteSpend = Number((quoteBalanceFree * utilizationRate).toFixed(8));
          if (quoteSpend > 0) {
            return placeMarketBuyByQuote(executionSymbol, quoteSpend, mode === "dry-run");
          }
        }
        return orderType === "MARKET"
          ? placeMarketBuy(executionSymbol, qty, mode === "dry-run")
          : placeLimitBuy(executionSymbol, qty, entryPrice, mode === "dry-run");
      }
      return orderType === "MARKET"
        ? placeMarketSell(executionSymbol, qty, mode === "dry-run")
        : placeLimitSell(executionSymbol, qty, entryPrice, mode === "dry-run");
    };

    let placedOrder: Awaited<ReturnType<typeof placeWithQty>> | null = null;
    let submittedQty = baseQty;
    let lastPlaceError: unknown = null;
    const candidateQtyRaw: number[] = [baseQty];
    if (preValidation.minNotional && preValidation.marketPrice > 0) {
      candidateQtyRaw.push((preValidation.minNotional * 1.01) / preValidation.marketPrice);
    }
    for (const multiplier of [2, 5, 10, 20]) {
      candidateQtyRaw.push(baseQty * multiplier);
    }
    const uniqueQty = Array.from(
      new Set(
        candidateQtyRaw
          .filter((x) => Number.isFinite(x) && x > 0)
          .map((x) => Number(x.toFixed(8))),
      ),
    ).sort((a, b) => a - b);

    for (const qtyRaw of uniqueQty) {
      const qty = await (useGlobalLeverageVenue
        ? calculateGlobalValidQuantity(executionSymbol, qtyRaw)
        : calculateValidQuantity(executionSymbol, qtyRaw)
      ).catch(() => qtyRaw);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (qty > baseQty) {
        publishExecutionEvent({
          executionId,
          symbol: executionSymbol,
          stage: "sizing",
          status: "RUNNING",
          message: `Min notional fallback aktif, miktar ${baseQty} -> ${qty}`,
          level: "WARN",
          context: {
            minNotional: preValidation.minNotional,
            marketPrice: preValidation.marketPrice,
          },
        });
      }
      try {
        placedOrder = await placeWithQty(qty);
        const filledQty = Number(placedOrder.executedQty ?? 0);
        submittedQty = Number.isFinite(filledQty) && filledQty > 0 ? filledQty : qty;
        lastPlaceError = null;
        break;
      } catch (error) {
        lastPlaceError = error;
        const message = (error as Error)?.message ?? "";
        if (!isTrMinNotionalError(message)) {
          throw error;
        }
      }
    }
    if (!placedOrder) {
      throw ((lastPlaceError as Error) ?? new Error("Order placement failed"));
    }
    await resetApiFailure(user.id).catch(() => null);

    if (mode === "live" && !String(placedOrder.orderId ?? "").trim()) {
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "order-submit",
        status: "FAILED",
        message: "Borsa orderId donmedi, islem onaylanmadi",
        level: "ERROR",
      });
      return {
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Exchange order confirmation missing (orderId).",
        symbol: executionSymbol,
        decision: ai.finalDecision,
      };
    }

    const initialOrderStatus = mapOrderStatus(placedOrder.status);
    const settledOrder = await settlePendingOrderStatus({
      symbol: executionSymbol,
      exchangeOrderId: placedOrder.orderId,
      initialStatus: initialOrderStatus,
      isMarketOrder: orderType === "MARKET",
      initialExecutedQty: placedOrder.executedQty,
      mode,
    });
    const normalizedOrderStatus = settledOrder.status;
    if (Number.isFinite(settledOrder.executedQty) && settledOrder.executedQty > 0) {
      submittedQty = Number(settledOrder.executedQty.toFixed(8));
    }
    publishExecutionEvent({
      executionId,
      symbol: executionSymbol,
      stage: "buy-order",
      status: normalizedOrderStatus === "FILLED" ? "SUCCESS" : "RUNNING",
      message: normalizedOrderStatus === "FILLED" ? "Alim emri tamamlandi" : "Alim emri gonderildi",
      level: "TRADE",
      context: {
        orderType,
        orderId: placedOrder.orderId,
        exchangeOrderId: placedOrder.orderId,
        orderStatus: normalizedOrderStatus,
        buyPrice: entryPrice,
        buyQuantity: submittedQty,
      },
    });
    const fee = await estimateFees(executionSymbol, side, submittedQty, entryPrice);
    const orderRecord = await createTradeOrder({
      userId: user.id,
      exchangeConnectionId: connection.id,
      tradingPairId: pair.id,
      tradeSignalId: tradeSignal.id,
      side,
      type: orderType,
      quantity: submittedQty,
      price: orderType === "LIMIT" ? entryPrice : undefined,
      stopPrice: stopLossPrice,
      takeProfitPrice,
      status: normalizedOrderStatus,
      clientOrderId: placedOrder.clientOrderId,
      exchangeOrderId: placedOrder.orderId,
      submittedAt: new Date(),
      executedAt: normalizedOrderStatus === "FILLED" ? new Date() : undefined,
      avgExecutionPrice: entryPrice,
      fee: fee.estimatedTakerFee,
      feeCurrency: pair.quoteAsset,
      metadata: {
        mode,
        executionId,
        source: "analyze-and-trade",
        executionVenue: useGlobalLeverageVenue ? "BINANCE_GLOBAL" : "BINANCE_TR",
        requestedLeverage: requestedLeverageSafe,
        requestedQuoteAmountTry: requestedQuoteAmountTry > 0 ? requestedQuoteAmountTry : undefined,
        requestedQuoteAmountUsdt: requestedQuoteAmountUsdt > 0 ? requestedQuoteAmountUsdt : undefined,
      },
    });

    await addTradeExecution({
      tradeOrderId: orderRecord.id,
      status: normalizedOrderStatus === "FILLED" ? "SUCCESS" : "PENDING",
      executionPrice: entryPrice,
      executedQty: placedOrder.executedQty,
      quoteQty: Number((placedOrder.executedQty * entryPrice).toFixed(8)),
      fee: fee.estimatedTakerFee,
      executionRef: placedOrder.orderId,
      metadata: { mode, rawStatus: placedOrder.status },
    });

    if (normalizedOrderStatus !== "FILLED") {
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "order-submit",
        status: "SKIPPED",
        message: `Order placed but not filled (${normalizedOrderStatus})`,
        level: "WARN",
        context: { orderId: orderRecord.id },
      });
      return {
        executionId,
        mode,
        opened: false,
        rejected: false,
        symbol: executionSymbol,
        decision: ai.finalDecision,
        orderId: orderRecord.id,
        tradeSignalId: tradeSignal.id,
        details: { orderStatus: normalizedOrderStatus },
      };
    }

    const positionSide = side === "BUY" ? "LONG" : "SHORT";
    const position = await createPosition({
      userId: user.id,
      exchangeConnectionId: connection.id,
      tradingPairId: pair.id,
      side: positionSide,
      entryPrice,
      quantity: submittedQty,
      leverage: useGlobalLeverageVenue ? requestedLeverageSafe : 1,
      marginUsed: Number(
        (
          requestedQuoteAmountTry > 0
            ? requestedQuoteAmountTry
            : (entryPrice * submittedQty) / Math.max(1, useGlobalLeverageVenue ? requestedLeverageSafe : 1)
        ).toFixed(8),
      ),
      metadata: {
        executionId,
        mode,
        executionVenue: useGlobalLeverageVenue ? "BINANCE_GLOBAL" : "BINANCE_TR",
        executionSymbol,
        displaySymbol: symbol,
        marketRegime: marketRegime.mode,
        marketRegimeReason: marketRegime.reason,
        marketRegimeStrategy: marketRegime.strategy,
        requestedLeverage: requestedLeverageSafe,
        requestedQuoteAmountTry: requestedQuoteAmountTry > 0 ? requestedQuoteAmountTry : undefined,
        requestedQuoteAmountUsdt: requestedQuoteAmountUsdt > 0 ? requestedQuoteAmountUsdt : undefined,
        takeProfitPrice,
        stopLossPrice,
        maxDurationSec,
        qualityScore: qualityGate.qualityScore,
        qualityWeightedTotal: qualityGate.weightedTotal,
        qualityMinimumRequiredScore: qualityGate.minimumRequiredScore,
        qualityCriteriaScores: qualityGate.criteriaScores,
        qualityScoreBreakdown: qualityGate.scoreBreakdown,
        qualityConfidenceTier: qualityGate.confidenceTier,
        qualityDecision: qualityGate.decision,
        qualityWhyAccepted: qualityGate.whyAccepted,
        qualityWhyRejected: qualityGate.whyRejected,
        qualityWeights: qualityGate.weights,
        qualityReasons: qualityGate.reasons,
        smartEntry: smartEntry.details,
        adaptiveOptimization: adaptiveEval,
        ruleTags: buildRuleTags({
          aiConfidence: ai.finalConfidence,
          aiRiskScore: ai.finalRiskScore,
          spreadPercent: selected.context.spreadPercent,
          volatilityPercent: selected.context.volatilityPercent,
          qualityScore: qualityGate.qualityScore,
        }),
        partialTpPlan: resolvePartialTakeProfitPlan({
          takeProfitPercent,
          stopLossPercent,
        }),
        smartExitState: {
          lastAdaptiveTp: initialSmartExitPlan.adaptiveTp,
          peakProfitPercent: 0,
          lastRegime: marketRegime.mode,
        },
      },
    });
    await attachOrderToPosition(orderRecord.id, position.id);

    await attachPositionMonitor({
      executionId,
      userId: user.id,
      positionId: position.id,
      symbol: executionSymbol,
      side: position.side,
      openedAt: position.openedAt.toISOString(),
      entryPrice,
      takeProfitPrice,
      stopLossPrice,
      maxDurationSec,
      partialTpPlan: resolvePartialTakeProfitPlan({
        takeProfitPercent,
        stopLossPercent,
      }),
        smartExitState: {
          lastAdaptiveTp: initialSmartExitPlan.adaptiveTp,
          peakProfitPercent: 0,
          lastRegime: marketRegime.mode,
        },
      mode,
      source: "OPEN",
    });

    publishExecutionEvent({
      executionId,
      symbol: executionSymbol,
      stage: "completed",
      status: "SUCCESS",
      message: `${executionSymbol} ${positionSide} pozisyon acildi`,
      level: "TRADE",
      context: {
        orderId: orderRecord.id,
        positionId: position.id,
        buyFilledAt: new Date().toISOString(),
        buyPrice: entryPrice,
        buyQuantity: submittedQty,
        buyNotional: Number((submittedQty * entryPrice).toFixed(8)),
        buyFee: fee.estimatedTakerFee,
        aiReason: ai.explanation,
        takeProfitPrice,
      },
    });

    pushLog("TRADE", `[${mode}] ${executionSymbol} ${side} order filled. position=${position.id}`);
    await addAuditLog({
      userId: user.id,
      action: "EXECUTE",
      entityType: "TradeExecution",
      entityId: executionId,
      newValues: {
        symbol: executionSymbol,
        side,
        mode,
        positionId: position.id,
        orderId: orderRecord.id,
      },
    }).catch(() => null);
    await addSystemLog({
      level: "INFO",
      source: "execution-orchestrator",
      message: `${executionSymbol} ${side} execution opened in ${mode} mode.`,
      context: {
        executionId,
        positionId: position.id,
        orderId: orderRecord.id,
      },
    }).catch(() => null);
    await logTradeLifecycle({
      executionId,
      stage: "completed",
      symbol: executionSymbol,
      status: "SUCCESS",
      message: "Position opened and monitor attached",
      context: { positionId: position.id, orderId: orderRecord.id },
    });
    await persistAnalysisState({
      userId: user.id,
      executionId,
      symbol: executionSymbol,
      stage: "completed",
      status: "SUCCESS",
    });
    await setIdempotentExecution(user.id, idempotencyKey, {
      executionId,
      opened: true,
      rejected: false,
      symbol: executionSymbol,
      orderId: orderRecord.id,
      positionId: position.id,
      updatedAt: new Date().toISOString(),
    });

    return {
      executionId,
      mode,
      opened: true,
      rejected: false,
      symbol: executionSymbol,
      decision: ai.finalDecision,
      orderId: orderRecord.id,
      positionId: position.id,
      tradeSignalId: tradeSignal.id,
      monitorActive: true,
      details: {
        entryPrice,
        filledQuantity: submittedQty,
        takeProfitPrice,
        stopLossPrice,
        maxDurationSec,
        confidence: ai.finalConfidence,
        tradeQuality: {
          totalScore: qualityGate.qualityScore,
          weightedTotal: qualityGate.weightedTotal,
          minimumRequiredScore: qualityGate.minimumRequiredScore,
          criteriaScores: qualityGate.criteriaScores,
          scoreBreakdown: qualityGate.scoreBreakdown,
          confidenceTier: qualityGate.confidenceTier,
          decision: qualityGate.decision,
          whyAccepted: qualityGate.whyAccepted,
          whyRejected: qualityGate.whyRejected,
          weights: qualityGate.weights,
          openTrade: true,
          reason: "Kalite skoru esik ustu, islem acildi",
        },
        smartExit: initialSmartExitPlan,
        smartEntry: smartEntry.details,
        adaptiveOptimization: adaptiveEval,
      },
    };
  } catch (error) {
    resumeScannerWorker();
    const appError = toAppError(error);
    const internalMessage = appError.message;
    const safeMessage = appError.expose ? appError.message : "Execution flow failed";
    logger.error({ err: internalMessage, code: appError.code }, "Execution orchestrator failed");
    try {
      const { user } = await getRuntimeExecutionContext(input.userId);
      const shouldCountAsApiFailure = !isRateLimitOrCooldownErrorMessage(internalMessage);
      if (shouldCountAsApiFailure) {
        const failure = await registerApiFailure(user.id);
        const risk = await getEffectiveRiskConfig(user.id);
        if (failure.count >= risk.apiFailureBreaker) {
          logger.warn(
            { userId: user.id, failureCount: failure.count, breaker: risk.apiFailureBreaker },
            "API failure breaker reached; auto-pause skipped to keep manual trading available",
          );
        }
      }
    } catch {
      // noop
    }
    publishExecutionEvent({
      executionId,
      stage: "failed",
      status: "FAILED",
      message: safeMessage,
      level: "ERROR",
    });
    const { user } = await getRuntimeExecutionContext(input.userId).catch(() => ({ user: null as { id: string } | null }));
    if (user?.id) {
      await persistAnalysisState({
        userId: user.id,
        executionId,
        symbol: input.requestedSymbol,
        stage: "failed",
        status: "FAILED",
      }).catch(() => null);
    }
    await addSystemLog({
      level: "ERROR",
      source: "execution-orchestrator",
      message: `Execution failed: ${internalMessage}`,
      context: { executionId },
    }).catch(() => null);
    await logTradeLifecycle({
      executionId,
      stage: "failed",
      status: "FAILED",
      message: internalMessage,
    });
    return {
      executionId,
      mode,
      opened: false,
      rejected: true,
      rejectReason: safeMessage,
    };
  } finally {
    markHeartbeat({ service: "execution", status: "UP", message: "Execution flow finished", details: { executionId } });
  }
}

export async function closePositionManually(input: {
  positionId: string;
  executionId?: string;
  reason?: "MANUAL_CLOSE" | "EMERGENCY_STOP" | "RISK_BREAKER";
}) {
  const executionId = input.executionId ?? randomUUID();
  stopPositionMonitor(input.positionId);
  const mode = getMode();
  return settleOpenPosition({
    executionId,
    positionId: input.positionId,
    reason: input.reason ?? "MANUAL_CLOSE",
    mode,
  });
}

export async function cancelTradeOrderFlow(input: { orderId: string }) {
  const order = await findTradeOrderById(input.orderId);
  if (!order) {
    return { canceled: false, reason: "Order not found." };
  }

  if (order.status === "FILLED") {
    return { canceled: false, reason: "Order already filled." };
  }

  if (order.exchangeOrderId) {
    await cancelOrder(order.tradingPair.symbol, order.exchangeOrderId).catch(() => null);
  }
  await updateOrderStatus({
    orderId: order.id,
    status: "CANCELED",
    canceledAt: new Date(),
    rejectReason: "Manual cancellation",
  });
  publishExecutionEvent({
    executionId: randomUUID(),
    symbol: order.tradingPair.symbol,
    stage: "cancel",
    status: "SUCCESS",
    message: `${order.tradingPair.symbol} order canceled`,
    level: "WARN",
    context: { orderId: order.id },
  });
  await addAuditLog({
    userId: order.userId,
    action: "UPDATE",
    entityType: "TradeOrder",
    entityId: order.id,
    newValues: { status: "CANCELED", reason: "Manual cancellation" },
  }).catch(() => null);
  return { canceled: true, orderId: order.id };
}

export async function emergencyStopTrading(userId?: string) {
  const { user } = await getRuntimeExecutionContext(userId);
  await setEmergencyStopState(true, user.id);
  await pauseSystemByRisk(user.id, "Emergency stop active", 24 * 60);
  stopAllPositionMonitors();
  const openPositions = await listOpenPositionsByUser(user.id);
  const closed: string[] = [];
  for (const pos of openPositions) {
    await closePositionManually({
      positionId: pos.id,
      executionId: randomUUID(),
      reason: "EMERGENCY_STOP",
    });
    closed.push(pos.id);
  }
  publishExecutionEvent({
    executionId: randomUUID(),
    stage: "emergency-stop",
    status: "SUCCESS",
    message: `Emergency stop active. ${closed.length} pozisyon kapatildi.`,
    level: "ERROR",
    context: { userId: user.id, closedPositions: closed },
  });
  await addAuditLog({
    userId: user.id,
    action: "UPDATE",
    entityType: "EmergencyStop",
    entityId: user.id,
    newValues: { enabled: true, closedPositions: closed },
  }).catch(() => null);
  return { enabled: true, closedPositions: closed };
}

export async function disableEmergencyStop(userId?: string) {
  const { user } = await getRuntimeExecutionContext(userId);
  await setEmergencyStopState(false, user.id);
  await resumeSystem(user.id);
  await addAuditLog({
    userId: user.id,
    action: "UPDATE",
    entityType: "EmergencyStop",
    entityId: user.id,
    newValues: { enabled: false },
  }).catch(() => null);
  return { enabled: false };
}

export async function handlePartialFailure(orderId: string, error: string) {
  await updateOrderStatus({
    orderId,
    status: "REJECTED",
    errorMessage: error,
    rejectReason: "Partial failure",
  });
}

export async function getPositionSnapshot(positionId: string) {
  return getPositionById(positionId);
}
