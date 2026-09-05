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
  getExecutionVenueEligibility,
} from "@/services/binance.service";
import {
  calculateGlobalValidQuantity,
  getGlobalTicker,
  isGlobalLeverageEnabled,
  placeGlobalMarketBuy,
  placeGlobalMarketSell,
  toGlobalLeverageSymbol,
} from "@/services/binance-global.service";
import { resolveRoundTripTakerFeePercent } from "@/src/server/execution/fee-profile";
import { runAIConsensusFromInput } from "@/src/server/ai/analysis-orchestrator";
import { computeDirectionalProfitPercent } from "@/src/server/ai/normalize-model-output";
import { ensureLivePositionTracking } from "@/src/server/execution/live-position-tracker.service";
import { addSystemLog } from "@/src/server/repositories/log.repository";
import { getRiskConfigByUser } from "@/src/server/repositories/risk.repository";
import { evaluateCanonicalRiskDecision } from "@/src/server/risk/canonical-risk-decision.service";
import { upsertCandidatePipelineTrace } from "@/src/server/hot-path/candidate-pipeline-trace.service";
import { claimCanonicalExecutionAttempt } from "@/src/server/hot-path/execution-attempt-lock.service";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import {
  getScannerWorkerSnapshot,
  pauseScannerWorker,
  pauseScannerWorkerUntilResume,
  resumeScannerWorker,
  runScannerPipeline,
} from "@/src/server/scanner";
import { getBestFastEntry } from "@/src/server/scanner/fast-entry.service";
import { formatAIRequest } from "@/src/server/scanner/ai-request-formatter";
import { buildMarketContext } from "@/src/server/scanner/market-context-builder";
import { scoreContext } from "@/src/server/scanner/signal-scoring.engine";
import {
  addTradeExecution,
  attachOrderToPosition,
  createPosition,
  bindDecisionFeatureSnapshotPositionId,
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
  evaluateRuntimeRisk,
  getEffectiveRiskConfig,
  pauseSystemByRisk,
  registerDomainApiFailure,
  resetDomainApiFailure,
  resetApiFailure,
  resumeSystem,
} from "@/src/server/risk";
import { markHeartbeat } from "@/src/server/observability/heartbeat";
import { logTradeLifecycle } from "@/src/server/observability/trade-lifecycle";
import { logTradeEvent } from "@/src/server/observability/trade-event-log";
import {
  beginDecisionTrace,
  observeDeferredExecutionResult,
  observeTradeDecision,
  recordDecisionTimelineEvent,
} from "@/src/server/observability/decision-observability.service";
import { runWithDecisionTrace } from "@/src/server/observability/decision-trace-context";
import type { SignalQualityResult } from "@/src/server/execution/signal-quality-gate.service";
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
import {
  evaluateEntryForBuyCandidate,
  isEntryApprovedForExecution,
} from "@/src/server/execution-engine-v2/entry-ai.gateway.service";
import { executeApprovedSpotOrder } from "@/src/server/execution-engine-v2/execution-flow.service";
import { resolvePartialTakeProfitPlan, resolveSmartTakeProfitPercent } from "@/src/server/execution/smart-targeting.service";
import { shouldRejectHighRiskLowConfidenceEntry } from "@/src/server/execution/profit-thresholds";
import { resolveRiskEfficiencyAdjustment, resolveVolatilityAwareStopLossPercent } from "@/src/server/execution/risk-efficiency.service";
import { getConsecutiveLossCount } from "@/src/server/repositories/risk.repository";
import { getCanonicalCandidateStore } from "@/src/server/candidate/candidate-store.service";
import { tradingFailsafeState } from "@/src/server/trading-core/protection/failsafe-state";
import type { PortfolioPositionInput } from "@/src/server/trading-core/portfolio/portfolio-types";
import { toAppError } from "@/src/server/errors/app-error";
import { ExternalServiceError } from "@/src/server/errors";
import { evaluateAdaptiveCandidate } from "@/src/server/metrics/self-optimization.service";
import { buildSetupFeatureSnapshot } from "@/src/server/metrics/setup-feature-utils";
import { evaluateOrchestration } from "@/src/server/orchestration";
import { evaluateMomentumBreakout } from "@/src/server/scanner/momentum-breakout.service";
import { getRuntimeStrategyParams } from "@/src/server/config/strategy-runtime.service";
import { runPreTradeSafetyValidation } from "@/src/server/execution-safety/pre-trade-validator.service";
import { recordExecutionFailure } from "@/src/server/execution-safety/recovery-engine.service";
import { resolveUnifiedExecutionPlan } from "@/src/server/execution-management/unified-execution-pipeline.service";
import { replayExecutionRecord } from "@/src/server/execution-management/execution-replay.service";
import type { ExecuteTradeInput, ExecutionResult, PositionCloseReason, SelectedTradeOpportunity, TradingMode } from "@/src/server/execution/types";
import type { ScannerCandidate } from "@/src/types/scanner";
import type { AIConsensusResult } from "@/src/types/ai";
import {
  claimIdempotentExecutionIntent,
  getIdempotentExecution,
  getSafeModeState,
  persistAnalysisState,
  setSafeModeState,
  setIdempotentExecution,
} from "@/src/server/recovery/failsafe-recovery.service";
import { executePaperOrderViaExchangeSimulator } from "@/src/server/exchange-simulator/paper-exchange-adapter.service";
import {
  buildExecutionTelemetry,
  evaluatePreSubmitExecution,
  resolveAdaptiveRetryPolicy,
} from "@/src/server/execution/execution-intelligence.service";
import { recordLearningEvaluation } from "@/src/server/execution/authority-counters.service";
import { notifySystemEvent } from "@/src/server/notifications/notification.service";
import { feedbackLoopEngine } from "@/src/server/trading-core/feedback-loop";
import type { FeedbackRejectTradeInput } from "@/src/server/trading-core/feedback-loop";
import {
  getCrossModeLearningPolicy,
  getImmediateLearningRiskPolicy,
  resolveAdaptiveAdjustment,
  resolveImmediateLearningRiskAdjustment,
} from "@/src/server/trading-core/self-learning/learning-store";
import {
  evaluateAiExecutionReadiness,
  resolveAiExecutionGatePolicy,
  type AiExecutionGateEvaluation,
} from "@/src/server/execution/ai-execution-gate.service";
import { createCandidateId } from "@/src/server/forensics/forensic-collector.service";
import {
  bridgeAiExecutionGate,
  bridgeEntryTimingForensics,
  bridgeExecutionCandidateForensic,
  bridgeFeeEdgeMetrics,
  bridgeFeeAwareEntryPolicy,
  bridgeMeanReversionEntry,
  bridgeStrategyDecision,
  bridgeTdiDecision,
} from "@/src/server/forensics/forensic-bridge.service";
import { computeFeeEdgeMetrics } from "@/src/server/forensics/fee-edge-metrics.service";
import {
  attachPositionIdToSnapshot,
  buildDecisionFeatureSnapshot,
  type DecisionFeatureSnapshot,
} from "@/src/server/forensics/decision-time-tdi-telemetry.service";
import { getForensicSession } from "@/src/server/forensics/forensic-context";
import {
  CanonicalExecutionError,
  classifyExecutionFailure,
  formatCanonicalExecutionReason,
  preserveExecutionFailure,
  redactExecutionError,
  resolveExecutionFailure,
} from "@/src/server/execution/execution-failure-contract";
import { recordPaperFillEvent } from "@/src/server/paper-validation/paper-trade-recorder.service";
import { markPaperPersistenceReconciliation } from "@/src/server/execution/paper-persistence-reconciliation.service";
import { evaluateCanonicalRegime, routeStrategies } from "@/src/server/forensics/p4-regime-strategy-shadow";
import { resolveStrategyActivationMode, type StrategyStatus } from "@/src/server/execution/p7-paper-strategy-contract";

type CanonicalEntryDecision = {
  candidateId: string;
  symbol: string;
  verdict: "ENTER" | "WAIT" | "REJECT";
  firstBlocker: string | null;
  reasonCodes: string[];
  qualityComponents: Record<string, number | null>;
  dataQuality: {
    status: "COMPLETE" | "DEGRADED" | "INSUFFICIENT";
    missing: string[];
    stale: string[];
  };
  advisory: {
    aiDecision: string | null;
    tdiDecision: string | null;
    learningDecision: string | null;
  };
  evaluatedAt: string;
  policyVersion: string;
};

function mapOrderStatus(raw: string): "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" {
  const upper = raw.toUpperCase();
  if (upper.includes("PARTIALLY")) return "PARTIALLY_FILLED";
  if (upper.includes("FILLED") || upper.includes("SIMULATED")) return "FILLED";
  if (upper.includes("CANCELED")) return "CANCELED";
  if (upper.includes("EXPIRED")) return "EXPIRED";
  if (upper.includes("REJECT")) return "REJECTED";
  return "NEW";
}

async function recordExecutionRejectLearning(input: {
  executionId: string;
  userId?: string;
  mode: TradingMode;
  reason: string;
  requestedSymbol?: string;
  candidate?: ScannerCandidate | null;
}) {
  const candidate = input.candidate ?? null;
  const ai = candidate?.ai;
  const symbol = candidate?.context.symbol ?? input.requestedSymbol ?? "AUTO";
  const side = ai?.finalDecision === "SELL" ? "SELL" : "BUY";
  const marketRegime = candidate ? String(candidate.context.metadata.marketRegime ?? "UNKNOWN") : "UNKNOWN";
  const strategy = candidate ? String(candidate.context.metadata.marketRegimeStrategy ?? "execution-reject") : "execution-reject";
  const confidenceScore = Number(ai?.analysisScorecard?.confidenceScore ?? ai?.finalConfidence ?? 0);
  const entryPrice = Number(candidate?.context.lastPrice ?? 0);
  const payload: FeedbackRejectTradeInput = {
    tradeId: `reject-${input.executionId}`,
    botId: `execution-${input.mode}`,
    strategy,
    symbol,
    side,
    entryPrice: Number.isFinite(entryPrice) && entryPrice > 0 ? entryPrice : 0,
    quantity: 0,
    market: {
      marketRegime,
      volatilityPercent: candidate?.context.volatilityPercent,
      orderbookImbalancePercent: candidate?.context.orderBookImbalance,
      spreadPercent: candidate?.context.spreadPercent,
      volumeRatio: Number(candidate?.context.metadata.volumeSpikeRatio ?? candidate?.context.volumeSpikePercent ?? 0),
      liquidityUsd: candidate?.context.volume24h,
      newsSpikeScore: candidate?.context.fakeSpikeScore,
    },
    strategySnapshot: {
      strategy,
      params: {
        mode: input.mode,
        requestedSymbol: input.requestedSymbol ?? "",
        scannerScore: candidate?.score.score ?? 0,
        aiDecision: ai?.finalDecision ?? "NO_TRADE",
        aiRiskScore: ai?.finalRiskScore ?? 0,
        userId: input.userId ?? "",
      },
      minScore: env.EXECUTION_FAST_MIN_CONFIDENCE,
      confidenceScore,
    },
    rejectReason: input.reason,
    confidenceScore,
    rejectedAt: new Date().toISOString(),
  };
  try {
    await feedbackLoopEngine.rejectTrade(payload);
  } catch (error) {
    logger.warn({ error: (error as Error).message, executionId: input.executionId }, "Execution reject feedback failed");
  }
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

function getMode(input?: Pick<ExecuteTradeInput, "executionMode">): TradingMode {
  return input?.executionMode ?? env.EXECUTION_MODE;
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

function isTransientOrderError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("http 429") ||
    lower.includes("too many requests") ||
    lower.includes("rate limit") ||
    lower.includes("timeout") ||
    lower.includes("temporarily") ||
    lower.includes("http 5") ||
    lower.includes("server_error")
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
  const feePercentBase = resolveRoundTripTakerFeePercent();
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

  const effective = outputs.filter((x) => x.decision === side);
  if (effective.length === 0) {
    return {
      expectedProfitPercent: 0,
      suggestedDurationSec: 0,
      allowedDurationSec: resolveDurationWindowByProfit(0),
      eligible: false,
      reason: "No directional AI target",
    };
  }
  const profits = effective
    .map((x) => {
      return computeDirectionalProfitPercent({ side, entryPrice: lastPrice, targetPrice: x.targetPrice });
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
      executionMode: env.EXECUTION_MODE,
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
  return Math.max(120, Math.min(86_400, value));
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

function resolveStrategyStatus(raw: unknown): StrategyStatus {
  const normalized = String(raw ?? "PAPER_EXPERIMENT").trim().toUpperCase();
  if (normalized === "SHADOW_ONLY") return "SHADOW_ONLY";
  if (normalized === "OFFLINE_CANDIDATE") return "OFFLINE_CANDIDATE";
  if (normalized === "LIVE_NOT_APPROVED") return "LIVE_NOT_APPROVED";
  if (normalized === "NOT_SUPPORTED") return "NOT_SUPPORTED";
  return "PAPER_EXPERIMENT";
}

function inferTdiBlockingConditions(reasonDetail: string) {
  const tokens = String(reasonDetail ?? "")
    .split("|")
    .map((row) => row.trim().toUpperCase())
    .filter(Boolean);
  const conditions: Array<"TECHNICAL" | "MOMENTUM" | "CONFIDENCE" | "RISK" | "MTF_ALIGNMENT" | "NEUTRAL"> = [];
  for (const token of tokens) {
    if (token.includes("TEKNIK") || token.includes("TECH")) {
      if (!conditions.includes("TECHNICAL")) conditions.push("TECHNICAL");
      continue;
    }
    if (token.includes("MOMENTUM") || token.includes("FLOW")) {
      if (!conditions.includes("MOMENTUM")) conditions.push("MOMENTUM");
      continue;
    }
    if (token.includes("CONFIDENCE") || token.includes("BELOW_THRESHOLD")) {
      if (!conditions.includes("CONFIDENCE")) conditions.push("CONFIDENCE");
      continue;
    }
    if (token.includes("RISK") || token.includes("VETO") || token.includes("TRAP")) {
      if (!conditions.includes("RISK")) conditions.push("RISK");
      continue;
    }
    if (token.includes("TIMEFRAME") || token.includes("MTF")) {
      if (!conditions.includes("MTF_ALIGNMENT")) conditions.push("MTF_ALIGNMENT");
      continue;
    }
  }
  if (conditions.length === 0) conditions.push("NEUTRAL");
  return conditions;
}

function scoreMomentumFromContext(candidate: ScannerCandidate) {
  const shortMomPct = Math.abs(Number(candidate.context.metadata.shortMomentumPercent ?? 0));
  const change5m = Math.abs(Number(candidate.context.metadata.change5m ?? 0));
  const change15m = Math.abs(Number(candidate.context.metadata.change15m ?? 0));
  const raw = shortMomPct * 28 + change5m * 10 + change15m * 4;
  return Math.max(0, Math.min(100, raw));
}

function buildExecutionTdiTelemetry(input: {
  candidate: ScannerCandidate;
  ai: AIConsensusResult;
  marketRegime: ReturnType<typeof readMarketRegimeMeta>;
  mode: TradingMode;
  learningLane: boolean;
  scorecardConfidence: number;
  reasonDetail: string;
}) {
  const roleScores = Array.isArray(input.ai.roleScores) ? input.ai.roleScores : [];
  const technical = roleScores.find((row) => row.role === "AI-1_TECHNICAL");
  const sentiment = roleScores.find((row) => row.role === "AI-2_SENTIMENT");
  const risk = roleScores.find((row) => row.role === "AI-3_RISK");
  const blocked = inferTdiBlockingConditions(input.reasonDetail);
  const thresholds = input.ai.decisionPayload?.strategyRuntime;
  const learningScore = Number(
    (input.ai.decisionPayload as Record<string, unknown> | undefined)?.masterDecisionEngine &&
    typeof (input.ai.decisionPayload as Record<string, unknown>).masterDecisionEngine === "object" &&
    (input.ai.decisionPayload as Record<string, unknown>).masterDecisionEngine !== null &&
    typeof ((input.ai.decisionPayload as Record<string, unknown>).masterDecisionEngine as Record<string, unknown>).matrix === "object"
      ? Number(
          (((input.ai.decisionPayload as Record<string, unknown>).masterDecisionEngine as Record<string, unknown>).matrix as Record<string, unknown>).learning ??
            NaN,
        )
      : NaN,
  );
  const openInterest = Number(input.candidate.context.metadata.openInterest ?? input.ai.decisionPayload?.futuresIntel?.openInterest ?? NaN);
  const momentumScore = scoreMomentumFromContext(input.candidate);
  return {
    finalDecision: input.ai.finalDecision,
    scoreType: input.ai.decisionPayload?.masterDecisionEngine ? "MASTER_EXPERT_AVERAGE" : "HYBRID_COMPOSITE",
    technicalScore: technical?.score,
    momentumScore: Number.isFinite(momentumScore) ? momentumScore : sentiment?.score,
    sentimentScore: sentiment?.score,
    shortMomentum: Number(input.candidate.context.metadata.shortMomentumPercent ?? NaN),
    shortFlow: Number(input.candidate.context.metadata.shortFlowImbalance ?? NaN),
    executionScore: Number(input.candidate.score.score ?? NaN),
    confidence: input.ai.finalConfidence,
    bullishCount: roleScores.filter((row) => row.decision === "BUY").length,
    learningScore: Number.isFinite(learningScore) ? learningScore : undefined,
    liquidity: Number(input.candidate.context.volume24h ?? NaN),
    volatility: Number(input.candidate.context.volatilityPercent ?? NaN),
    expectedValue: Number(input.ai.score ?? NaN),
    openInterest: Number.isFinite(openInterest) ? openInterest : undefined,
    marketContext: input.marketRegime.reason,
    simulation: input.mode === "paper" ? "PAPER" : "LIVE",
    trendData: input.marketRegime.mode,
    thresholds: {
      technicalMinScore: thresholds?.technicalMinScore,
      sentimentMinScore: thresholds?.sentimentMinScore,
      compositeMinScore: thresholds?.consensusMinScore,
      confidenceMinScore: thresholds?.aiScoreThreshold,
    },
    regime: input.marketRegime.mode,
    regimeDelta: undefined,
    paperRelaxed: input.mode === "paper",
    learningLane: input.learningLane,
    firstBlockingCondition: blocked[0],
    blockingConditions: blocked,
  } as const;
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
  const futuresRiskScore = Number(candidate.context.metadata.futuresRiskScore ?? candidate.ai?.decisionPayload?.futuresIntel?.riskScore ?? 0);
  const leveragedTrapProbability = Number(candidate.context.metadata.leveragedTrapProbability ?? candidate.ai?.decisionPayload?.futuresIntel?.leveragedTrapProbability ?? 0);
  const futuresIntent = String(candidate.context.metadata.futuresIntent ?? candidate.ai?.decisionPayload?.futuresIntel?.intent ?? "NEUTRAL");
  const regimeTransitionProbability = Number(candidate.context.metadata.regimeTransitionProbability ?? candidate.ai?.decisionPayload?.regimeStability?.transitionProbability ?? 0);
  const regimeFlipRisk = Number(candidate.context.metadata.regimeFlipRisk ?? candidate.ai?.decisionPayload?.regimeStability?.flipRisk ?? 0);
  const regimeChaosProbability = Number(candidate.context.metadata.regimeChaosProbability ?? candidate.ai?.decisionPayload?.regimeStability?.chaosProbability ?? 0);
  const regimeLifecyclePhase = String(candidate.context.metadata.regimeLifecyclePhase ?? candidate.ai?.decisionPayload?.regimeStability?.lifecyclePhase ?? "UNKNOWN");
  const regimeChopWarning = Boolean(candidate.context.metadata.regimeChopWarning ?? candidate.ai?.decisionPayload?.regimeStability?.chopWarning ?? false);
  const timeframe = candidate.ai?.decisionPayload?.timeframeAnalysis;
  const roleDecisions = (candidate.ai?.roleScores ?? []).map((x) => x.decision);
  const uniqueRoleDecisions = new Set(roleDecisions.filter((x) => x === "BUY" || x === "SELL"));
  const conflictingSignals = uniqueRoleDecisions.size > 1;
  const orderBookImbalance = Number(candidate.context.orderBookImbalance ?? 0);
  const hybridApprovedBuy =
    input.decision === "BUY" && input.confidence >= env.EXECUTION_FAST_MIN_CONFIDENCE;

  const uncertainMarket =
    (marketRegime === "RANGE_SIDEWAYS" || marketRegime === "LOW_VOLATILITY_CALM") &&
    Math.abs(shortMomentum) < 0.08 &&
    Math.abs(shortFlow) < 0.03;
  if (uncertainMarket && !hybridApprovedBuy) {
    reasons.push("Piyasa belirsiz (range/low-vol + dusuk momentum/akis)");
  }
  if (
    !hybridApprovedBuy &&
    (conflictingSignals || timeframe?.conflict || !timeframe?.trendAligned || !timeframe?.entrySuitable)
  ) {
    reasons.push("Sinyal cakismasi (AI katmanlari veya timeframe uyumsuz)");
  }
  if (candidate.context.volatilityPercent >= env.EXECUTION_BLOCK_HIGH_VOLATILITY_PERCENT) {
    reasons.push(`Volatilite asiri (${candidate.context.volatilityPercent.toFixed(3)}%)`);
  }
  if (candidate.context.volume24h < env.SCANNER_MIN_VOLUME_24H) {
    reasons.push(`Hacim dusuk (${candidate.context.volume24h.toFixed(2)})`);
  }
  if (input.decision === "BUY" && orderBookImbalance <= -0.35) {
    reasons.push("Satis duvari guclu (order book imbalance negatif)");
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
  if (futuresRiskScore >= 78 || leveragedTrapProbability >= 82) {
    reasons.push(`Futures protection aktif (${futuresIntent}, risk=${futuresRiskScore.toFixed(1)}, trap=${leveragedTrapProbability.toFixed(1)})`);
  }
  if (regimeChopWarning || regimeTransitionProbability >= 72 || regimeFlipRisk >= 78 || regimeChaosProbability >= 84) {
    reasons.push(
      `Regime stability protection aktif (${regimeLifecyclePhase}, transition=${regimeTransitionProbability.toFixed(1)}, flip=${regimeFlipRisk.toFixed(1)})`,
    );
  }
  const noTradeModeReasons = candidate.ai?.decisionPayload?.noTradeMode?.reasonList ?? [];
  if (noTradeModeReasons.length > 0) {
    reasons.push(...noTradeModeReasons.map((x) => `No-trade mode: ${x}`));
  }
  return Array.from(new Set(reasons));
}

function resolveLearningLaneHardRejects(input: {
  candidate: ScannerCandidate;
  liveDataHealthy: boolean;
  paperMode?: boolean;
}) {
  const reasons: string[] = [];
  const { candidate } = input;
  const paperMode = input.paperMode ?? false;
  void input.liveDataHealthy;
  const roleRisk = candidate.ai?.roleScores?.find((x) => x.role === "AI-3_RISK");
  const blockedBy = candidate.ai?.decisionPayload?.consensusEngine?.vetoStatus?.blockedBy ?? [];
  const marketRegime = String(candidate.context.metadata.marketRegime ?? "RANGE_SIDEWAYS");
  const timeframe = candidate.ai?.decisionPayload?.timeframeAnalysis;
  const fakeBreakoutRisk = Number(
    candidate.context.metadata.fakeBreakoutRiskScore ??
      candidate.context.metadata.manipulationRiskScore ??
      candidate.context.fakeSpikeScore * 40,
  );

  if (paperMode) {
    // Learning lane cannot own hard execution authority; keep as advisory only.
    return [];
  }
  if (candidate.context.spreadPercent > 0.24) {
    reasons.push(`spread too wide (${candidate.context.spreadPercent.toFixed(4)}%)`);
  }
  const riskExposure = Number(candidate.ai?.finalRiskScore ?? roleRisk?.score ?? 0);
  if ((roleRisk?.veto || (Array.isArray(blockedBy) && blockedBy.includes("AI-3_RISK"))) && riskExposure >= 70 && !paperMode) {
    reasons.push("AI-3 risk veto");
  }
  const alignmentScore = Number(timeframe?.alignmentScore ?? 0);
  if (!paperMode) {
    if (timeframe?.conflict && alignmentScore < 30) {
      reasons.push("MTF conflict");
    }
    if ((!timeframe?.trendAligned || !timeframe?.entrySuitable) && alignmentScore < 25) {
      reasons.push("MTF entry quality too low");
    }
  }
  if (marketRegime === "LOW_VOLUME_DEAD_MARKET" || candidate.context.volume24h < env.SCANNER_MIN_VOLUME_24H) {
    reasons.push("low volume dead market");
  }
  if (candidate.context.fakeSpikeScore >= 2.8 || fakeBreakoutRisk >= 88) {
    reasons.push("fake breakout/manipulation risk high");
  }
  return Array.from(new Set(reasons));
}

function canOpenLearningLaneMicroTrade(input: {
  candidate: ScannerCandidate;
  confidence: number;
}) {
  const decision = input.candidate.ai?.finalDecision;
  if (decision === "BUY" || decision === "SELL") return true;
  if (decision !== "HOLD" && decision !== "NO_TRADE") return false;
  const shortMomentum = Number(input.candidate.context.metadata.shortMomentumPercent ?? 0);
  const shortFlow = Number(input.candidate.context.metadata.shortFlowImbalance ?? 0);
  const scoreQualified = input.candidate.score.status === "QUALIFIED" || input.candidate.score.score >= 35;
  return input.confidence >= 25 && scoreQualified && (shortMomentum >= -0.12 || shortFlow >= -0.08);
}

async function evaluateSmartEntryGate(input: {
  candidate: ScannerCandidate;
  ai: ScannerCandidate["ai"];
  side: "BUY" | "SELL";
  entryPrice: number;
  takeProfitPercent: number;
  stopLossPercent: number;
}) {
  let entryAiDetails: Awaited<ReturnType<typeof evaluateEntryForBuyCandidate>> | null = null;

  if (
    env.EXECUTION_ENGINE_V2_ENABLED &&
    env.EXECUTION_ENGINE_V2_ENTRY_AI_ENABLED &&
    input.side === "BUY"
  ) {
    const ai = input.ai;
    if (!ai) return { pass: false, reason: "AI unavailable for Entry AI", details: null };

    try {
      entryAiDetails = await evaluateEntryForBuyCandidate({
        symbol: input.candidate.context.symbol,
        decisionId: String(input.candidate.context.metadata.decisionId ?? input.candidate.context.symbol),
        decisionConfidence: ai.finalConfidence,
        price: input.entryPrice,
        decision: ai.finalDecision,
      });
    } catch (error) {
      return {
        pass: false,
        reason: `Entry AI evaluation failed: ${(error as Error).message}`,
        details: null,
      };
    }

    if (entryAiDetails.decision === "REJECT") {
      return {
        pass: false,
        reason: entryAiDetails.reasons[0] ?? "Entry AI rejected candidate",
        details: { entryAi: entryAiDetails },
      };
    }
    if (entryAiDetails.decision.startsWith("WAIT_")) {
      return {
        pass: false,
        reason: `Entry AI: ${entryAiDetails.decision}`,
        details: { entryAi: entryAiDetails },
      };
    }
    if (!isEntryApprovedForExecution(entryAiDetails)) {
      return {
        pass: false,
        reason: "Entry AI confidence below execution threshold",
        details: { entryAi: entryAiDetails },
      };
    }
  }

  if (!env.EXECUTION_SMART_ENTRY_ENABLED) {
    return {
      pass: true,
      reason: entryAiDetails ? "Entry AI confirmed" : "smart-entry-disabled",
      details: entryAiDetails ? { entryAi: entryAiDetails } : null,
    };
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
      details: entryAiDetails ? { entryAi: entryAiDetails, smartEntry } : smartEntry,
    };
  }
  return {
    pass: true,
    reason: entryAiDetails ? "Entry AI and smart entry confirmed" : "Smart entry engine confirmed",
    details: entryAiDetails ? { entryAi: entryAiDetails, smartEntry } : smartEntry,
  };
}

async function resolveDynamicExitReason(input: {
  symbol: string;
  side: "LONG" | "SHORT";
  paperMode?: boolean;
}): Promise<PositionCloseReason | null> {
  if (input.paperMode) return null;
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
      executionMode: env.EXECUTION_MODE,
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
  tradeId?: string;
  roundId?: string;
  symbol: string;
  side: "LONG" | "SHORT";
  quantity?: number;
  strategy?: string;
  regime?: string;
  openedAt: string;
  entryPrice: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  targetSellPercent?: number;
  trailingStartPercent?: number;
  trailingGapPercent?: number;
  maxDurationSec: number;
  partialTpPlan?: {
    enabled?: boolean;
    firstTargetPercent?: number;
    trailingDrawdownPercent?: number;
  };
  mode: TradingMode;
  source: "OPEN" | "RECOVERY";
  isPumpTrade?: boolean;
  variantDShadowEnabled?: boolean;
  variantDEnabled?: boolean;
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
    userId: input.userId,
    positionId: input.positionId,
    tradeId: input.tradeId ?? input.positionId,
    roundId: input.roundId,
    symbol: input.symbol,
    side: input.side,
    quantity: input.quantity,
    strategy: input.strategy,
    regime: input.regime,
    openedAt: input.openedAt,
    entryPrice: input.entryPrice,
    takeProfitPrice: input.takeProfitPrice,
    stopLossPrice: input.stopLossPrice,
    targetSellPercent: input.targetSellPercent,
    trailingStartPercent: input.trailingStartPercent,
    trailingGapPercent: input.trailingGapPercent,
    maxDurationSec: input.maxDurationSec,
    partialTpPlan: input.partialTpPlan,
    mode: input.mode,
    isPumpTrade: input.isPumpTrade,
    variantDShadowEnabled: input.variantDShadowEnabled,
    variantDEnabled: input.variantDEnabled,
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
        paperMode: input.mode === "paper",
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
          paperMode: input.mode === "paper",
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
            isPumpTrade: input.isPumpTrade,
          };
    },
    onTick: async ({ positionId }) => {
      const live = await syncUnrealizedPnl(positionId);
      if (!live) return;
      await updatePositionMarkPrice(positionId, live.markPrice, live.unrealizedPnl).catch(() => null);
      if (input.mode === "paper") {
        return;
      }
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
        variantDEnabled: input.variantDEnabled,
        baselineComparableExitReason:
          input.variantDEnabled && reason === "TIMEOUT" ? "BASELINE_COMPARABLE_NOT_CAPTURED" : reason,
        actualVariantDExitReason: input.variantDEnabled ? reason : null,
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
    ensureLivePositionTracking(user.id);
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
      const targetSellPercent = Number(metadata.targetSellPercent ?? NaN);
      const trailingStartPercent = Number(metadata.trailingStartPercent ?? NaN);
      const trailingGapPercent = Number(metadata.trailingGapPercent ?? NaN);
      const smartExitStateRaw =
        typeof metadata.smartExitState === "object" && metadata.smartExitState
          ? (metadata.smartExitState as Record<string, unknown>)
          : undefined;
      await attachPositionMonitor({
        executionId,
        userId: user.id,
        positionId: position.id,
        tradeId: position.id,
        roundId: typeof metadata.roundId === "string" ? metadata.roundId : undefined,
        symbol: position.tradingPair.symbol,
        side: position.side,
        quantity: Number(position.quantity ?? 0),
        strategy: typeof metadata.marketRegimeStrategy === "string" ? metadata.marketRegimeStrategy : undefined,
        regime: typeof metadata.marketRegime === "string" ? metadata.marketRegime : undefined,
        openedAt: position.openedAt.toISOString(),
        entryPrice: position.entryPrice,
        takeProfitPrice: Number.isFinite(tpRaw) && tpRaw > 0 ? tpRaw : undefined,
        stopLossPrice: Number.isFinite(slRaw) && slRaw > 0 ? slRaw : undefined,
        targetSellPercent: Number.isFinite(targetSellPercent) ? targetSellPercent : undefined,
        trailingStartPercent: Number.isFinite(trailingStartPercent) ? trailingStartPercent : undefined,
        trailingGapPercent: Number.isFinite(trailingGapPercent) ? trailingGapPercent : undefined,
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
        isPumpTrade: Boolean(metadata.pumpEarlyCatcher ?? metadata.pumpEarlyConfirmed ?? false),
        variantDShadowEnabled:
          env.EXECUTION_VARIANT_D_SHADOW_ENABLED || Boolean(metadata.variantDShadowEnabled ?? false),
        variantDEnabled:
          env.EXECUTION_VARIANT_D_ENABLED || Boolean(metadata.variantDEnabled ?? false),
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
  const aiInput = await formatAIRequest(context, {
    scannerScore: score.score,
    ...runtimeStrategy,
    executionMode: env.EXECUTION_MODE,
  });
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

async function executeAnalyzeAndTradeInternal(input: ExecuteTradeInput): Promise<ExecutionResult> {
  const executionId = randomUUID();
  const mode = getMode(input);
  const paperRelaxed = mode === "paper";
  const learningLane = mode === "paper" && input.learningLane === true;
  const forensicSession = getForensicSession();
  const executionIdentity = {
    campaignId: input.campaignId ?? forensicSession?.campaignId ?? null,
    jobId: forensicSession?.jobId ?? input.sessionId ?? null,
    sessionId: input.sessionId ?? forensicSession?.sessionId ?? null,
    runId: input.runId ?? forensicSession?.runId ?? null,
    roundId: input.roundId ?? forensicSession?.roundId ?? null,
    candidateId: null as string | null,
    venue: "BINANCE_TR",
    executionMode: mode,
  };
  const decisionTrace = beginDecisionTrace({
    decisionId: executionId,
    analysisId: executionId,
    symbol: (input.requestedSymbol ?? "AUTO").toUpperCase(),
    deferPersistence: true,
    source: "execution",
  });
  let obsSelected: ScannerCandidate | undefined;
  let obsAi: AIConsensusResult | undefined;
  let obsQualityGate: SignalQualityResult | undefined;
  let obsResult: ExecutionResult | undefined;
  let canonicalCandidateId = "";
  const idempotencyKey = String(
    input.requestedSymbol ?? "auto",
  ) + `:${String(input.requestedQuoteAmountTry ?? input.requestedQuantity ?? "default")}:${mode}`;
  const finishExecution = (result: ExecutionResult): ExecutionResult => {
    obsResult = result;
    return result;
  };

  return runWithDecisionTrace(decisionTrace, async () => {
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
    context: { mode, requestedSymbol: input.requestedSymbol, learningLane },
  });
  publishExecutionEvent({
    executionId,
    symbol: input.requestedSymbol,
    stage: "EXECUTION_PRECHECK_STARTED",
    status: "RUNNING",
    message: "Execution selected-candidate flow started",
    level: "INFO",
    context: executionIdentity,
  });

  try {
    if (mode === "live" && (!env.BINANCE_API_KEY || !env.BINANCE_API_SECRET)) {
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
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: safeMode.reason ?? "Safe mode active",
      });
    }
    await persistAnalysisState({
      userId: user.id,
      executionId,
      symbol: input.requestedSymbol,
      stage: "start",
      status: "RUNNING",
    });
    if (!input.bypassIdempotency) {
      const claim = await claimIdempotentExecutionIntent(user.id, idempotencyKey, executionId);
      if (!claim.claimed) {
        const existing = claim.existing ?? (await getIdempotentExecution(user.id, idempotencyKey));
        const existingExecutionId = typeof existing?.executionId === "string" ? String(existing.executionId) : executionId;
        const existingState = String(existing?.executionState ?? "").toUpperCase();
        if (existingState === "IN_PROGRESS") {
          const inProgressFailure = classifyExecutionFailure(new Error("Duplicate order blocked by idempotency in progress"), {
            operation: "execution_idempotency_claim",
            dependency: "idempotency_store",
            executionMode: mode,
          });
          return finishExecution({
            executionId: existingExecutionId,
            mode,
            opened: false,
            rejected: true,
            rejectReason: formatCanonicalExecutionReason(inProgressFailure),
            symbol: typeof existing?.symbol === "string" ? String(existing.symbol) : input.requestedSymbol,
            details: { ...inProgressFailure },
          });
        }
        if (existing && typeof existing.executionId === "string") {
          return finishExecution({
            executionId: String(existing.executionId),
            mode,
            opened: Boolean(existing.opened),
            rejected: Boolean(existing.rejected),
            rejectReason: typeof existing.rejectReason === "string" ? existing.rejectReason : undefined,
            symbol: typeof existing.symbol === "string" ? existing.symbol : undefined,
            orderId: typeof existing.orderId === "string" ? existing.orderId : undefined,
            positionId: typeof existing.positionId === "string" ? existing.positionId : undefined,
          });
        }
      }
    }
    await ensureOpenPositionMonitors(user.id).catch(() => null);
    const emergencyStopEnabled = await getEmergencyStopState(user.id);
    if (emergencyStopEnabled && mode !== "paper") {
      publishExecutionEvent({
        executionId,
        stage: "risk-gate",
        status: "FAILED",
        message: "Emergency stop aktif, trade reddedildi",
        level: "WARN",
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Emergency stop enabled",
      });
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
      await logTradeEvent({
        symbol: input.requestedSymbol ?? "UNKNOWN",
        eventType: "RISK_GATE_BLOCKED",
        reason: "Max open positions reached",
        newValue: { openPositionCount: preOpenPositions.length },
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Açık pozisyon varken yeni analiz başlatılmaz.",
      });
    }

    publishExecutionEvent({
      executionId,
      stage: "scanner",
      status: "RUNNING",
      message: input.preselectedCandidate ? "Onceden secilen aday dogrulaniyor" : "Scanner calisiyor",
      level: "INFO",
      context: input.preselectedCandidate
        ? {
            symbol: input.preselectedCandidate.context.symbol,
            confidence: input.preselectedCandidate.ai?.finalConfidence,
            decision: input.preselectedCandidate.ai?.finalDecision,
          }
        : undefined,
    });
    await persistAnalysisState({
      userId: user.id,
      executionId,
      symbol: input.requestedSymbol,
      stage: "scanner",
      status: "RUNNING",
    });
    let selected = input.preselectedCandidate;
    if (!selected) {
      const fast = await getBestFastEntry({
        excludeSymbols: [],
        forcePaperProfile: paperRelaxed,
        runtime: {
          forceFreshScanner: true,
          roundId: input.roundId,
          runId: input.runId,
        },
      }).catch(() => null);
      selected = pickBestCandidate(fast?.selected ? [fast.selected] : [], input.requestedSymbol);
      if (!selected) {
        const snapshot = getScannerWorkerSnapshot();
        const snapshotAgeMs = snapshot.updatedAt ? Date.now() - new Date(snapshot.updatedAt).getTime() : Number.POSITIVE_INFINITY;
        const useSnapshot = Boolean(snapshot.detailed && snapshotAgeMs < 60_000 && snapshot.detailed.candidates.length > 0);
        if (useSnapshot) {
          selected = pickBestCandidate(snapshot.detailed!.candidates, input.requestedSymbol);
        }
      }
      if (!selected && input.requestedSymbol) {
        const scanner = await runScannerPipeline(user.id, {
          includeAi: true,
          persistRejected: false,
          persist: false,
          runtime: {
            runId: input.runId,
            roundId: input.roundId,
            forbidLegacyScanner: true,
          },
        });
        selected = pickBestCandidate(scanner.candidates, input.requestedSymbol);
      }
      if (!selected && input.requestedSymbol) {
        const custom = await buildOpportunityForSymbol(input.requestedSymbol);
        if (custom) {
          selected = custom.candidate;
        }
      }
    }

    if ((!selected || !selected.ai) && paperRelaxed && input.requestedSymbol) {
      const fallbackContext = await buildMarketContext(input.requestedSymbol).catch(() => null);
      if (fallbackContext) {
        const fallbackScore = scoreContext(fallbackContext);
        const inferredDecision = Number(fallbackContext.metadata.shortMomentumPercent ?? 0) >= 0 ? "BUY" : "SELL";
        selected = {
          rank: 1,
          context: fallbackContext,
          score: fallbackScore,
          ai: {
            finalDecision: inferredDecision,
            finalConfidence: Math.max(55, Math.min(85, fallbackScore.confidence)),
            finalRiskScore: 35,
            score: fallbackScore.score,
            rejected: false,
            explanation: "Paper fallback: requested symbol used with inferred direction.",
            outputs: [],
            roleScores: [],
            generatedAt: new Date().toISOString(),
          },
        } as ScannerCandidate;
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
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "No tradeable candidate after scanner+AI",
      });
    }

    const ai = selected.ai;
    canonicalCandidateId = String(selected.context.metadata.opportunityCandidateId ?? "").trim();
    executionIdentity.candidateId = canonicalCandidateId || null;
    if (!canonicalCandidateId) {
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "HANDOFF_IDENTITY_MISSING",
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
      });
    }
    if (!getCanonicalCandidateStore().getCandidate(canonicalCandidateId)) {
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "HANDOFF_CANDIDATE_NOT_FOUND",
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
      });
    }
    getCanonicalCandidateStore().transitionCandidate(canonicalCandidateId, "FINAL_RANKED", [
      "EXECUTION_PIPELINE_SELECTED",
    ]);
    obsSelected = selected;
    obsAi = ai;
    recordDecisionTimelineEvent({
      stage: "SCANNER",
      outcome: selected.score.status,
      message: `Scanner selected ${selected.context.symbol}`,
      details: {
        scannerScore: selected.score.score,
        scannerConfidence: selected.score.confidence,
      },
    });
    recordDecisionTimelineEvent({
      stage: "AI",
      outcome: ai.finalDecision,
      message: ai.explanation,
      details: {
        confidence: ai.finalConfidence,
        riskScore: ai.finalRiskScore,
      },
    });
    const liveDataHealthy = Boolean(selected.context.metadata.liveDataHealthy ?? true);
    if (!liveDataHealthy && !paperRelaxed) {
      await logTradeEvent({
        symbol: selected.context.symbol,
        eventType: "RISK_GATE_BLOCKED",
        reason: "Market data gecikmeli/bozuk",
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "MARKET_DATA_DELAYED",
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
      });
    }
    const healthyProviders = ai.outputs?.filter((x) => {
      if (!x.ok || !x.output) return false;
      const state = x.healthState ?? (x.remoteOk ? "HEALTHY" : "DEGRADED");
      return state === "HEALTHY";
    }) ?? [];
    if (ai.rejectReason === "AI_PROVIDER_DEGRADED") {
      await logTradeEvent({
        symbol: selected.context.symbol,
        eventType: "RISK_GATE_BLOCKED",
        reason: "AI provider degraded — advisory only",
      });
    }
    if (healthyProviders.length === 0) {
      await logTradeEvent({
        symbol: selected.context.symbol,
        eventType: "RISK_GATE_BLOCKED",
        reason: "AI response missing — advisory only",
      });
    }
    const dataQualityIssues = Array.isArray(selected.context.metadata.dataQualityIssues)
      ? (selected.context.metadata.dataQualityIssues as string[])
      : [];
    if (dataQualityIssues.length > 0) {
      const reason = `Data quality issue: ${dataQualityIssues.join(", ")}`;
      await logTradeEvent({
        symbol: selected.context.symbol,
        eventType: "RISK_GATE_BLOCKED",
        reason,
        aiConfidence: ai.finalConfidence,
      });
      await addSystemLog({
        level: "WARN",
        source: "data-quality",
        message: reason,
        context: {
          symbol: selected.context.symbol,
          issues: dataQualityIssues,
        },
      }).catch(() => null);
      if (!paperRelaxed) {
        return finishExecution({
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: reason,
          symbol: selected.context.symbol,
          decision: ai.finalDecision,
        });
      }
    }
    const scorecardConfidenceRaw = Number(ai.analysisScorecard?.confidenceScore ?? ai.finalConfidence ?? 0);
    const scorecardConfidence = learningLane
      ? Math.max(scorecardConfidenceRaw, Number(ai.finalConfidence ?? 0))
      : scorecardConfidenceRaw;
    const requestedDurationForConfidence = Number(input.maxDurationSec ?? 0);
    const minConfidenceForLane = learningLane ? 25 : requestedDurationForConfidence > 0 && requestedDurationForConfidence <= 3600 ? 55 : 60;
    if (scorecardConfidence < minConfidenceForLane) {
      const orchestration = await evaluateOrchestration({
        userId: user.id,
        candidate: selected,
        ai,
        executionId,
        mode,
        decisionStage: "REJECT",
      });
      publishExecutionEvent({
        executionId,
        symbol: selected.context.symbol,
        stage: "confidence-gate",
        status: "SKIPPED",
        message: learningLane
          ? "Learning lane guven skoru yetersiz, micro trade acilmadi"
          : "Guven skoru dusuk, islem acilmadi",
        level: "WARN",
        context: {
          confidenceScore: scorecardConfidence,
          decision: ai.finalDecision,
          orchestration,
        },
      });
      await logTradeEvent({
        symbol: selected.context.symbol,
        eventType: "RISK_GATE_BLOCKED",
        reason: "Low confidence",
        aiConfidence: scorecardConfidence,
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `LOW_CONFIDENCE: ${scorecardConfidence.toFixed(2)} < ${minConfidenceForLane}`,
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
        details: {
          confidenceScore: scorecardConfidence,
          orchestration,
        },
      });
    }
    if (ai.analysisScorecard?.riskLevel === "HIGH" && !learningLane) {
      await logTradeEvent({
        symbol: selected.context.symbol,
        eventType: "RISK_GATE_BLOCKED",
        reason: "Risk seviyesi HIGH",
        aiConfidence: scorecardConfidence,
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "RISK_LEVEL_HIGH",
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
        details: {
          riskLevel: ai.analysisScorecard?.riskLevel,
        },
      });
    }
    const entryQuality = shouldRejectHighRiskLowConfidenceEntry({
      confidencePercent: ai.finalConfidence,
      aiRiskScore: ai.finalRiskScore,
    });
    if (entryQuality.reject && !paperRelaxed && !learningLane) {
      await logTradeEvent({
        symbol: selected.context.symbol,
        eventType: "RISK_GATE_BLOCKED",
        reason: entryQuality.reason ?? "Entry quality gate",
        aiConfidence: scorecardConfidence,
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: entryQuality.reason ?? "ENTRY_QUALITY: elevated AI risk without elite confidence",
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
        details: {
          aiRiskScore: ai.finalRiskScore,
          confidence: ai.finalConfidence,
        },
      });
    }
    const noTradeReasons = resolveNoTradeReasons({
      candidate: selected,
      confidence: ai.finalConfidence,
      decision: ai.finalDecision,
    });
    const learningHardRejects = learningLane
      ? resolveLearningLaneHardRejects({ candidate: selected, liveDataHealthy, paperMode: true })
      : [];
    recordLearningEvaluation({
      advisoryRejected: learningHardRejects.length > 0,
      hardVeto: false,
    });
    if (learningHardRejects.length > 0) {
      publishExecutionEvent({
        executionId,
        symbol: selected.context.symbol,
        stage: "learning-lane-gate",
        status: "SKIPPED",
        message: "Learning lane sert risk filtresine takildi",
        level: "WARN",
        context: {
          reasons: learningHardRejects,
          confidence: ai.finalConfidence,
          decision: ai.finalDecision,
        },
      });
      // Learning lane is advisory-only by design; never hard-veto execution authority.
    }
    if (noTradeReasons.length > 0 && !paperRelaxed) {
      const orchestration = await evaluateOrchestration({
        userId: user.id,
        candidate: selected,
        ai,
        executionId,
        mode,
        decisionStage: "REJECT",
      });
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
          orchestration,
        },
      });
      return finishExecution({
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
          orchestration,
        },
      });
    }
    const marketRegime = readMarketRegimeMeta(selected);
    const strategyStatus = resolveStrategyStatus(selected.context.metadata.strategyStatus);
    const strategyActivation = resolveStrategyActivationMode({
      executionMode: mode,
      strategyStatus,
      liveTradingEnabled: env.LIVE_TRADING_ENABLED,
    });
    const p4Regime = evaluateCanonicalRegime({
      marketEventAt: String(selected.context.metadata.marketDataTimestamp ?? new Date().toISOString()),
      detectedAt: new Date().toISOString(),
      trend: Number(selected.context.metadata.trendStrength ?? 0),
      volatility: Number(selected.context.volatilityPercent ?? 0) / 100,
      momentum: Number(selected.context.metadata.shortMomentumPercent ?? 0),
      transitionProbability: Number(selected.context.metadata.regimeTransitionProbability ?? 0) / 100,
      chaosProbability: Number(selected.context.metadata.regimeChaosProbability ?? 0) / 100,
      pumpScore: Number(selected.context.metadata.pumpScore ?? selected.context.pumpRisk ?? 0),
    });
    const strategyRouter = routeStrategies(
      {
        candidateId: String(selected.context.metadata.opportunityCandidateId ?? createCandidateId(selected.context.symbol, "strategy")),
        sourceType: "LIVE_MARKET",
        marketEventAt: p4Regime.marketEventAt,
        evaluatedAt: new Date().toISOString(),
        velocity: Number(selected.context.metadata.tradeVelocity ?? 0),
        acceleration: Number(selected.context.metadata.priceAcceleration ?? 0),
        volumeAcceleration: Number(selected.context.metadata.volumeAcceleration ?? 0),
        relativeStrength: Number(selected.context.metadata.relativeStrength ?? 0),
        spreadBps: Number(selected.context.spreadPercent ?? 0) * 100,
        liquidityScore: Math.max(0, Math.min(1, Number(selected.context.metadata.liquidityScore ?? 0.6))),
        exhaustion: Math.max(0, Math.min(1, Number(selected.context.metadata.exhaustion ?? 0.2))),
        momentum: Number(selected.context.metadata.shortMomentumPercent ?? 0),
        retracement: Number(selected.context.metadata.retracement ?? 0.4),
        breakoutHeld: Boolean(selected.context.metadata.breakoutHeld ?? false),
        rangeScore: Number(selected.context.metadata.rangeScore ?? 0.4),
        distanceFromMean: Number(selected.context.metadata.distanceFromMean ?? 0.4),
        flowRecovery: Number(selected.context.metadata.flowRecovery ?? 0.5),
        staleFeatures: Array.isArray(selected.context.metadata.staleFeatures)
          ? (selected.context.metadata.staleFeatures as string[])
          : [],
        missingFeatures: Array.isArray(selected.context.metadata.missingFeatures)
          ? (selected.context.metadata.missingFeatures as string[])
          : [],
        entrySpread: Number(selected.context.metadata.entrySpread ?? selected.context.spreadPercent ?? 0),
        entrySlippage: Number(selected.context.metadata.entrySlippage ?? 0),
        entryFee: Number(selected.context.metadata.entryFee ?? 0.1),
        exitSpread: Number(selected.context.metadata.exitSpread ?? selected.context.spreadPercent ?? 0),
        exitSlippage: Number(selected.context.metadata.exitSlippage ?? 0),
        exitFee: Number(selected.context.metadata.exitFee ?? 0.1),
        strategyProfitBuffer: Number(selected.context.metadata.strategyProfitBuffer ?? 0.12),
        expectedMovePercent: Number(selected.context.metadata.expectedMovePercent ?? Math.max(0, Number(ai.score ?? 0))),
      },
      p4Regime,
    );
    const selectedStrategyId = strategyRouter.preferredStrategy ?? marketRegime.strategy;
    if (!marketRegime.openAllowed && !paperRelaxed) {
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `Market regime block: ${marketRegime.mode} (${marketRegime.reason})`,
        symbol: selected.context.symbol,
        decision: ai.finalDecision,
      });
    }
    if (!paperRelaxed && (marketRegime.mode === "HIGH_VOLATILITY_CHAOS" || marketRegime.mode === "NEWS_DRIVEN_UNSTABLE")) {
      if (selected.context.spreadPercent > 0.12 || selected.context.fakeSpikeScore > 1.8 || ai.finalConfidence < 94) {
        return finishExecution({
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: "High volatility defensive gate: spread/wick/confidence uygun degil.",
          symbol: selected.context.symbol,
          decision: ai.finalDecision,
        });
      }
    }
    if (!paperRelaxed && (marketRegime.mode === "STRONG_BEARISH_TREND" || marketRegime.mode === "WEAK_BEARISH_TREND")) {
      const shortMomentum = Number(selected.context.metadata.shortMomentumPercent ?? 0);
      const shortFlow = Number(selected.context.metadata.shortFlowImbalance ?? 0);
      if (!(shortMomentum > 0.12 && shortFlow > 0.04 && ai.finalDecision === "BUY")) {
        return finishExecution({
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: "Bear regime: sadece guclu bounce setup kabul edilir.",
          symbol: selected.context.symbol,
          decision: ai.finalDecision,
        });
      }
    }
    const qualityGate = evaluateSignalQualityGate({ candidate: selected, ai });
    obsQualityGate = qualityGate;
    const canonicalEntryBlockers: Array<{ code: string; reason: string; details?: Record<string, unknown> }> = [];
    if (strategyRouter.conflictStatus === "CONTRADICTORY") {
      canonicalEntryBlockers.push({
        code: "STRATEGY_CONFLICT",
        reason: "Multiple contradictory strategy signals",
        details: { conflictStatus: strategyRouter.conflictStatus, eligibleStrategies: strategyRouter.eligibleStrategies },
      });
    }
    if (!strategyRouter.preferredStrategy) {
      canonicalEntryBlockers.push({
        code: "NO_ELIGIBLE_STRATEGY",
        reason: "No eligible strategy signal for this candidate",
        details: { conflictStatus: strategyRouter.conflictStatus, evaluations: strategyRouter.evaluations },
      });
    }
    if (mode === "paper" && strategyActivation !== "PAPER_ELIGIBLE") {
      canonicalEntryBlockers.push({
        code: "ROUTER_SHADOW_ONLY",
        reason: `Strategy mode ${strategyActivation} cannot create paper intent`,
        details: { strategyStatus, strategyActivation },
      });
    }
    const orchestration = await evaluateOrchestration({
      userId: user.id,
      candidate: selected,
      ai,
      qualityGate,
      executionId,
      mode,
      decisionStage: qualityGate.ok ? "PRE_TRADE" : "REJECT",
    });
    if (!qualityGate.ok && !paperRelaxed) {
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
          orchestration,
        },
      });
      canonicalEntryBlockers.push({
        code: "QUALITY_GATE_REJECT",
        reason: `Kalitesiz sinyal (score=${qualityGate.qualityScore}/${qualityGate.minimumRequiredScore}): ${qualityGate.reasons.join(", ")}`,
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
      });
    }
    if ((orchestration.action === "BLOCK" || orchestration.action === "SUPPRESS") && !paperRelaxed) {
      publishExecutionEvent({
        executionId,
        symbol: selected.context.symbol,
        stage: "orchestration-gate",
        status: "SKIPPED",
        message: "Orchestration intelligence tradei baskiladi",
        level: "WARN",
        context: {
          action: orchestration.action,
          suppressionScore: orchestration.suppressionScore,
          uncertaintyScore: orchestration.uncertaintyScore,
          edgeHealthScore: orchestration.edgeHealthScore,
          clusterRiskScore: orchestration.clusterRiskScore,
          reasons: orchestration.vetoReasons,
          persistence: orchestration.persisted,
        },
      });
      canonicalEntryBlockers.push({
        code: `ORCHESTRATION_${orchestration.action}`,
        reason: `ORCHESTRATION_${orchestration.action}: ${orchestration.vetoReasons.join(" | ") || "adaptive suppression"}`,
        details: { orchestration },
      });
    }
    const adaptiveEval = await evaluateAdaptiveCandidate({
      userId: user.id,
      candidate: selected,
      ai,
    });
    if (!adaptiveEval.ok && !paperRelaxed) {
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
      canonicalEntryBlockers.push({
        code: "ADAPTIVE_GATE_REJECT",
        reason: adaptiveEval.reason,
        details: { adaptiveOptimization: adaptiveEval },
      });
    }
    const learningFeatureSnapshot = buildSetupFeatureSnapshot({
      ...selected.context.metadata,
      marketRegime: marketRegime.mode,
      marketRegimeStrategy: marketRegime.strategy,
      qualityScore: qualityGate.qualityScore,
      qualityDecision: qualityGate.decision,
      orchestrationAction: orchestration.action,
      orchestrationScore: orchestration.orchestrationScore,
      orchestrationSuppressionScore: orchestration.suppressionScore,
      orchestrationUncertaintyScore: orchestration.uncertaintyScore,
      orchestrationEdgeHealthScore: orchestration.edgeHealthScore,
      orchestrationClusterRiskScore: orchestration.clusterRiskScore,
      orchestrationConfidenceAdjusted: orchestration.confidenceAdjusted,
      orchestrationRiskMultiplier: orchestration.riskMultiplier,
      spreadPercent: selected.context.spreadPercent,
      volatilityPercent: selected.context.volatilityPercent,
      orderBookImbalance: selected.context.orderBookImbalance,
      shortMomentumPercent: Number(selected.context.metadata.shortMomentumPercent ?? 0),
      shortFlowImbalance: Number(selected.context.metadata.shortFlowImbalance ?? 0),
      tradeVelocity: Number(selected.context.metadata.tradeVelocity ?? 0),
      fakeSpikeScore: selected.context.fakeSpikeScore,
      pumpRisk: selected.context.pumpRisk,
      pumpIntensity: selected.context.pumpIntensity,
      volumeSpikePercent: selected.context.volumeSpikePercent,
      momentumBreakout: evaluateMomentumBreakout(selected.context),
      mtfAlignmentScore: Number(ai.decisionPayload?.timeframeAnalysis?.alignmentScore ?? 0),
      aiConfidence: ai.finalConfidence,
      aiRiskScore: ai.finalRiskScore,
      ruleTags: buildRuleTags({
        aiConfidence: ai.finalConfidence,
        aiRiskScore: ai.finalRiskScore,
        spreadPercent: selected.context.spreadPercent,
        volatilityPercent: selected.context.volatilityPercent,
        qualityScore: qualityGate.qualityScore,
      }),
    });
    const liveLearningPolicy = mode === "live" ? await getCrossModeLearningPolicy(learningFeatureSnapshot.patternKey).catch(() => null) : null;
    const liveLearningAdjustment = resolveAdaptiveAdjustment(liveLearningPolicy, { liveGuard: mode === "live" });
    const immediateLearningPolicy = await getImmediateLearningRiskPolicy(learningFeatureSnapshot.patternKey).catch(() => null);
    const immediateLearningAdjustment = resolveImmediateLearningRiskAdjustment(immediateLearningPolicy);
    if (!immediateLearningAdjustment.allowed) {
      publishExecutionEvent({
        executionId,
        symbol: selected.context.symbol,
        stage: "learning-immediate-risk-gate",
        status: "RUNNING",
        message: "Learning immediate risk policy advisory warning",
        level: "WARN",
        context: {
          mode,
          patternKey: learningFeatureSnapshot.patternKey,
          reason: immediateLearningAdjustment.reason,
          policy: immediateLearningPolicy,
          advisoryOnly: true,
        },
      });
    }
    if (
      immediateLearningAdjustment.minScoreDelta > 0 &&
      scorecardConfidence < minConfidenceForLane + immediateLearningAdjustment.minScoreDelta
    ) {
      publishExecutionEvent({
        executionId,
        symbol: selected.context.symbol,
        stage: "learning-immediate-risk-gate",
        status: "RUNNING",
        message: "Learning immediate min-score advisory warning",
        level: "WARN",
        context: {
          mode,
          scorecardConfidence,
          requiredConfidence: minConfidenceForLane + immediateLearningAdjustment.minScoreDelta,
          patternKey: learningFeatureSnapshot.patternKey,
          reason: immediateLearningAdjustment.reason,
          policy: immediateLearningPolicy,
          advisoryOnly: true,
        },
      });
    }
    if (mode === "live" && !liveLearningAdjustment.allowed) {
      publishExecutionEvent({
        executionId,
        symbol: selected.context.symbol,
        stage: "learning-policy-gate",
        status: "RUNNING",
        message: "Learning policy advisory warning",
        level: "WARN",
        context: {
          patternKey: learningFeatureSnapshot.patternKey,
          reason: liveLearningAdjustment.reason,
          policy: liveLearningPolicy,
          advisoryOnly: true,
        },
      });
    }
    if (mode === "live" && liveLearningAdjustment.minScoreDelta > 0 && scorecardConfidence < minConfidenceForLane + liveLearningAdjustment.minScoreDelta) {
      publishExecutionEvent({
        executionId,
        symbol: selected.context.symbol,
        stage: "learning-policy-gate",
        status: "RUNNING",
        message: "Learning policy min-score advisory warning",
        level: "WARN",
        context: {
          scorecardConfidence,
          requiredConfidence: minConfidenceForLane + liveLearningAdjustment.minScoreDelta,
          advisoryOnly: true,
        },
      });
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
    let side: "BUY" | "SELL";
    const microTradeEligible = learningLane
      ? canOpenLearningLaneMicroTrade({ candidate: selected, confidence: scorecardConfidence })
      : false;
    if (learningLane && !microTradeEligible) {
      publishExecutionEvent({
        executionId,
        symbol,
        stage: "learning-lane-gate",
        status: "SKIPPED",
        message: "Learning lane no-exploration edge advisory",
        level: "WARN",
        context: {
          confidence: scorecardConfidence,
          scannerScore: selected.score.score,
          advisoryOnly: true,
        },
      });
    }
    const forensicCandidateId = canonicalCandidateId || String(selected.context.metadata.decisionId ?? "").trim() || createCandidateId(symbol, "execution");
    const executionClaim = claimCanonicalExecutionAttempt({
      candidateId: canonicalCandidateId || forensicCandidateId,
      executionId,
    });
    if (!executionClaim.ok) {
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `DUPLICATE_EXECUTION_PATH: ${executionClaim.existingExecutionId}`,
        symbol,
        decision: ai.finalDecision,
      });
    }
    const intentIdentity = getCanonicalCandidateStore().registerExecutionIntent({
      candidateId: canonicalCandidateId,
      executionIntentId: executionId,
      strategyContext: `${String(selected.context.metadata.marketRegimeStrategy ?? "default")}:${ai.finalDecision === "SELL" ? "SELL" : "BUY"}`,
    });
    if (!intentIdentity.ok) {
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: intentIdentity.code,
        symbol,
        decision: ai.finalDecision,
      });
    }
    upsertCandidatePipelineTrace({
      candidateId: forensicCandidateId,
      symbol,
      signal: {
        score: selected.score.score,
        lane: String(selected.context.metadata.pumpEarlyCatcher ? "PUMP" : "SCANNER"),
        reasons: selected.score.reasons,
      },
    });
    const buildExecutionTdiPayload = (reasonDetail: string) =>
      buildExecutionTdiTelemetry({
        candidate: selected,
        ai,
        marketRegime,
        mode,
        learningLane,
        scorecardConfidence,
        reasonDetail,
      });
    const aiGatePolicy = resolveAiExecutionGatePolicy({ mode, learningLane });
    const aiGate: AiExecutionGateEvaluation = evaluateAiExecutionReadiness({
      ai,
      policy: aiGatePolicy,
      learningLane,
      microTradeEligible,
    });
    bridgeAiExecutionGate({
      candidateId: forensicCandidateId,
      symbol,
      aiVerdict: ai.finalDecision,
      aiFinalDecision: aiGate.aiFinalDecision,
      consensusDecision: aiGate.consensusDecision,
      aiGatePolicy: aiGate.policy,
      aiGateVerdict: aiGate.verdict,
      executionVerdict: aiGate.verdict,
      policy: aiGate.policy,
      reasonCode: aiGate.reasonCode,
      reasonDetail: aiGate.reasonDetail,
      executionSide: aiGate.executionSide,
    });
    upsertCandidatePipelineTrace({
      candidateId: forensicCandidateId,
      symbol,
      ai: {
        decision: aiGate.aiFinalDecision,
        confidence: scorecardConfidence,
        status:
          aiGate.verdict === "AI_GATE_PASS"
            ? "PASS"
            : aiGate.reasonCode === "AI_TIMEOUT"
              ? "TIMEOUT"
              : aiGate.reasonCode === "AI_NO_OPINION"
                ? "NO_OPINION"
                : aiGate.reasonCode === "AI_DECISION_CONFLICT"
                  ? "CONFLICT"
                  : "ADVISORY",
      },
      tdi: {
        decision: "SHADOW",
        confidence: scorecardConfidence,
        role: "SHADOW",
      },
    });
    if (aiGate.verdict === "AI_GATE_BLOCK") {
      publishExecutionEvent({
        executionId,
        symbol,
        stage: "ai-execution-gate",
        status: "FAILED",
        message: `AI gate blocked: ${aiGate.reasonCode}`,
        level: "WARN",
        context: {
          aiRawDecision: aiGate.aiRawDecision,
          policy: aiGate.policy,
          verdict: aiGate.verdict,
          reasonCode: aiGate.reasonCode,
        },
      });
      bridgeExecutionCandidateForensic({
        candidateId: forensicCandidateId,
        symbol,
        aiVerdict: ai.finalDecision,
        executionVerdict: aiGate.verdict,
        riskVerdict: "NOT_REACHED",
        sizingVerdict: "NOT_REACHED",
        orderVerdict: "BLOCKED",
        reasonCode: aiGate.reasonCode,
        reasonDetail: aiGate.reasonDetail,
        timestamp: aiGate.timestamp,
      });
      bridgeTdiDecision({
        candidateId: forensicCandidateId,
        symbol,
        verdict: "WAIT",
        ...buildExecutionTdiPayload(aiGate.reasonDetail),
        hybridDecision: ai.finalDecision,
        consensusScore: scorecardConfidence,
        evBelowThreshold: aiGate.reasonCode === "AI_VETO" || aiGate.reasonCode === "AI_NOT_EXECUTABLE",
        strategy: selectedStrategyId,
        reasonCode: aiGate.reasonCode,
        reasonDetail: aiGate.reasonDetail,
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `AI_GATE_BLOCK: ${aiGate.reasonCode}`,
        symbol,
        decision: ai.finalDecision,
        details: {
          aiExecutionGate: aiGate,
        },
      });
    }
    if (aiGate.verdict === "AI_ADVISORY_ONLY" && aiGate.executionSide) {
      side = aiGate.executionSide;
      publishExecutionEvent({
        executionId,
        symbol,
        stage: "ai-execution-gate",
        status: "RUNNING",
        message: "AI advisory-only: paper learning lane proceeding with explicit micro exploration",
        level: "SIGNAL",
        context: {
          aiRawDecision: aiGate.aiRawDecision,
          policy: aiGate.policy,
          verdict: aiGate.verdict,
          laneDecision: side,
          reasonCode: aiGate.reasonCode,
          confidence: scorecardConfidence,
          scannerScore: selected.score.score,
        },
      });
    } else if (aiGate.executionSide) {
      side = aiGate.executionSide;
    } else {
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "AI result is NO_TRADE/HOLD",
        symbol,
        decision: ai.finalDecision,
      });
    }
    if (paperRelaxed && side === "SELL") {
      side = "BUY";
      publishExecutionEvent({
        executionId,
        symbol: selected.context.symbol,
        stage: "selection",
        status: "RUNNING",
        message: "Paper modda short acilisi yerine long kullanildi",
        level: "WARN",
        context: {
          originalDecision: ai.finalDecision,
          normalizedDecision: side,
        },
      });
    }
    if (mode === "live" && side === "SELL") {
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Spot modunda SELL acilis (short) desteklenmiyor.",
        symbol,
        decision: ai.finalDecision,
      });
    }
    const requestedLeverage = Number(input.leverageMultiplier ?? 1);
    const requestedLeverageSafe = Number.isFinite(requestedLeverage)
      ? Math.max(1, Math.min(20, requestedLeverage))
      : 1;
    const useGlobalLeverageVenue = mode === "live" && requestedLeverageSafe > 1 && isGlobalLeverageEnabled();
    const executionSymbol = useGlobalLeverageVenue ? toGlobalLeverageSymbol(symbol) : symbol;
    if (mode === "live") {
      const venueEligibility = await getExecutionVenueEligibility(executionSymbol).catch(() => ({
        executionVenueEligible: false,
        reasonCode: "VENUE_NOT_EXECUTABLE",
      }));
      if (!venueEligibility.executionVenueEligible) {
        return finishExecution({
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: "VENUE_NOT_EXECUTABLE",
          symbol: executionSymbol,
          decision: ai.finalDecision,
        });
      }
    }

    if (selected.context.volatilityPercent >= env.EXECUTION_BLOCK_HIGH_VOLATILITY_PERCENT) {
      await logTradeEvent({
        symbol: executionSymbol,
        eventType: "RISK_GATE_BLOCKED",
        price: selected.context.lastPrice,
        reason: `High volatility ${selected.context.volatilityPercent.toFixed(3)}%`,
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `Volatilite alarmi aktif (${selected.context.volatilityPercent.toFixed(3)}%).`,
        symbol,
        decision: ai.finalDecision,
      });
    }
    const cooldownSec = Math.max(0, env.EXECUTION_SAME_COIN_COOLDOWN_SEC);
    if (cooldownSec > 0) {
      const latestClosed = await findLatestClosedPositionBySymbol(user.id, symbol).catch(() => null);
      if (latestClosed?.closedAt) {
        const elapsedSec = Math.floor((Date.now() - latestClosed.closedAt.getTime()) / 1000);
        if (!input.bypassCoinCooldown && elapsedSec >= 0 && elapsedSec < cooldownSec) {
          await logTradeEvent({
            symbol: executionSymbol,
            eventType: "RISK_GATE_BLOCKED",
            price: selected.context.lastPrice,
            reason: `Coin cooldown aktif (${cooldownSec - elapsedSec}s)`,
          });
          bridgeTdiDecision({
            candidateId: forensicCandidateId,
            symbol: executionSymbol,
            verdict: "WAIT",
            ...buildExecutionTdiPayload(`Coin cooldown active (${cooldownSec - elapsedSec}s remaining)`),
            cooldownActive: true,
            hybridDecision: ai.finalDecision,
            consensusScore: scorecardConfidence,
            strategy: marketRegime.strategy,
            reasonCode: "COOLDOWN_ACTIVE",
            reasonDetail: `Coin cooldown active (${cooldownSec - elapsedSec}s remaining)`,
          });
          return finishExecution({
            executionId,
            mode,
            opened: false,
            rejected: true,
            rejectReason: `Ayni coin cooldown aktif (${cooldownSec - elapsedSec}s kaldi).`,
            symbol,
            decision: ai.finalDecision,
          });
        }
      }
    }

    const shortMomentum = Math.abs(Number(selected.context.metadata.shortMomentumPercent ?? 0));
    const fakeSpikeScore = Number(selected.context.fakeSpikeScore ?? 0);
    if (shortMomentum >= 1.5 && fakeSpikeScore >= 1.4 && selected.context.volatilityPercent >= 1.4) {
      await logTradeEvent({
        symbol: executionSymbol,
        eventType: "RISK_GATE_BLOCKED",
        price: selected.context.lastPrice,
        reason: "Pump/dump riski (gec giris) engeli",
        newValue: { shortMomentum, fakeSpikeScore, volatility: selected.context.volatilityPercent },
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Pump/dump riski nedeniyle gec giris engellendi.",
        symbol: executionSymbol,
        decision: ai.finalDecision,
      });
    }

    if (env.AI_QUALITY_PROFILE === "elite" && !liveDataHealthy && !paperRelaxed) {
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Elite quality gate: market snapshot degraded",
        symbol: executionSymbol,
        decision: ai.finalDecision,
      });
    }
    const ultraMinConfidence = useGlobalLeverageVenue
      ? env.AI_LEVERAGE_MIN_CONFIDENCE_ULTRA
      : env.AI_SPOT_MIN_CONFIDENCE_ULTRA;
    const ultraMaxRisk = useGlobalLeverageVenue
      ? env.AI_ULTRA_MAX_RISK_SCORE_LEVERAGE
      : env.AI_ULTRA_MAX_RISK_SCORE_SPOT;
    if (!isUltraPrecisionConsensus(selected, ultraMinConfidence, ultraMaxRisk) && !paperRelaxed) {
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `Ultra precision gate reject (minConf=${ultraMinConfidence}, maxRisk=${ultraMaxRisk})`,
        symbol: executionSymbol,
        decision: ai.finalDecision,
      });
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
        return finishExecution({
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: `Open pozisyon kapanamadi (${oldest.tradingPair.symbol})`,
          symbol: executionSymbol,
          decision: ai.finalDecision,
        });
      }
      openPositions = await listOpenPositionsByUser(user.id);
    }
    const pumpMarketPriority = Boolean(selected.context.metadata.pumpEarlyCatcher ?? false);
    const orderType = pumpMarketPriority
      ? "MARKET"
      : input.requestedOrderType ?? ((policy.defaultOrderType as "MARKET" | "LIMIT" | undefined) ?? "MARKET");
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
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `TRY market required for all-in buy. Resolved quote=${pair.quoteAsset}`,
        symbol: executionSymbol,
        decision: ai.finalDecision,
      });
    }
    const aiTargetProfile = resolveAiTargetProfile(selected.ai, selected.context.lastPrice, side);
    if (aiTargetProfile && !aiTargetProfile.eligible && !learningLane) {
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: `AI hedef penceresi uyumsuz (profit=${aiTargetProfile.expectedProfitPercent.toFixed(2)}%, duration=${aiTargetProfile.suggestedDurationSec}s)`,
        symbol,
        decision: ai.finalDecision,
      });
    }
    const runtimeStrategy = await getRuntimeStrategyParams();
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
      liveLearningAdjustment.suggestedTakeProfitPercent ??
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
      marketRegime: marketRegime.mode,
    });
    const baseStopLossPercent =
      input.stopLossPercent ??
      liveLearningAdjustment.suggestedStopLossPercent ??
      (policy.stopLossPercent as number | undefined) ??
      env.EXECUTION_DEFAULT_STOP_LOSS_PERCENT;
    let stopLossPercent = Number(
      (
        baseStopLossPercent *
        (Number.isFinite(marketRegime.slMultiplier) ? marketRegime.slMultiplier : 1)
      ).toFixed(4),
    );
    if (pumpMarketPriority) {
      const pumpPriorityScore = Number(
        selected.context.metadata.pumpPriorityScore ??
          selected.context.metadata.topGainerPriorityScore ??
          0,
      );
      const pumpStopLossFloor =
        pumpPriorityScore >= env.EXECUTION_PUMP_STOP_LOSS_HIGH_SCORE
          ? env.EXECUTION_PUMP_STOP_LOSS_HIGH_PERCENT
          : pumpPriorityScore >= env.EXECUTION_PUMP_STOP_LOSS_MID_SCORE
            ? env.EXECUTION_PUMP_STOP_LOSS_MID_PERCENT
            : env.EXECUTION_PUMP_STOP_LOSS_LOW_PERCENT;
      stopLossPercent = Number(
        Math.max(
          stopLossPercent,
          env.EXECUTION_PUMP_MIN_STOP_LOSS_PERCENT,
          pumpStopLossFloor,
          paperRelaxed ? 0.68 : 0.58,
          env.EXECUTION_DEFAULT_STOP_LOSS_PERCENT * 0.75,
        ).toFixed(4),
      );
    }
    const atrPercent = Number(
      selected.context.metadata.atrPercent ?? selected.context.metadata.atr ?? 0,
    );
    const volatilityAwareStop = resolveVolatilityAwareStopLossPercent({
      baseStopLossPercent: stopLossPercent,
      atrPercent,
      volatilityPercent: selected.context.volatilityPercent,
    });
    stopLossPercent = volatilityAwareStop.stopLossPercent;
    const pumpAdaptiveDurationSec = Number(
      selected.context.metadata.pumpAdaptiveDurationSec ??
        selected.context.metadata.pumpEarlyMaxDurationSec ??
        0,
    );
    const rawDurationSec =
      (pumpAdaptiveDurationSec > 0 ? Math.max(Number(input.maxDurationSec ?? 0), pumpAdaptiveDurationSec) : undefined) ??
      input.maxDurationSec ??
      liveLearningAdjustment.suggestedMaxDurationSec ??
      aiTargetProfile?.suggestedDurationSec ??
      (policy.maxDurationSec as number | undefined) ??
      env.EXECUTION_DEFAULT_MAX_DURATION_SEC;
    const maxDurationLimitSec = input.maxDurationSec !== undefined ? 86_400 : env.EXECUTION_TARGET_LONG_WINDOW_SEC;
    const maxDurationSec = Math.max(120, Math.min(maxDurationLimitSec, rawDurationSec));
    const edgeGate = validateProfitEdgeGate({
      takeProfitPercent,
      stopLossPercent,
      spreadPercent: selected.context.spreadPercent,
      leverageMultiplier: useGlobalLeverageVenue ? requestedLeverageSafe : 1,
    });
    if (!edgeGate.pass && !paperRelaxed) {
      return finishExecution({
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
      });
    }
    if (useGlobalLeverageVenue && selected.context.volume24h < env.SCANNER_MIN_VOLUME_24H * 3) {
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Leverage liquidity gate reject (24h hacim yetersiz).",
        symbol: executionSymbol,
        decision: ai.finalDecision,
      });
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
        return finishExecution({
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: "Global kaldirac icin USDT tutari girilmesi zorunlu.",
          symbol: executionSymbol,
          decision: ai.finalDecision,
        });
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
          return finishExecution({
            executionId,
            mode,
            opened: false,
            rejected: true,
            rejectReason: "USDTTRY kuru alinamadi, global kaldirac sizing yapilamadi.",
            symbol: executionSymbol,
            decision: ai.finalDecision,
          });
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

    let unifiedQuoteSpend: number | undefined;
    let preValidation:
      | {
          ok: boolean;
          reasons: string[];
          marketPrice: number;
          notional: number;
          adjustedQuantity: number;
          minNotional?: number;
        }
      | undefined;

    if (env.EXECUTION_FULL_BALANCE_ENABLED && !hasManualSizing && !useGlobalLeverageVenue) {
      const executionPlan = await resolveUnifiedExecutionPlan({
        userId: user.id,
        executionId,
        symbol: executionSymbol,
        side,
        mode,
        estimatedEntryPrice,
        quoteAsset: pair.quoteAsset,
        baseAsset: pair.baseAsset,
        openPositionCount: openPositions.length,
        allowMultipleOpenPositions,
        hasManualSizing,
        requestedQuantity: candidateQty,
        ignorePauseState: learningLane,
      });
      if (!executionPlan.ok) {
        publishExecutionEvent({
          executionId,
          symbol: executionSymbol,
          stage: "validation",
          status: "FAILED",
          message: `Unified validation fail: ${executionPlan.rejectReason ?? "unknown"}`,
          level: "WARN",
        });
        return finishExecution({
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: executionPlan.rejectReason ?? "Unified execution validation failed",
          symbol: executionSymbol,
          decision: ai.finalDecision,
        });
      }
      candidateQty = executionPlan.quantity;
      unifiedQuoteSpend = executionPlan.quoteSpend;
      preValidation = executionPlan.validation;
    }

    if (!preValidation) {
      const validQty = useGlobalLeverageVenue
        ? await calculateGlobalValidQuantity(executionSymbol, candidateQty)
        : await calculateValidQuantity(executionSymbol, candidateQty);
      preValidation = useGlobalLeverageVenue
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
            ignorePauseState: learningLane,
          });
    }

    if (!preValidation.ok) {
      const failure = classifyExecutionFailure(new Error(preValidation.reasons.join(", ")), {
        operation: "validate_symbol_and_order",
        dependency: "binance_symbol_filters",
        venue: executionIdentity.venue,
        executionMode: mode,
        domainHint: "SYMBOL_FILTER",
      });
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "validation",
        status: "FAILED",
        message: formatCanonicalExecutionReason(failure),
        level: "WARN",
        context: { ...executionIdentity, ...failure },
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: formatCanonicalExecutionReason(failure),
        symbol: executionSymbol,
        decision: ai.finalDecision,
        details: { ...failure },
      });
    }
    publishExecutionEvent({
      executionId,
      symbol: executionSymbol,
      stage: "validation",
      status: "SUCCESS",
      message: "Validation ok",
      level: "INFO",
      context: {
        orderType,
        side,
        adjustedQuantity: preValidation.adjustedQuantity,
        notional: preValidation.notional,
        minNotional: preValidation.minNotional,
        marketPrice: preValidation.marketPrice,
      },
    });

    if (!hasManualSizing && !learningLane) {
      const consecutiveLosses = await getConsecutiveLossCount(user.id).catch(() => 0);
      const equityDrawdownPercent = tradingFailsafeState.snapshot().maxDrawdownPercent ?? 0;
      const accountEquity = Math.max(env.RISK_TOTAL_CAPITAL_TRY, preValidation.notional * 4);
      const portfolioPositions: PortfolioPositionInput[] = openPositions.map((position) => ({
        id: position.id,
        symbol: position.tradingPair.symbol,
        side: position.side === "SHORT" ? "SELL" : "BUY",
        quantity: Number(position.quantity),
        entryPrice: Number(position.entryPrice),
        currentPrice: Number(position.markPrice ?? position.entryPrice),
        strategy: String(
          (position.metadata as Record<string, unknown> | null)?.strategy ??
            marketRegime.strategy ??
            "unknown",
        ),
      }));
      const riskEfficiency = resolveRiskEfficiencyAdjustment({
        baseStopLossPercent: Number(
          (
            baseStopLossPercent *
            (Number.isFinite(marketRegime.slMultiplier) ? marketRegime.slMultiplier : 1)
          ).toFixed(4),
        ),
        atrPercent,
        volatilityPercent: selected.context.volatilityPercent,
        confidencePercent: ai.finalConfidence,
        aiRiskScore: ai.finalRiskScore,
        marketRegimeRiskMultiplier: marketRegime.riskMultiplier,
        marketRegime: marketRegime.mode,
        consecutiveLosses,
        equityDrawdownPercent,
        notional: preValidation.notional,
        quantity: preValidation.adjustedQuantity,
        accountEquity,
        symbol: executionSymbol,
        strategy: String(selected.context.metadata.strategy ?? marketRegime.strategy ?? "unknown"),
        openPositions: portfolioPositions,
        expectedProfitPercent: Number(selected.context.metadata.expectedProfitPercent ?? 0.35),
        rankingScore: Number(selected.score?.score ?? 60),
      });
      if (riskEfficiency.portfolioBlocked || riskEfficiency.adjustedNotional <= 0) {
        bridgeTdiDecision({
          candidateId: forensicCandidateId,
          symbol: executionSymbol,
          verdict: "WAIT",
          ...buildExecutionTdiPayload(`Portfolio allocation blocked (${riskEfficiency.portfolioAction})`),
          portfolioBlocked: true,
          openPositionCount: openPositions.length,
          maxSlots: runtimeMaxOpenPositions,
          rank: selected.rank ?? 1,
          hybridDecision: ai.finalDecision,
          consensusScore: scorecardConfidence,
          strategy: marketRegime.strategy,
          reasonCode: "PORTFOLIO_BLOCK",
          reasonDetail: `Portfolio allocation blocked (${riskEfficiency.portfolioAction})`,
        });
        return finishExecution({
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: `Portfolio allocation blocked (${riskEfficiency.portfolioAction})`,
          symbol: executionSymbol,
          decision: ai.finalDecision,
        });
      }
      stopLossPercent = riskEfficiency.stopLossPercent;
      preValidation = {
        ...preValidation,
        notional: riskEfficiency.adjustedNotional,
        adjustedQuantity: riskEfficiency.adjustedQuantity,
      };
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "risk-efficiency",
        status: "RUNNING",
        message: `Risk efficiency sizing aktif (x${riskEfficiency.notionalMultiplier})`,
        level: "INFO",
        context: {
          notionalMultiplier: riskEfficiency.notionalMultiplier,
          portfolioAction: riskEfficiency.portfolioAction,
          portfolioAllocation: riskEfficiency.portfolioAllocation,
          stopLossSource: riskEfficiency.stopLossSource,
          factors: riskEfficiency.factors,
          stopLossPercent,
        },
      });
    }

    const bidDepth = Number(selected.context.metadata.bidDepth ?? 0);
    const askDepth = Number(selected.context.metadata.askDepth ?? 0);
    const orderBookImbalance = Number(selected.context.orderBookImbalance ?? 0);
    const preSubmitExecution = evaluatePreSubmitExecution({
      side,
      notional: preValidation.notional,
      bidDepth,
      askDepth,
      spreadPercent: Number(selected.context.spreadPercent ?? 0),
      liquidity24h: Number(selected.context.volume24h ?? 0),
      liquidityScore: Number(selected.context.metadata.liquidityScore ?? 60),
      orderType,
      marketRegime: String(selected.context.metadata.marketRegime ?? ""),
      paperRelaxed,
    });
    if (!preSubmitExecution.allowed) {
      const reason = preSubmitExecution.reason ?? "Execution pre-submit guard blocked order";
      await logTradeEvent({
        symbol: executionSymbol,
        eventType: "RISK_GATE_BLOCKED",
        reason,
      });
      await addSystemLog({
        level: "WARN",
        source: "orderbook-liquidity",
        message: reason,
        context: {
          symbol: executionSymbol,
          notional: preValidation.notional,
          bidDepth,
          askDepth,
          slippagePercent: preSubmitExecution.estimatedSlippagePct,
          depthCoverage: preSubmitExecution.depthCoverage,
        },
      }).catch(() => null);
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: reason,
        symbol: executionSymbol,
        decision: ai.finalDecision,
      });
    }
    if (side === "BUY" && orderBookImbalance >= 0.35 && !pumpMarketPriority) {
      const tightened = Number(Math.max(stopLossPercent * 0.85, stopLossPercent - 0.15).toFixed(4));
      if (tightened > 0 && tightened < stopLossPercent) {
        stopLossPercent = tightened;
        await logTradeEvent({
          symbol: executionSymbol,
          eventType: "ACTIVE_STOP_UPDATED",
          price: selected.context.lastPrice,
          newValue: { stopLossPercent: stopLossPercent },
          reason: "buy-wall-tighten-stop",
        });
      }
    }

    const entryShortMomentum = Number(selected.context.metadata.shortMomentumPercent ?? 0);
    const entryShortFlow = Number(selected.context.metadata.shortFlowImbalance ?? 0);
    const tradeVelocity = Number(selected.context.metadata.tradeVelocity ?? 0);
    const entryMomentumOk =
      side === "BUY"
        ? entryShortMomentum >= 0.05 && entryShortFlow >= 0.01
        : side === "SELL"
          ? entryShortMomentum <= -0.05 && entryShortFlow <= -0.01
          : true;
    const entryVelocityOk = tradeVelocity >= 0.01;
    if (!paperRelaxed && (!entryMomentumOk || !entryVelocityOk)) {
      const reason = !entryMomentumOk
        ? "Entry momentum/flow teyidi zayif"
        : "Entry trade velocity dusuk";
      await logTradeEvent({
        symbol: executionSymbol,
        eventType: "RISK_GATE_BLOCKED",
        price: selected.context.lastPrice,
        reason,
        newValue: {
          shortMomentum: entryShortMomentum,
          shortFlow: entryShortFlow,
          tradeVelocity,
        },
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: reason,
        symbol: executionSymbol,
        decision: ai.finalDecision,
      });
    }

    const entryPrice = orderType === "LIMIT" ? limitPrice ?? preValidation.marketPrice : preValidation.marketPrice;
    const smartEntry = await evaluateSmartEntryGate({
      candidate: selected,
      ai,
      side,
      entryPrice,
      takeProfitPercent,
      stopLossPercent,
    });
    const entryAnalysisId =
      smartEntry.details &&
      typeof smartEntry.details === "object" &&
      "entryAi" in smartEntry.details &&
      smartEntry.details.entryAi &&
      typeof smartEntry.details.entryAi === "object" &&
      "analysisId" in smartEntry.details.entryAi
        ? String(smartEntry.details.entryAi.analysisId)
        : undefined;
    if (!smartEntry.pass && !paperRelaxed) {
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
      canonicalEntryBlockers.push({
        code: "SMART_ENTRY_REJECT",
        reason: smartEntry.reason,
        details: {
          smartEntry: smartEntry.details,
        },
      });
    }
    const paperBlockingCodes = new Set(["ROUTER_SHADOW_ONLY", "NO_ELIGIBLE_STRATEGY", "STRATEGY_CONFLICT"]);
    const hasPaperBlockingCode = canonicalEntryBlockers.some((row) => paperBlockingCodes.has(row.code));
    const canonicalVerdict: CanonicalEntryDecision["verdict"] =
      canonicalEntryBlockers.length === 0
        ? "ENTER"
        : paperRelaxed
          ? hasPaperBlockingCode
            ? "WAIT"
            : "ENTER"
          : "REJECT";
    const canonicalEntryDecision: CanonicalEntryDecision = {
      candidateId: canonicalCandidateId,
      symbol: executionSymbol,
      verdict: canonicalVerdict,
      firstBlocker: canonicalEntryBlockers[0]?.code ?? null,
      reasonCodes: canonicalEntryBlockers.map((row) => row.code),
      qualityComponents: {
        confidence: Number(ai.finalConfidence ?? 0),
        quality: Number(qualityGate.qualityScore ?? 0),
        adaptive: Number(adaptiveEval.score ?? 0),
        orchestration: Number(orchestration.orchestrationScore ?? 0),
      },
      dataQuality: {
        status: dataQualityIssues.length > 0 ? "DEGRADED" : "COMPLETE",
        missing: [],
        stale: [],
      },
      advisory: {
        aiDecision: ai.finalDecision ?? null,
        tdiDecision: "SHADOW",
        learningDecision: learningLane ? "ADVISORY_ONLY" : null,
      },
      evaluatedAt: new Date().toISOString(),
      policyVersion: "p1-canonical-entry-v1",
    };
    if (canonicalEntryDecision.verdict !== "ENTER") {
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "canonical-entry",
        status: "SKIPPED",
        message: canonicalEntryBlockers[0]?.reason ?? "Canonical entry not entered",
        level: "WARN",
        context: canonicalEntryDecision as unknown as Record<string, unknown>,
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason:
          `${canonicalEntryDecision.verdict}:${canonicalEntryBlockers[0]?.code ?? "ENTRY_CONTRACT_NOT_MET"} ${canonicalEntryBlockers[0]?.reason ?? "Canonical entry not entered"}`,
        symbol: executionSymbol,
        decision: ai.finalDecision,
        details: {
          canonicalEntryDecision,
          blockers: canonicalEntryBlockers,
        },
      });
    }
    const { takeProfitPrice, stopLossPrice } = resolveTpSl(entryPrice, side, takeProfitPercent, stopLossPercent);
    await logTradeEvent({
      symbol: executionSymbol,
      eventType: "TARGET_SELL_CREATED",
      price: entryPrice,
      newValue: {
        targetSellPrice: takeProfitPrice,
        stopLossPrice,
      },
      reason: "initial-target",
    });
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
    getCanonicalCandidateStore().transitionCandidate(canonicalCandidateId, "RISK_PENDING", ["RISK_EVALUATION_STARTED"]);
    const riskGate = await evaluateCanonicalRiskDecision({
      candidateId: canonicalCandidateId,
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
      lastPrice: selected.context.lastPrice,
      syntheticData: Boolean(selected.context.metadata.syntheticMarketData),
      dataUnavailable: Boolean(selected.context.metadata.marketDataUnavailable),
    });
    upsertCandidatePipelineTrace({
      candidateId: forensicCandidateId,
      symbol: executionSymbol,
      risk: {
        verdict: riskGate.verdict,
        reasonCodes: riskGate.reasonCodes,
      },
    });
    if (riskGate.verdict === "REJECT") {
      if (canonicalCandidateId) {
        getCanonicalCandidateStore().transitionCandidate(canonicalCandidateId, "RISK_REJECTED", riskGate.reasonCodes);
      }
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
      await logTradeEvent({
        symbol: executionSymbol,
        eventType: "RISK_GATE_BLOCKED",
        price: entryPrice,
        reason: riskGate.reasons.join(" | "),
        aiConfidence: ai.finalConfidence,
      });
      bridgeExecutionCandidateForensic({
        candidateId: forensicCandidateId,
        symbol: executionSymbol,
        aiVerdict: ai.finalDecision,
        executionVerdict: aiGate.verdict,
        riskVerdict: riskGate.reasons.join(", "),
        sizingVerdict: `qty=${preValidation.adjustedQuantity}`,
        orderVerdict: "BLOCKED",
        reasonCode: riskGate.reasonCodes[0] ?? "RISK_GATE_REJECT",
        reasonDetail: riskGate.reasonCodes.join(",") || riskGate.reasons.join(", "),
        timestamp: new Date().toISOString(),
      });
      bridgeTdiDecision({
        candidateId: forensicCandidateId,
        symbol: executionSymbol,
        verdict: "WAIT",
        ...buildExecutionTdiPayload(riskGate.reasons.join(", ")),
        riskBlocked: true,
        hybridDecision: ai.finalDecision,
        consensusScore: scorecardConfidence,
        strategy: selectedStrategyId,
        reasonCode: riskGate.reasonCodes[0] ?? "RISK_GATE_REJECT",
        reasonDetail: riskGate.reasonCodes.join(",") || riskGate.reasons.join(", "),
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: riskGate.reasonCodes.join(",") || riskGate.reasons.join(", "),
        symbol,
        decision: ai.finalDecision,
      });
    }
    getCanonicalCandidateStore().transitionCandidate(canonicalCandidateId, "RISK_ALLOWED", ["RISK_GATE_ALLOW"]);

    const feeEdgeMetrics = computeFeeEdgeMetrics({
      entryPrice,
      quantity: preValidation.adjustedQuantity,
      takeProfitPercent,
      stopLossPercent,
    });
    bridgeFeeEdgeMetrics({
      candidateId: forensicCandidateId,
      symbol: executionSymbol,
      metrics: feeEdgeMetrics,
    });
    bridgeFeeAwareEntryPolicy({
      candidateId: forensicCandidateId,
      symbol: executionSymbol,
      metrics: feeEdgeMetrics,
      blockingEnabled: false,
    });
    bridgeExecutionCandidateForensic({
      candidateId: forensicCandidateId,
      symbol: executionSymbol,
      aiVerdict: ai.finalDecision,
      executionVerdict: aiGate.verdict,
      riskVerdict: riskGate.verdict === "ALLOW" ? "APPROVED" : riskGate.reasonCodes.join(","),
      sizingVerdict: `qty=${preValidation.adjustedQuantity} notional=${preValidation.notional}`,
      feeEstimate: feeEdgeMetrics,
      orderVerdict: "SUBMIT_PENDING",
      reasonCode: aiGate.reasonCode,
      reasonDetail: aiGate.reasonDetail,
      timestamp: new Date().toISOString(),
    });
    bridgeStrategyDecision({
      candidateId: forensicCandidateId,
      symbol: executionSymbol,
      strategyId: selectedStrategyId,
      approved: true,
      reasonCode: strategyRouter.preferredStrategy ? "STRATEGY_SELECTED" : "STRATEGY_FALLBACK_SELECTED",
      reasonDetail: `${marketRegime.reason}; activation=${strategyActivation}; status=${strategyStatus}`,
    });
    bridgeMeanReversionEntry({
      candidateId: forensicCandidateId,
      symbol: executionSymbol,
      side: side === "SELL" ? "SHORT" : "LONG",
      strategyId: selectedStrategyId,
      strategySelectionReason: marketRegime.reason,
      marketRegime: marketRegime.mode,
      volatilityPercent: selected.context.volatilityPercent,
      volume24h: selected.context.volume24h,
      spreadPercent: selected.context.spreadPercent,
      momentumPercent: selected.context.momentumPercent,
      shortMomentumPercent: Number(selected.context.metadata.shortMomentumPercent ?? 0),
      liquidityScore: Number(selected.context.metadata.liquidityScore ?? 0),
      entryPrice,
      candidateTimestamp: selected.context.metadata.candidateTimestamp as string | undefined,
      decisionTimestamp: ai.generatedAt,
      metadata: {
        marketRegimeOpenTradeAllowed: marketRegime.openAllowed,
        scannerScore: selected.score.score,
        aiConfidence: ai.finalConfidence,
      },
    });
    bridgeEntryTimingForensics({
      candidateId: forensicCandidateId,
      symbol: executionSymbol,
      side: side === "SELL" ? "SHORT" : "LONG",
      candidateTimestamp: selected.context.metadata.candidateTimestamp as string | undefined,
      decisionTimestamp: ai.generatedAt,
      priceAtCandidate: Number(selected.context.lastPrice ?? entryPrice),
      priceAtDecision: Number(selected.context.lastPrice ?? entryPrice),
      priceAtEntry: entryPrice,
    });
    bridgeTdiDecision({
      candidateId: forensicCandidateId,
      symbol: executionSymbol,
      verdict: "APPROVED",
      ...buildExecutionTdiPayload("Execution path approved through TDI and risk gates"),
      hybridDecision: ai.finalDecision,
      consensusScore: scorecardConfidence,
      rank: selected.rank ?? 1,
      capitalSlot: openPositions.length + 1,
      maxSlots: runtimeMaxOpenPositions,
      openPositionCount: openPositions.length,
      strategy: selectedStrategyId,
      reasonCode: "EXECUTION_APPROVED",
      reasonDetail: "Execution path approved through TDI and risk gates",
    });

    const riskConfig = await getRiskConfigByUser(user.id).catch(() => null);
    const maxBalancePercent = Number((riskConfig?.metadata as Record<string, unknown> | undefined)?.maxBalancePercentPerCoin ?? 0);
    if (maxBalancePercent > 0 && mode === "live") {
      const balances = await getAccountBalances().catch(() => []);
      const quoteBalanceFree = Number(
        balances.find((row) => row.asset.toUpperCase() === pair.quoteAsset.toUpperCase())?.free ?? 0,
      );
      const allowedNotional = quoteBalanceFree * (maxBalancePercent / 100);
      if (Number.isFinite(preValidation.notional) && preValidation.notional > allowedNotional && allowedNotional > 0) {
        await logTradeEvent({
          symbol: executionSymbol,
          eventType: "RISK_GATE_BLOCKED",
          price: entryPrice,
          reason: `Max balance per coin limit (${maxBalancePercent}%)`,
          newValue: { allowedNotional, requestedNotional: preValidation.notional },
        });
        return finishExecution({
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason: `Tek coine ayrilan bakiye limiti (${maxBalancePercent}%) asildi.`,
          symbol: executionSymbol,
          decision: ai.finalDecision,
        });
      }
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
    if (side === "BUY") {
      await logTradeEvent({
        symbol: executionSymbol,
        eventType: "BUY_DECISION",
        price: entryPrice,
        aiConfidence: ai.finalConfidence,
        newValue: { decision: ai.finalDecision },
        reason: ai.explanation,
      });
    }

    publishExecutionEvent({
      executionId,
      symbol,
      stage: "order-submit",
      status: "RUNNING",
      message: `${mode} modunda ${side} emir gonderiliyor`,
      level: "TRADE",
      context: {
        orderType,
        side,
        quantity: preValidation.adjustedQuantity,
        notional: preValidation.notional,
        entryPrice,
      },
    });
    getCanonicalCandidateStore().transitionCandidate(canonicalCandidateId, "PAPER_ATTEMPT", ["PAPER_ORDER_SUBMIT_ATTEMPT"]);
    pauseScannerWorker(25_000);
    const baseQty = preValidation.adjustedQuantity;

    const safetyResult = await runPreTradeSafetyValidation({
      executionId,
      campaignId: executionIdentity.campaignId ?? undefined,
      jobId: executionIdentity.jobId ?? undefined,
      sessionId: executionIdentity.sessionId ?? undefined,
      runId: executionIdentity.runId ?? undefined,
      roundId: executionIdentity.roundId ?? undefined,
      candidateId: canonicalCandidateId,
      venue: executionIdentity.venue,
      userId: user.id,
      symbol: executionSymbol,
      side,
      mode,
      quantity: baseQty,
      priceHint: entryPrice,
      quoteAsset: pair.quoteAsset,
      baseAsset: pair.baseAsset,
      quoteSpend: unifiedQuoteSpend,
      openPositionCount: openPositions.length,
      allowMultipleOpenPositions,
      orderType,
      spreadPercent: Number(selected.context.spreadPercent ?? 0),
      volatilityPercent: Number(selected.context.volatilityPercent ?? 0),
      atr: Number(selected.context.metadata.atr ?? 0),
      bidDepth: Number(selected.context.metadata.bidDepth ?? 0),
      askDepth: Number(selected.context.metadata.askDepth ?? 0),
      suppressStartedEvent: true,
    });
    if (!safetyResult.passed) {
      const blockedDomain =
        safetyResult.blockedBy === "BALANCE"
          ? "BALANCE"
          : safetyResult.blockedBy === "PRICE"
            ? "PRICE"
            : safetyResult.blockedBy === "EXCHANGE" || safetyResult.blockedBy === "QUANTITY"
              ? "SYMBOL_FILTER"
              : safetyResult.blockedBy === "API" || safetyResult.blockedBy === "MARKET"
                ? "MARKET_DATA"
                : mode === "paper"
                  ? "PAPER_EXECUTION"
                  : "LIVE_EXECUTION";
      const failure = classifyExecutionFailure(
        new Error(safetyResult.rejectReason ?? "Execution safety validation failed"),
        {
          operation: "execution_precheck",
          dependency: String(safetyResult.blockedBy ?? "safety_validator").toLowerCase(),
          venue: executionIdentity.venue,
          executionMode: mode,
          domainHint: blockedDomain,
        },
      );
      await recordExecutionFailure({
        executionId,
        userId: user.id,
        symbol: executionSymbol,
        side,
        reason: formatCanonicalExecutionReason(failure),
        stage: safetyResult.blockedBy,
      }).catch(() => null);
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "validation",
        status: "FAILED",
        message: formatCanonicalExecutionReason(failure),
        level: "WARN",
        context: { ...executionIdentity, ...failure, safetyId: safetyResult.safetyId, blockedBy: safetyResult.blockedBy },
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: formatCanonicalExecutionReason(failure),
        symbol: executionSymbol,
        decision: ai.finalDecision,
        details: { ...failure },
      });
    }

    if (mode === "live" && env.LIVE_TRADING_PLATFORM_ENABLED) {
      const { validateLiveTradingGate } = await import("@/src/server/live-trading/go-live-validator.service");
      const gateResult = await validateLiveTradingGate({
        userId: user.id,
        symbol: executionSymbol,
        side,
      });
      if (!gateResult.passed) {
        const rejectReason = gateResult.blockers.join("; ") || "Live trading gate blocked";
        await recordExecutionFailure({
          executionId,
          userId: user.id,
          symbol: executionSymbol,
          side,
          reason: rejectReason,
          stage: "live_gate",
        }).catch(() => null);
        publishExecutionEvent({
          executionId,
          symbol: executionSymbol,
          stage: "validation",
          status: "FAILED",
          message: `Live gate blocked: ${rejectReason}`,
          level: "WARN",
          context: { gates: gateResult.gates, blockers: gateResult.blockers },
        });
        return finishExecution({
          executionId,
          mode,
          opened: false,
          rejected: true,
          rejectReason,
          symbol: executionSymbol,
          decision: ai.finalDecision,
        });
      }
    }

    const placeWithQty = async (qty: number) => {
      if (env.EXECUTION_ENGINE_V2_ENABLED && !useGlobalLeverageVenue) {
        upsertCandidatePipelineTrace({
          candidateId: forensicCandidateId,
          symbol: executionSymbol,
          execution: {
            attempted: true,
            orderId: null,
            result: "ATTEMPTED",
          },
        });
        const v2Result = await executeApprovedSpotOrder({
          executionId,
          userId: user.id,
          campaignId: executionIdentity.campaignId ?? undefined,
          jobId: executionIdentity.jobId ?? undefined,
          sessionId: executionIdentity.sessionId ?? undefined,
          runId: executionIdentity.runId ?? undefined,
          roundId: executionIdentity.roundId ?? undefined,
          candidateId: canonicalCandidateId,
          executionIntentId: executionId,
          symbol: executionSymbol,
          lane: String(selected.context.metadata.pumpEarlyCatcher ? "PUMP" : "SCANNER"),
          side,
          mode: mode === "dry-run" ? "dry-run" : mode === "paper" ? "paper" : "live",
          riskApproved: true,
          riskDecisionId: `${executionId}:risk`,
          decisionAt: new Date().toISOString(),
          riskAllowedAt: new Date().toISOString(),
          executionVenue: String(selected.context.metadata.executionVenue ?? selected.context.metadata.discoveryVenue ?? ""),
          marketDataVenue: String(selected.context.metadata.marketDataVenue ?? ""),
          configHash: String(selected.context.metadata.configHash ?? ""),
          urgency: "normal",
          entryAnalysisId,
          openPositionCount: openPositions.length,
          spreadPercent: Number(selected.context.spreadPercent ?? 0),
          liquidityScore: Number(selected.context.metadata.liquidityScore ?? 60),
          aiGateVerdict: aiGate.verdict === "AI_GATE_BLOCK" ? "AI_ADVISORY_ONLY" : aiGate.verdict,
          aiGatePolicy: aiGate.policy,
          aiGateReasonCode: aiGate.reasonCode,
        });
        if (v2Result.rejected) {
          upsertCandidatePipelineTrace({
            candidateId: forensicCandidateId,
            symbol: executionSymbol,
            execution: {
              attempted: true,
              orderId: v2Result.logKey ?? null,
              result: v2Result.rejectReason ?? "REJECTED",
            },
          });
          throw new Error(v2Result.rejectReason ?? "Execution Engine V2 rejected order");
        }
        upsertCandidatePipelineTrace({
          candidateId: forensicCandidateId,
          symbol: executionSymbol,
          execution: {
            attempted: true,
            orderId: v2Result.logKey ?? null,
            result: "FILLED_OR_ACCEPTED",
          },
        });
        return {
          orderId: v2Result.logKey,
          clientOrderId: v2Result.logKey,
          symbol: executionSymbol,
          side: side as "BUY" | "SELL",
          type: "MARKET" as const,
          status: "FILLED",
          executedQty: v2Result.filledQuantity,
          price: v2Result.averageFillPrice,
          dryRun: mode === "dry-run",
          metadata: { fee: v2Result.fee, source: "execution-engine-v2", ...(v2Result.metadata ?? {}) },
        };
      }
      if (mode === "paper") {
        publishExecutionEvent({
          executionId,
          symbol: executionSymbol,
          stage: "PAPER_ORDER_SIMULATION_STARTED",
          status: "RUNNING",
          message: "Paper order simulation started",
          level: "INFO",
          context: { ...executionIdentity, operation: "simulate_order", dependency: "paper_exchange_simulator" },
        });
        try {
          const paperOrder = await executePaperOrderViaExchangeSimulator({
            userId: user.id,
            campaignId: executionIdentity.campaignId ?? undefined,
            jobId: executionIdentity.jobId ?? undefined,
            sessionId: executionIdentity.sessionId ?? undefined,
            runId: executionIdentity.runId ?? undefined,
            roundId: executionIdentity.roundId ?? undefined,
            executionId,
            candidateId: canonicalCandidateId,
            executionIntentId: executionId,
            marketDataVenue: String(selected.context.metadata.marketDataVenue ?? ""),
            symbol: executionSymbol,
            side,
            quantity: qty,
            quoteOrderQty: unifiedQuoteSpend,
            priceHint: entryPrice,
            quoteAsset: pair.quoteAsset,
            baseAsset: pair.baseAsset,
            bidDepth: Number(selected.context.metadata.bidDepth ?? 0),
            askDepth: Number(selected.context.metadata.askDepth ?? 0),
            spreadPercent: Number(selected.context.spreadPercent ?? 0),
            atr: Number(selected.context.metadata.atr ?? 0),
            volatilityPercent: Number(selected.context.volatilityPercent ?? 0),
            volumeQuote: Number(selected.context.metadata.volumeQuote ?? selected.context.volume24h ?? 0),
            aggressiveBuyPct: Number(selected.context.metadata.aggressiveBuyPct ?? 50),
            aggressiveSellPct: Number(selected.context.metadata.aggressiveSellPct ?? 50),
          });
          publishExecutionEvent({
            executionId,
            symbol: executionSymbol,
            stage: "PAPER_ORDER_SIMULATION_SUCCEEDED",
            status: "SUCCESS",
            message: "Paper order simulation succeeded",
            level: "TRADE",
            context: {
              ...executionIdentity,
              operation: "simulate_order",
              dependency: "paper_exchange_simulator",
              orderId: paperOrder.orderId,
              simulationId: paperOrder.simulationId,
            },
          });
          return paperOrder;
        } catch (error) {
          const failure = classifyExecutionFailure(error, {
            operation: "simulate_order",
            dependency: "paper_exchange_simulator",
            venue: executionIdentity.venue,
            executionMode: "paper",
            domainHint: "PAPER_EXECUTION",
          });
          publishExecutionEvent({
            executionId,
            symbol: executionSymbol,
            stage: "PAPER_ORDER_SIMULATION_FAILED",
            status: "FAILED",
            message: formatCanonicalExecutionReason(failure),
            level: "ERROR",
            context: { ...executionIdentity, ...failure },
          });
          throw preserveExecutionFailure(error, {
            operation: "simulate_order",
            dependency: "paper_exchange_simulator",
            venue: executionIdentity.venue,
            executionMode: "paper",
            domainHint: "PAPER_EXECUTION",
          });
        }
      }
      if (useGlobalLeverageVenue) {
        if (side === "BUY") {
          return placeGlobalMarketBuy(executionSymbol, qty, false);
        }
        return placeGlobalMarketSell(executionSymbol, qty, false);
      }
      if (side === "BUY") {
        if (orderType === "MARKET" && unifiedQuoteSpend && unifiedQuoteSpend > 0) {
          return placeMarketBuyByQuote(executionSymbol, unifiedQuoteSpend, mode === "dry-run");
        }
        return orderType === "MARKET"
          ? placeMarketBuy(executionSymbol, qty, mode === "dry-run")
          : placeLimitBuy(executionSymbol, qty, entryPrice, mode === "dry-run");
      }
      return orderType === "MARKET"
        ? placeMarketSell(executionSymbol, qty, mode === "dry-run")
        : placeLimitSell(executionSymbol, qty, entryPrice, mode === "dry-run");
    };

    const decisionTimestamp = new Date().toISOString();
    const orderPlacementStartedAt = Date.now();
    let placementRetryCount = 0;

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
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          placedOrder = await placeWithQty(qty);
          const filledQty = Number(placedOrder.executedQty ?? 0);
          submittedQty = Number.isFinite(filledQty) && filledQty > 0 ? filledQty : qty;
          lastPlaceError = null;
          break;
        } catch (error) {
          lastPlaceError = error;
          const message = (error as Error)?.message ?? "";
          const retryPolicy = resolveAdaptiveRetryPolicy({
            errorMessage: message,
            attempt,
            marketRegime: String(selected.context.metadata.marketRegime ?? ""),
          });
          if (retryPolicy.shouldRetry) {
            placementRetryCount += 1;
            await new Promise((resolve) => setTimeout(resolve, retryPolicy.backoffMs));
            continue;
          }
          if (!isTrMinNotionalError(message)) {
            throw error;
          }
        }
      }
      if (placedOrder) break;
    }
    if (!placedOrder) {
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "order-submit",
        status: "FAILED",
        message: `Order placement failed: ${(lastPlaceError as Error)?.message ?? "unknown"}`,
        level: "ERROR",
        context: {
          orderType,
          side,
          quantity: baseQty,
          lastError: (lastPlaceError as Error)?.message ?? "unknown",
        },
      });
      throw ((lastPlaceError as Error) ?? new Error("Order placement failed"));
    }
    if (mode === "live") {
      await resetApiFailure(user.id).catch(() => null);
      await resetDomainApiFailure(user.id, "LIVE_EXECUTION").catch(() => null);
      await resetDomainApiFailure(user.id, "BALANCE").catch(() => null);
    } else if (mode === "paper") {
      await resetDomainApiFailure(user.id, "PAPER_EXECUTION").catch(() => null);
    }

    if (mode === "live" && !String(placedOrder.orderId ?? "").trim()) {
      publishExecutionEvent({
        executionId,
        symbol: executionSymbol,
        stage: "order-submit",
        status: "FAILED",
        message: "Borsa orderId donmedi, islem onaylanmadi",
        level: "ERROR",
      });
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: true,
        rejectReason: "Exchange order confirmation missing (orderId).",
        symbol: executionSymbol,
        decision: ai.finalDecision,
      });
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
    const placedMetadata = ((placedOrder as { metadata?: Record<string, unknown> }).metadata ??
      {}) as Record<string, unknown>;
    const actualFillPrice = Number(
      placedOrder.price ??
        placedMetadata.averageFillPrice ??
        placedMetadata.avgFillPrice ??
        entryPrice,
    );
    const fillCompletedAt = Date.now();
    const executionTelemetry = buildExecutionTelemetry({
      executionId,
      symbol: executionSymbol,
      side,
      signalTimestamp:
        typeof selected.context.metadata.scannedAt === "string"
          ? selected.context.metadata.scannedAt
          : undefined,
      decisionTimestamp,
      orderTimestamp: orderPlacementStartedAt,
      exchangeResponseTimestamp: fillCompletedAt,
      fillTimestamp: fillCompletedAt,
      expectedPrice: entryPrice,
      fillPrice: actualFillPrice,
      spreadPercent: Number(selected.context.spreadPercent ?? 0),
      bidDepth,
      askDepth,
      liquidity24h: Number(selected.context.volume24h ?? 0),
      depthCoverage: preSubmitExecution.depthCoverage,
      requestedQty: submittedQty,
      filledQty: submittedQty,
      orderStatus: normalizedOrderStatus,
      orderType,
      marketRegime: String(selected.context.metadata.marketRegime ?? ""),
      retryCount: placementRetryCount,
      latencyMs: fillCompletedAt - orderPlacementStartedAt,
      metadata: {
        source: placedMetadata.source ?? "analyze-and-trade",
        simulationId: placedMetadata.simulationId,
        fillCount: placedMetadata.fillCount,
      },
    });
    bridgeEntryTimingForensics({
      candidateId: forensicCandidateId,
      symbol: executionSymbol,
      side: side === "SELL" ? "SHORT" : "LONG",
      candidateTimestamp: selected.context.metadata.candidateTimestamp as string | undefined,
      decisionTimestamp: ai.generatedAt,
      entryTimestamp: new Date(fillCompletedAt).toISOString(),
      priceAtCandidate: Number(selected.context.lastPrice ?? entryPrice),
      priceAtDecision: Number(selected.context.lastPrice ?? entryPrice),
      priceAtEntry: actualFillPrice,
    });
    publishExecutionEvent({
      executionId,
      symbol: executionSymbol,
      stage: "execution-telemetry",
      status: normalizedOrderStatus === "FILLED" ? "SUCCESS" : "RUNNING",
      message: `Execution telemetry captured (${executionTelemetry.fillStatus}, slippage ${executionTelemetry.slippagePct}%)`,
      level: "INFO",
      context: executionTelemetry as unknown as Record<string, unknown>,
    });
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
        buyPrice: actualFillPrice,
        buyQuantity: submittedQty,
        expectedPrice: entryPrice,
        slippagePct: executionTelemetry.slippagePct,
        fillTimeMs: executionTelemetry.fillTimeMs,
      },
    });
    if (side === "BUY") {
      await logTradeEvent({
        symbol: executionSymbol,
        eventType: "BUY_ORDER_SENT",
        price: actualFillPrice,
        newValue: {
          orderId: placedOrder.orderId,
          status: normalizedOrderStatus,
          quantity: submittedQty,
          slippagePct: executionTelemetry.slippagePct,
        },
        reason: normalizedOrderStatus,
      });
    }
    const fee = await estimateFees(executionSymbol, side, submittedQty, actualFillPrice);
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
      avgExecutionPrice: actualFillPrice,
      fee: fee.estimatedTakerFee,
      feeCurrency: pair.quoteAsset,
      slippage: executionTelemetry.slippagePct,
      metadata: {
        mode,
        executionId,
        source: "analyze-and-trade",
        aiFinalDecision: aiGate.aiFinalDecision,
        aiConsensusDecision: aiGate.consensusDecision,
        aiGatePolicy: aiGate.policy,
        aiGateVerdict: aiGate.verdict,
        aiGateReasonCode: aiGate.reasonCode,
        aiGateReasonDetail: aiGate.reasonDetail,
        executionVerdict: aiGate.verdict === "AI_GATE_PASS" ? "ALLOW" : "BLOCK",
        riskDecision: riskGate.verdict === "ALLOW" ? "APPROVED" : riskGate.reasonCodes.join(" | "),
        sizingDecision: `qty=${preValidation.adjustedQuantity} notional=${preValidation.notional}`,
        feeDecision: `estimatedRoundTripFee=${feeEdgeMetrics.estimatedRoundTripFees}`,
        executionVenue: useGlobalLeverageVenue ? "BINANCE_GLOBAL" : "BINANCE_TR",
        requestedLeverage: requestedLeverageSafe,
        requestedQuoteAmountTry: requestedQuoteAmountTry > 0 ? requestedQuoteAmountTry : undefined,
        requestedQuoteAmountUsdt: requestedQuoteAmountUsdt > 0 ? requestedQuoteAmountUsdt : undefined,
        executionTelemetry,
      },
    });

    await addTradeExecution({
      tradeOrderId: orderRecord.id,
      status: normalizedOrderStatus === "FILLED" ? "SUCCESS" : "PENDING",
      executionPrice: actualFillPrice,
      executedQty: placedOrder.executedQty,
      quoteQty: Number((placedOrder.executedQty * actualFillPrice).toFixed(8)),
      fee: fee.estimatedTakerFee,
      slippage: executionTelemetry.slippagePct,
      executionRef: placedOrder.orderId,
      metadata: {
        mode,
        rawStatus: placedOrder.status,
        fillStatus: executionTelemetry.fillStatus,
        latencyMs: executionTelemetry.fillTimeMs,
      },
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
      return finishExecution({
        executionId,
        mode,
        opened: false,
        rejected: false,
        symbol: executionSymbol,
        decision: ai.finalDecision,
        orderId: orderRecord.id,
        tradeSignalId: tradeSignal.id,
        details: { orderStatus: normalizedOrderStatus },
      });
    }

    const positionSide = side === "BUY" ? "LONG" : "SHORT";
    const momentumBreakout = evaluateMomentumBreakout(selected.context);
    const runtimeTrailingStart = Number(runtimeStrategy.trailingStartPercent ?? 0);
    const runtimeTrailingGap = Number(runtimeStrategy.trailingGapPercent ?? 0);
    const effectiveTrailingStart = pumpMarketPriority
      ? Math.min(Number(runtimeTrailingStart || ai.analysisScorecard?.trailingStartPercent || 0.55), 0.42)
      : runtimeTrailingStart > 0
        ? runtimeTrailingStart
        : ai.analysisScorecard?.trailingStartPercent;
    const effectiveTrailingGap = pumpMarketPriority
      ? Math.max(Number(runtimeTrailingGap || ai.analysisScorecard?.trailingGapPercent || 0.25), 0.3)
      : runtimeTrailingGap > 0
        ? runtimeTrailingGap
        : ai.analysisScorecard?.trailingGapPercent;
    const decisionFeatureSnapshot = buildDecisionFeatureSnapshot({
      candidate: selected,
      ai,
      decisionId: executionId,
      candidateId: forensicCandidateId,
      roundId: input.roundId ?? forensicSession?.roundId ?? (typeof selected.context.metadata.roundId === "string" ? selected.context.metadata.roundId : null),
      runId: input.runId ?? forensicSession?.runId ?? (typeof selected.context.metadata.runId === "string" ? selected.context.metadata.runId : null),
      sessionId:
        input.sessionId ??
        forensicSession?.sessionId ??
        (typeof selected.context.metadata.sessionId === "string"
          ? selected.context.metadata.sessionId
          : typeof selected.context.metadata.jobId === "string"
            ? selected.context.metadata.jobId
            : null),
      decisionTimestamp: ai.generatedAt,
      regime: marketRegime.mode,
      marketRegimeReason: marketRegime.reason,
    });
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
      feeTotal: fee.estimatedTakerFee,
      metadata: {
        executionId,
        campaignId: executionIdentity.campaignId,
        mode,
        executionVenue: useGlobalLeverageVenue ? "BINANCE_GLOBAL" : "BINANCE_TR",
        executionSymbol,
        displaySymbol: symbol,
        marketRegime: marketRegime.mode,
        marketRegimeReason: marketRegime.reason,
        marketRegimeStrategy: marketRegime.strategy,
        learningLane,
        requestedLeverage: requestedLeverageSafe,
        requestedQuoteAmountTry: requestedQuoteAmountTry > 0 ? requestedQuoteAmountTry : undefined,
        requestedQuoteAmountUsdt: requestedQuoteAmountUsdt > 0 ? requestedQuoteAmountUsdt : undefined,
        takeProfitPrice,
        stopLossPrice,
        takeProfitPercent,
        stopLossPercent,
        targetSellPercent: ai.analysisScorecard?.targetSellPercent,
        trailingStartPercent: effectiveTrailingStart,
        trailingGapPercent: effectiveTrailingGap,
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
        ruleTags: [
          ...buildRuleTags({
            aiConfidence: ai.finalConfidence,
            aiRiskScore: ai.finalRiskScore,
            spreadPercent: selected.context.spreadPercent,
            volatilityPercent: selected.context.volatilityPercent,
            qualityScore: qualityGate.qualityScore,
          }),
          ...(pumpMarketPriority ? ["pump_early_catcher", "market_buy_priority"] : []),
        ],
        spreadPercent: selected.context.spreadPercent,
        volatilityPercent: selected.context.volatilityPercent,
        orderBookImbalance: selected.context.orderBookImbalance,
        shortMomentumPercent: Number(selected.context.metadata.shortMomentumPercent ?? 0),
        shortFlowImbalance: Number(selected.context.metadata.shortFlowImbalance ?? 0),
        change5m: Number.isFinite(Number(selected.context.metadata.change5m))
          ? Number(selected.context.metadata.change5m)
          : undefined,
        change15m: Number.isFinite(Number(selected.context.metadata.change15m))
          ? Number(selected.context.metadata.change15m)
          : undefined,
        tradeVelocity: Number(selected.context.metadata.tradeVelocity ?? 0),
        fakeSpikeScore: selected.context.fakeSpikeScore,
        pumpRisk: selected.context.pumpRisk,
        pumpIntensity: selected.context.pumpIntensity,
        volumeSpikePercent: selected.context.volumeSpikePercent,
        momentumBreakout,
        pumpEarlyCatcher: pumpMarketPriority,
        pumpEarlyPriorityScore: selected.context.metadata.pumpEarlyPriorityScore,
        pumpEarlyMaxMovePercent: selected.context.metadata.pumpEarlyMaxMovePercent,
        pumpEarlyConfirmed: selected.context.metadata.pumpEarlyConfirmed,
        pumpEarlyOrderType: selected.context.metadata.pumpEarlyOrderType,
        mtfAlignmentScore: Number(ai.decisionPayload?.timeframeAnalysis?.alignmentScore ?? 0),
        timeframeAnalysis: ai.decisionPayload?.timeframeAnalysis,
        aiConfidence: ai.finalConfidence,
        aiRiskScore: ai.finalRiskScore,
        partialTpPlan: resolvePartialTakeProfitPlan({
          takeProfitPercent,
          stopLossPercent,
        }),
        smartExitState: {
          lastAdaptiveTp: initialSmartExitPlan.adaptiveTp,
          peakProfitPercent: 0,
          lastRegime: marketRegime.mode,
        },
        variantDShadowEnabled: env.EXECUTION_VARIANT_D_SHADOW_ENABLED,
        variantDEnabled: env.EXECUTION_VARIANT_D_ENABLED,
        decisionFeatureSnapshot,
        candidateId: forensicCandidateId,
        roundId: decisionFeatureSnapshot.roundId ?? undefined,
        runId: decisionFeatureSnapshot.runId ?? undefined,
        sessionId: decisionFeatureSnapshot.sessionId ?? undefined,
        decisionTimestamp: decisionFeatureSnapshot.decisionTimestamp,
      },
    });
    await bindDecisionFeatureSnapshotPositionId(position.id);
    await attachOrderToPosition(orderRecord.id, position.id);
    if (mode === "paper") {
      const simulationId = String(placedMetadata.simulationId ?? "");
      try {
        if (!simulationId) {
          throw preserveExecutionFailure(new Error("PAPER_EXECUTION_SIMULATION_ID_MISSING"), {
            operation: "persist_paper_fill",
            dependency: "execution_simulation",
            executionMode: "paper",
            domainHint: "PAPER_EXECUTION",
          });
        }
        await recordPaperFillEvent({
          campaignId: executionIdentity.campaignId ?? undefined,
          userId: user.id,
          simulationId,
          executionId,
          positionId: position.id,
          symbol: executionSymbol,
          side,
          executedQty: submittedQty,
          avgFillPrice: actualFillPrice,
          fee: fee.estimatedTakerFee,
          fillCount: Number(placedMetadata.fillCount ?? 1),
        });
      } catch (error) {
        const persistenceFailure = resolveExecutionFailure(error, {
          operation: "persist_paper_fill",
          dependency: "paper_trade_repository",
          executionMode: "paper",
          domainHint: "DATABASE",
        });
        await markPaperPersistenceReconciliation({
          executionId,
          symbol: executionSymbol,
          side,
          quantity: submittedQty,
          positionId: position.id,
          orderId: orderRecord.id,
          simulationId: simulationId || null,
          candidateId: canonicalCandidateId,
          campaignId: executionIdentity.campaignId,
          jobId: executionIdentity.jobId,
          sessionId: executionIdentity.sessionId,
          runId: executionIdentity.runId,
          roundId: executionIdentity.roundId,
          venue: executionIdentity.venue,
          failure: persistenceFailure,
        });
        throw new CanonicalExecutionError(persistenceFailure, { cause: error });
      }
    }
    void replayExecutionRecord({
      executionId,
      orderId: orderRecord.id,
      symbol: executionSymbol,
      side,
      mode,
      requestedQty: preValidation.adjustedQuantity,
      executedQty: submittedQty,
      requestedPrice: preValidation.marketPrice,
      executionPrice: entryPrice,
      fees: fee.estimatedTakerFee,
      positionId: position.id,
    }).catch(() => null);
    if (side === "BUY") {
      await logTradeEvent({
        positionId: position.id,
        symbol: executionSymbol,
        eventType: "BUY_COMPLETED",
        price: entryPrice,
        newValue: {
          orderId: orderRecord.id,
          quantity: submittedQty,
        },
        reason: normalizedOrderStatus,
      });
      await notifySystemEvent({
        userId: user.id,
        eventType: "BUY",
        title: "Yeni BUY islemi",
        message: `${executionSymbol} alindi (${submittedQty.toFixed(6)})`,
        level: "INFO",
        symbol: executionSymbol,
      });
    }

    await attachPositionMonitor({
      executionId,
      userId: user.id,
      positionId: position.id,
      tradeId: position.id,
      symbol: executionSymbol,
      side: position.side,
      quantity: submittedQty,
      strategy: marketRegime.strategy,
      regime: marketRegime.mode,
      openedAt: position.openedAt.toISOString(),
      entryPrice,
      takeProfitPrice,
      stopLossPrice,
      targetSellPercent: ai.analysisScorecard?.targetSellPercent,
      trailingStartPercent: effectiveTrailingStart,
      trailingGapPercent: effectiveTrailingGap,
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
      isPumpTrade: pumpMarketPriority,
      variantDShadowEnabled: env.EXECUTION_VARIANT_D_SHADOW_ENABLED,
      variantDEnabled: env.EXECUTION_VARIANT_D_ENABLED,
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
      executionState: "COMPLETED",
      opened: true,
      rejected: false,
      symbol: executionSymbol,
      orderId: orderRecord.id,
      positionId: position.id,
      updatedAt: new Date().toISOString(),
    });
    getCanonicalCandidateStore().transitionCandidate(canonicalCandidateId, "PAPER_OPENED", ["PAPER_POSITION_OPENED"]);

    observeTradeDecision({
      decisionId: executionId,
      symbol: executionSymbol,
      outcome: "OPENED",
      message: "Trade opened successfully",
      details: {
        orderId: orderRecord.id,
        positionId: position.id,
        entryPrice,
        takeProfitPrice,
        stopLossPrice,
      },
    });

    return finishExecution({
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
    });
  } catch (error) {
    resumeScannerWorker();
    const appError = toAppError(error);
    const internalMessage = redactExecutionError(appError.message);
    const paperFailure = mode === "paper" && /paper|simulation/i.test(internalMessage);
    const failure = resolveExecutionFailure(error, {
      operation: paperFailure ? "simulate_order" : "execute_analyze_and_trade",
      dependency: paperFailure ? "paper_exchange_simulator" : "execution_orchestrator",
      venue: executionIdentity.venue,
      executionMode: mode,
      appErrorCode: appError.code,
    });
    const safeMessage = formatCanonicalExecutionReason(failure);
    logger.error(
      {
        err: failure.safeMessage,
        code: appError.code,
        failureDomain: failure.failureDomain,
        failureCode: failure.failureCode,
      },
      "Execution orchestrator failed",
    );
    try {
      const { user } = await getRuntimeExecutionContext(input.userId);
      if (failure.breakerEligible) {
        const failureState = await registerDomainApiFailure({
          userId: user.id,
          domain: failure.failureDomain,
          reasonCode: failure.failureCode,
          reasonMessage: failure.safeMessage,
          cooldownMs: 10 * 60 * 1000,
        });
        const risk = await getEffectiveRiskConfig(user.id);
        if (failureState.count >= risk.apiFailureBreaker) {
          failure.breakerState = "OPEN";
          failure.openUntil = failureState.blockedUntil ?? null;
          if (mode === "live" && failure.failureDomain === "LIVE_EXECUTION") {
            await setSafeModeState({
              userId: user.id,
              enabled: true,
              reason: safeMessage,
              requireManualAck: true,
            }).catch(() => null);
          }
          await notifySystemEvent({
            userId: user.id,
            eventType: "EXECUTION_DEPENDENCY_ERROR",
            title: "Execution dependency breaker",
            message: `${safeMessage} dependency=${failure.dependency} operation=${failure.operation}`,
            level: "ERROR",
          });
          publishExecutionEvent({
            executionId,
            symbol: input.requestedSymbol,
            stage: "BREAKER_OPENED",
            status: "FAILED",
            message: safeMessage,
            level: "ERROR",
            context: { ...executionIdentity, ...failure },
          });
          logger.warn(
            { userId: user.id, failureCount: failureState.count, breaker: risk.apiFailureBreaker, failure },
            "Isolated execution dependency breaker reached",
          );
        }
      }
      if (failure.failureDomain === "DATABASE") {
        await setSafeModeState({
          userId: user.id,
          enabled: true,
          reason: safeMessage,
          requireManualAck: true,
        }).catch(() => null);
      }
    } catch (telemetryError) {
      logger.warn(
        { error: redactExecutionError(telemetryError), executionId },
        "Execution failure telemetry persistence failed",
      );
    }
    publishExecutionEvent({
      executionId,
      symbol: input.requestedSymbol,
      stage: "failed",
      status: "FAILED",
      message: safeMessage,
      level: "ERROR",
      context: { ...executionIdentity, ...failure },
    });
    const { user } = await getRuntimeExecutionContext(input.userId).catch(() => ({ user: null as { id: string } | null }));
    if (user?.id) {
      const keepInProgressForLateResultGuard =
        mode === "paper" &&
        (failure.operation === "simulate_order" ||
          /paper|simulation/i.test(internalMessage) ||
          /paper|simulation/i.test(safeMessage)) &&
        (/TIMEOUT/i.test(failure.failureCode) ||
          /CANCEL/i.test(failure.failureCode) ||
          /TIMEOUT/i.test(internalMessage) ||
          /CANCEL/i.test(internalMessage));
      await persistAnalysisState({
        userId: user.id,
        executionId,
        symbol: input.requestedSymbol,
        stage: "failed",
        status: "FAILED",
      }).catch(() => null);
      if (!input.bypassIdempotency) {
        if (keepInProgressForLateResultGuard) {
          publishExecutionEvent({
            executionId,
            symbol: input.requestedSymbol,
            stage: "LATE_RESULT_GUARD_ARMED",
            status: "RUNNING",
            message: "Paper timeout/cancel guarded: execution intent kept IN_PROGRESS for late result dedupe",
            level: "WARN",
            context: { ...executionIdentity, failureCode: failure.failureCode, failureDomain: failure.failureDomain },
          });
        }
        await setIdempotentExecution(user.id, idempotencyKey, {
          executionId,
          executionState: keepInProgressForLateResultGuard ? "IN_PROGRESS" : "FAILED",
          opened: false,
          rejected: true,
          rejectReason: safeMessage,
          symbol: input.requestedSymbol ?? undefined,
          updatedAt: new Date().toISOString(),
        }).catch(() => null);
      }
    }
    await addSystemLog({
      level: "ERROR",
      source: "execution-orchestrator",
      message: `Execution failed: ${internalMessage}`,
      context: {
        executionId,
        failureDomain: failure.failureDomain,
        failureCode: failure.failureCode,
        operation: failure.operation,
        dependency: failure.dependency,
        retryable: failure.retryable,
        statusCode: failure.statusCode,
      },
    }).catch(() => null);
    if (canonicalCandidateId) {
      getCanonicalCandidateStore().transitionCandidate(canonicalCandidateId, "PAPER_REJECTED", [failure.failureCode]);
    }
    await logTradeLifecycle({
      executionId,
      stage: "failed",
      status: "FAILED",
      message: safeMessage,
      context: { ...executionIdentity, ...failure },
    });
    return finishExecution({
      executionId,
      mode,
      opened: false,
      rejected: true,
      rejectReason: safeMessage,
      details: { ...failure },
    });
  } finally {
    markHeartbeat({ service: "execution", status: "UP", message: "Execution flow finished", details: { executionId } });
    if (obsResult) {
      observeDeferredExecutionResult({
        decisionId: executionId,
        symbol: obsResult.symbol ?? obsSelected?.context.symbol ?? input.requestedSymbol ?? "UNKNOWN",
        opened: obsResult.opened,
        rejected: obsResult.rejected,
        rejectReason: obsResult.rejectReason,
        decision: obsResult.decision,
        candidate: obsSelected,
        ai: obsAi,
        qualityGate: obsQualityGate,
        metadata: { mode, details: obsResult.details ?? null },
      });
    }
  }
  });
}

export async function executeAnalyzeAndTrade(input: ExecuteTradeInput): Promise<ExecutionResult> {
  const result = await executeAnalyzeAndTradeInternal(input);
  if (!result.opened && result.rejected) {
    await recordExecutionRejectLearning({
      executionId: result.executionId,
      userId: input.userId,
      mode: result.mode,
      reason: result.rejectReason ?? "Execution rejected",
      requestedSymbol: result.symbol ?? input.requestedSymbol,
    });
  }
  return result;
}

export async function closePositionManually(input: {
  positionId: string;
  executionId?: string;
  reason?: "MANUAL_CLOSE" | "EMERGENCY_STOP" | "RISK_BREAKER";
}) {
  const executionId = input.executionId ?? randomUUID();
  stopPositionMonitor(input.positionId);
  const position = await getPositionById(input.positionId);
  const metadata = (position?.metadata as Record<string, unknown> | null) ?? {};
  const metadataMode = String(metadata.mode ?? "").toLowerCase();
  const mode: TradingMode =
    metadataMode === "paper" || metadataMode === "live" || metadataMode === "dry-run"
      ? (metadataMode as TradingMode)
      : getMode();
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
  await logTradeEvent({
    positionId: order.positionId ?? null,
    symbol: order.tradingPair.symbol,
    eventType: "OLD_ORDER_CANCELED",
    price: Number(order.price ?? 0),
    newValue: { orderId: order.id },
    reason: "manual-cancel",
  });
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
  await notifySystemEvent({
    userId: user.id,
    eventType: "EMERGENCY_STOP",
    title: "Emergency stop aktif",
    message: `${closed.length} pozisyon kapatildi.`,
    level: "ERROR",
  });
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
