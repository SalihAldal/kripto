import { env } from "@/lib/config";
import { getTicker, getKlines, getOrderBook } from "@/services/binance.service";
import { publishExecutionEvent } from "@/src/server/execution/execution-event-bus";
import { logTradeEvent } from "@/src/server/observability/trade-event-log";
import { notifySystemEvent } from "@/src/server/notifications/notification.service";
import { evaluateTakeProfitStopLoss } from "@/src/server/execution/tp-sl-evaluator";
import { isExecutionTimedOut } from "@/src/server/execution/timeout-closer";
import type { PositionCloseReason, TradingMode } from "@/src/server/execution/types";
import { evaluateSmartExitEngine, type SmartExitEngineState } from "@/src/server/execution/smart-exit-engine.service";
import { observeVariantDShadowNonBlocking } from "@/src/server/forensics/variant-d-shadow-observer.service";
import {
  evaluateExitForOpenPosition,
  shouldExecuteExit,
} from "@/src/server/execution-engine-v2/exit-ai.gateway.service";
import { buildPositionReport } from "@/src/server/ai/position-report.service";
import {
  calculateNetProfitPercent,
  calculatePositionProfitPercent,
  MINIMUM_NET_EXIT_PROFIT_PERCENT,
  isProtectedProfitCloseReason,
  resolveMinimumProtectedProfitPercent,
} from "@/src/server/execution/profit-thresholds";
import type { KlineItem, OrderBookSnapshot } from "@/src/types/exchange";

type MonitorPayload = {
  executionId: string;
  userId?: string;
  positionId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  openedAt: string;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  entryPrice?: number;
  targetSellPercent?: number;
  trailingStartPercent?: number;
  trailingGapPercent?: number;
  maxDurationSec: number;
  extensionStepSec?: number;
  extensionMaxSec?: number;
  partialTpPlan?: {
    enabled?: boolean;
    firstTargetPercent?: number;
    trailingDrawdownPercent?: number;
  };
  smartExit?: {
    state: SmartExitEngineState;
  };
  onShouldExtend?: (input: { positionId: string; symbol: string; side: "LONG" | "SHORT"; markPrice: number }) => Promise<boolean>;
  onDynamicExit?: (input: {
    positionId: string;
    symbol: string;
    side: "LONG" | "SHORT";
    markPrice: number;
  }) => Promise<PositionCloseReason | null>;
  onReadExitSignals?: (input: {
    positionId: string;
    symbol: string;
    side: "LONG" | "SHORT";
    markPrice: number;
  }) => Promise<{
    shortMomentumPercent: number;
    shortFlowImbalance: number;
    shortCandleSignal: number;
    spreadPercent: number;
    volatilityPercent: number;
    volume24h: number;
    marketRegime: string;
    reverseSignal: boolean;
  }>;
  onClose: (input: { executionId: string; positionId: string; reason: PositionCloseReason }) => Promise<{ closed?: boolean } | void>;
  onTick?: (input: { positionId: string; markPrice: number }) => Promise<void>;
  mode?: TradingMode;
  isPumpTrade?: boolean;
  tradeId?: string;
  roundId?: string;
  strategy?: string;
  regime?: string;
  quantity?: number;
  variantDShadowEnabled?: boolean;
  variantDEnabled?: boolean;
};

const monitors = new Map<string, NodeJS.Timeout>();
const busy = new Set<string>();

function canCloseForProtectedProfit(input: {
  side: "LONG" | "SHORT";
  entryPrice?: number;
  markPrice: number;
  reason: PositionCloseReason | null | undefined;
}) {
  if (!isProtectedProfitCloseReason(input.reason)) return true;
  const netProfitPercent = calculateNetProfitPercent({
    side: input.side,
    entryPrice: Number(input.entryPrice ?? 0),
    exitPrice: input.markPrice,
  });
  return netProfitPercent >= MINIMUM_NET_EXIT_PROFIT_PERCENT;
}

function shouldStopMonitorAfterCloseAttempt(result: { closed?: boolean } | void) {
  if (!result) return true;
  if (typeof result !== "object") return true;
  return result.closed !== false;
}

function shouldPaperLossCapCut(input: {
  paperMode?: boolean;
  profitPercent: number;
  ageSec: number;
  isPumpTrade?: boolean;
  momentumDead?: boolean;
}) {
  if (!input.paperMode) return false;
  const holdSec = input.isPumpTrade
    ? Math.max(env.EXECUTION_PAPER_PUMP_MAX_LOSS_CUT_HOLD_SEC, env.EXECUTION_PAPER_MAX_LOSS_CUT_HOLD_SEC)
    : env.EXECUTION_PAPER_MAX_LOSS_CUT_HOLD_SEC;
  const maxLossPct = Math.abs(
    input.isPumpTrade ? env.EXECUTION_PAPER_PUMP_MAX_LOSS_CUT_PERCENT : env.EXECUTION_PAPER_MAX_LOSS_CUT_PERCENT,
  );
  if (input.ageSec < holdSec) return false;
  if (input.profitPercent > -maxLossPct) return false;
  if (!input.isPumpTrade && input.profitPercent > -(maxLossPct * 0.85) && !input.momentumDead) return false;
  return true;
}

function shouldPaperStallExit(input: {
  paperMode?: boolean;
  profitPercent: number;
  ageSec: number;
  isPumpTrade?: boolean;
  maxDurationSec: number;
  momentumDead?: boolean;
}) {
  if (!input.paperMode || input.isPumpTrade) return false;
  const stallAfterSec = Math.max(2400, Math.floor(input.maxDurationSec * 0.62));
  if (input.ageSec < stallAfterSec) return false;
  if (input.profitPercent >= 0.45) return false;
  if (input.profitPercent <= -0.34) return false;
  return input.momentumDead || input.profitPercent < 0.22;
}

function shouldLossCutOnSat(input: {
  signal: string;
  satTrigger: string | null;
  profitPercent: number;
  paperMode?: boolean;
}) {
  // Paper modda agresif SAT kesmesi kapali; kontrollu kayip tavanı shouldPaperLossCapCut ile yonetilir.
  if (input.paperMode) return false;
  if (input.signal !== "SAT" || !input.satTrigger) return false;
  const trigger = input.satTrigger.toLowerCase();
  const structuralSat =
    trigger.includes("ma7") ||
    trigger.includes("hacim") ||
    trigger.includes("satış baskısı") ||
    trigger.includes("satis baskisi");
  return structuralSat && input.profitPercent <= -0.25;
}

function isSoftExitReason(reason: PositionCloseReason | null | undefined) {
  return reason === "REVERSE_SIGNAL" || reason === "MOMENTUM_FADE";
}

function isSuspiciousMonitorPrice(input: {
  entryPrice?: number;
  currentPrice: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
}) {
  const entry = Number(input.entryPrice ?? 0);
  const price = Number(input.currentPrice);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(price) || price <= 0) return false;
  const deviationPercent = Math.abs(((price - entry) / entry) * 100);
  const plannedRangePrices = [input.takeProfitPrice, input.stopLossPrice]
    .map((value) => Number(value ?? NaN))
    .filter((value) => Number.isFinite(value) && value > 0);
  const maxPlannedDeviation = Math.max(
    8,
    ...plannedRangePrices.map((planned) => Math.abs(((planned - entry) / entry) * 100) * 3),
  );
  return deviationPercent >= Math.max(35, maxPlannedDeviation);
}

function resolveExitPrecedenceState(reason: PositionCloseReason | "NONE") {
  switch (reason) {
    case "TAKE_PROFIT":
    case "STOP_LOSS":
      return "TP_SL";
    case "TIMEOUT":
      return "SYSTEM_TIMEOUT";
    case "MOMENTUM_FADE":
    case "REVERSE_SIGNAL":
      return "STRATEGY_EXIT";
    case "EARLY_PROFIT_PROTECT":
    case "TRAILING_PROFIT_LOCK":
      return "PROFIT_PROTECTION";
    case "RISK_BREAKER":
    case "EMERGENCY_STOP":
      return "SAFETY_EXIT";
    case "CANCELED":
      return "TERMINAL";
    default:
      return "NO_EXIT";
  }
}

export function startPositionMonitor(payload: MonitorPayload) {
  stopPositionMonitor(payload.positionId);
  let dynamicMaxDurationSec = payload.maxDurationSec;
  let extendedSec = 0;
  let protectArmed = false;
  let firstTargetReached = false;
  let breakevenArmed = false;
  let partial25Armed = false;
  let partial50Armed = false;
  let peakProfitPercent = Number.NEGATIVE_INFINITY;
  let lastActiveStopPrice: number | null = null;
  let trailingActivationLogged = false;
  let lastAdaptiveTp: number | null = payload.takeProfitPrice ?? null;
  let dynamicStopLossPrice: number | undefined = payload.stopLossPrice;
  let lastSuspiciousPriceLogAt = 0;
  let lastPaperSoftExitReason: PositionCloseReason | null = null;
  let paperSoftExitConfirmations = 0;
  let lastPaperSoftExitDeferralLogAt = 0;
  const openedAtMs = Date.parse(payload.openedAt);
  const minPaperSoftExitHoldSec = Math.max(0, env.EXECUTION_PAPER_MIN_SOFT_EXIT_HOLD_SEC);
  const requiredPaperSoftExitConfirmations = Math.max(1, env.EXECUTION_PAPER_SOFT_EXIT_CONFIRMATIONS);
  const variantDShadowEnabled = payload.variantDShadowEnabled ?? env.EXECUTION_VARIANT_D_SHADOW_ENABLED;
  const variantDEnabled = payload.variantDEnabled ?? env.EXECUTION_VARIANT_D_ENABLED;
  let lastObservedMarkPrice = Number(payload.entryPrice ?? 0);
  let lastObservedAt = Date.now();

  const emitVariantDShadow = (input: {
    baselineExitEligible: boolean;
    baselineReason: PositionCloseReason | "NONE";
    currentExitPrecedenceState: string;
    terminalPosition?: boolean;
  }) => {
    if (!variantDShadowEnabled) return;
    const observationTs = lastObservedAt;
    const holdDurationSec = Number.isFinite(openedAtMs) ? Math.max(0, (observationTs - openedAtMs) / 1000) : 0;
    const baselineInput = {
      side: payload.side,
      entryPrice: Number(payload.entryPrice ?? 0),
      currentPrice: Number(lastObservedMarkPrice),
      holdDurationSec: Number(holdDurationSec.toFixed(3)),
      maxDurationSec: dynamicMaxDurationSec,
      baselineReason: input.baselineReason,
      baselineExitEligible: input.baselineExitEligible,
    };
    observeVariantDShadowNonBlocking({
      timestamp: observationTs,
      positionId: payload.positionId,
      tradeId: payload.tradeId ?? payload.positionId,
      roundId: payload.roundId,
      symbol: payload.symbol,
      side: payload.side,
      strategy: payload.strategy,
      regime: payload.regime,
      entryTimestamp: payload.openedAt,
      entryPrice: Number(payload.entryPrice ?? 0),
      quantity: Number(payload.quantity ?? 0),
      currentPrice: Number(lastObservedMarkPrice),
      maxDurationSec: dynamicMaxDurationSec,
      baselineExitEligible: input.baselineExitEligible,
      baselineReason: input.baselineReason,
      currentExitPrecedenceState: input.currentExitPrecedenceState,
      terminalPosition: input.terminalPosition,
      baselineInput,
      shadowInput: baselineInput,
    });
  };

  const baseOnClose = payload.onClose;
  payload.onClose = async (input) => {
    emitVariantDShadow({
      baselineExitEligible: true,
      baselineReason: input.reason,
      currentExitPrecedenceState: resolveExitPrecedenceState(input.reason),
      terminalPosition: input.reason === "CANCELED",
    });
    return baseOnClose(input);
  };

  const closeByTimeoutWithExtension = async (markPrice: number) => {
    if (!isExecutionTimedOut(payload.openedAt, dynamicMaxDurationSec)) return false;
    const canExtend =
      env.EXECUTION_TIMEOUT_EXTENSION_ENABLED &&
      Boolean(payload.onShouldExtend) &&
      (payload.extensionMaxSec ?? env.EXECUTION_TIMEOUT_EXTENSION_MAX_SEC) > extendedSec;
    if (canExtend) {
      const shouldExtend = await payload.onShouldExtend!({
        positionId: payload.positionId,
        symbol: payload.symbol,
        side: payload.side,
        markPrice,
      }).catch(() => false);
      if (shouldExtend) {
        const step = payload.extensionStepSec ?? env.EXECUTION_TIMEOUT_EXTENSION_STEP_SEC;
        const max = payload.extensionMaxSec ?? env.EXECUTION_TIMEOUT_EXTENSION_MAX_SEC;
        const applied = Math.min(step, max - extendedSec);
        if (applied > 0) {
          dynamicMaxDurationSec += applied;
          extendedSec += applied;
          publishExecutionEvent({
            executionId: payload.executionId,
            symbol: payload.symbol,
            stage: "position-monitor",
            status: "RUNNING",
            message: `Timeout extension applied (+${applied}s, total=${extendedSec}s)`,
            level: "INFO",
            context: {
              positionId: payload.positionId,
              markPrice,
              openedAt: payload.openedAt,
              maxDurationSec: dynamicMaxDurationSec,
              extendedSec,
              variantDEnabled,
            },
          });
          return false;
        }
      }
    }
    const closeResult = await payload.onClose({
      executionId: payload.executionId,
      positionId: payload.positionId,
      reason: "TIMEOUT",
    });
    if (shouldStopMonitorAfterCloseAttempt(closeResult)) {
      stopPositionMonitor(payload.positionId);
      return true;
    }
    publishExecutionEvent({
      executionId: payload.executionId,
      symbol: payload.symbol,
      stage: "position-monitor",
      status: "RUNNING",
      message: "Timeout kapatma denemesi basarisiz, monitor aktif kaldi",
      level: "WARN",
      context: {
        positionId: payload.positionId,
        reason: "TIMEOUT",
        variantDEnabled,
      },
    });
    return true;
  };

  const shouldDeferPaperSoftExit = async (
    reason: PositionCloseReason,
    markPrice: number,
    source: string,
  ) => {
    if (payload.mode !== "paper" || !isSoftExitReason(reason)) return false;
    const ageSec = Number.isFinite(openedAtMs) ? Math.max(0, (Date.now() - openedAtMs) / 1000) : 0;
    const beforeMinHold = ageSec < minPaperSoftExitHoldSec;
    if (lastPaperSoftExitReason !== reason) {
      lastPaperSoftExitReason = reason;
      paperSoftExitConfirmations = 0;
    }
    if (!beforeMinHold) {
      paperSoftExitConfirmations += 1;
    }
    const confirmed = paperSoftExitConfirmations >= requiredPaperSoftExitConfirmations;
    if (!beforeMinHold && confirmed) return false;

    const now = Date.now();
    if (now - lastPaperSoftExitDeferralLogAt > 30_000) {
      lastPaperSoftExitDeferralLogAt = now;
      publishExecutionEvent({
        executionId: payload.executionId,
        symbol: payload.symbol,
        stage: "position-monitor",
        status: "RUNNING",
        message: beforeMinHold
          ? "Paper mod: erken ters sinyal kapatmasi ertelendi"
          : "Paper mod: ters sinyal icin ek teyit bekleniyor",
        level: "INFO",
        context: {
          positionId: payload.positionId,
          reason,
          source,
          ageSec: Number(ageSec.toFixed(1)),
          minHoldSec: minPaperSoftExitHoldSec,
          confirmations: paperSoftExitConfirmations,
          requiredConfirmations: requiredPaperSoftExitConfirmations,
          markPrice,
        },
      });
    }
    return true;
  };
  const tick = async () => {
    if (busy.has(payload.positionId)) return;
    busy.add(payload.positionId);
    try {
      const ticker = await getTicker(payload.symbol);
      lastObservedMarkPrice = Number(ticker.price);
      lastObservedAt = Date.now();
      if (isSuspiciousMonitorPrice({
        entryPrice: payload.entryPrice,
        currentPrice: ticker.price,
        takeProfitPrice: payload.takeProfitPrice,
        stopLossPrice: dynamicStopLossPrice,
      })) {
        const now = Date.now();
        if (now - lastSuspiciousPriceLogAt > 30_000) {
          lastSuspiciousPriceLogAt = now;
          publishExecutionEvent({
            executionId: payload.executionId,
            symbol: payload.symbol,
            stage: "position-monitor",
            status: "RUNNING",
            message: "Anormal fiyat tick'i reddedildi; TP/SL tetiklenmedi",
            level: "WARN",
            context: {
              positionId: payload.positionId,
              entryPrice: payload.entryPrice,
              currentPrice: ticker.price,
              takeProfitPrice: payload.takeProfitPrice,
              stopLossPrice: dynamicStopLossPrice,
              reason: "PRICE_QUOTE_MISMATCH_GUARD",
            },
          });
          await logTradeEvent({
            positionId: payload.positionId,
            symbol: payload.symbol,
            eventType: "RISK_GATE_BLOCKED",
            price: ticker.price,
            reason: "PRICE_QUOTE_MISMATCH_GUARD",
            newValue: {
              entryPrice: payload.entryPrice,
              takeProfitPrice: payload.takeProfitPrice,
              stopLossPrice: dynamicStopLossPrice,
            },
          });
        }
        emitVariantDShadow({
          baselineExitEligible: false,
          baselineReason: "NONE",
          currentExitPrecedenceState: "PRICE_GUARD_BLOCKED",
        });
        return;
      }
      await payload.onTick?.({ positionId: payload.positionId, markPrice: ticker.price });
      emitVariantDShadow({
        baselineExitEligible: false,
        baselineReason: "NONE",
        currentExitPrecedenceState: "BASELINE_EVALUATION",
      });

      // Variant_D precedence: enforce system timeout semantics before soft strategy exits.
      if (variantDEnabled) {
        const timeoutHandled = await closeByTimeoutWithExtension(ticker.price);
        if (timeoutHandled) return;
      }

      if (env.EXECUTION_ENGINE_V2_ENABLED && env.EXECUTION_ENGINE_V2_EXIT_AI_ENABLED) {
        try {
          const exitEval = await evaluateExitForOpenPosition({
            positionId: payload.positionId,
            symbol: payload.symbol,
          });
          publishExecutionEvent({
            executionId: payload.executionId,
            symbol: payload.symbol,
            stage: "exit-ai",
            status: "RUNNING",
            message: `Exit AI: ${exitEval.decision} (${exitEval.exitConfidence.toFixed(0)}%)`,
            level: exitEval.decision === "EMERGENCY_EXIT" ? "WARN" : "INFO",
            context: {
              positionId: payload.positionId,
              exitDecision: exitEval.decision,
              exitConfidence: exitEval.exitConfidence,
              profitProtectionScore: exitEval.profitProtectionScore,
              analysisId: exitEval.analysisId,
            },
          });
          if (shouldExecuteExit(exitEval)) {
            const closeReason: PositionCloseReason =
              exitEval.decision === "EMERGENCY_EXIT" ? "EMERGENCY_STOP" : "MOMENTUM_FADE";
            if (closeReason !== "EMERGENCY_STOP") {
              if (await shouldDeferPaperSoftExit(closeReason, ticker.price, "exit-ai")) {
                return;
              }
              if (
                !canCloseForProtectedProfit({
                  side: payload.side,
                  entryPrice: payload.entryPrice,
                  markPrice: ticker.price,
                  reason: closeReason,
                })
              ) {
                return;
              }
            }
            await logTradeEvent({
              positionId: payload.positionId,
              symbol: payload.symbol,
              eventType: "STOP_TRIGGERED",
              price: ticker.price,
              reason: closeReason,
              newValue: {
                exitAiDecision: exitEval.decision,
                exitConfidence: exitEval.exitConfidence,
                profitGiveback: exitEval.profitGiveback,
              },
            });
            const closeResult = await payload.onClose({
              executionId: payload.executionId,
              positionId: payload.positionId,
              reason: closeReason,
            });
            if (shouldStopMonitorAfterCloseAttempt(closeResult)) {
              stopPositionMonitor(payload.positionId);
              return;
            }
          }
        } catch {
          // Exit AI is best-effort; never block monitor on failure
        }
      }

      // --- Mod B: Position report (TUT/DİKKAT/SAT) ---
      try {
        const [klines1m, orderBook] = await Promise.all([
          getKlines(payload.symbol, "1m", 20).catch((): KlineItem[] => []),
          getOrderBook(payload.symbol, 10).catch((): OrderBookSnapshot => ({ bids: [], asks: [] })),
        ]);
        const posReport = buildPositionReport({
          symbol: payload.symbol,
          entryPrice: Number(payload.entryPrice ?? 0),
          currentPrice: ticker.price,
          stopPrice: dynamicStopLossPrice ?? payload.stopLossPrice ?? null,
          targetPrice: payload.takeProfitPrice ?? null,
          orderBook,
          klines1m,
        });
        const level = posReport.signal === "SAT" ? "WARN" : posReport.signal === "DİKKAT" ? "WARN" : "INFO";
        publishExecutionEvent({
          executionId: payload.executionId,
          symbol: payload.symbol,
          stage: "position-report",
          status: "RUNNING",
          message: posReport.report,
          level,
          context: {
            positionId: payload.positionId,
            signal: posReport.signal,
            reason: posReport.reason,
            satTrigger: posReport.satTrigger,
            phase: "EXIT_REEVAL",
          },
        });
        const currentProfitPercent = calculatePositionProfitPercent({
          side: payload.side,
          entryPrice: Number(payload.entryPrice ?? 0),
          markPrice: ticker.price,
        });
        const positionAgeSec = Number.isFinite(openedAtMs) ? Math.max(0, (Date.now() - openedAtMs) / 1000) : 0;
        const momentumDead = posReport.signal === "SAT";
        if (
          shouldPaperLossCapCut({
            paperMode: payload.mode === "paper",
            profitPercent: currentProfitPercent,
            ageSec: positionAgeSec,
            isPumpTrade: payload.isPumpTrade,
            momentumDead,
          })
        ) {
          if (await shouldDeferPaperSoftExit("MOMENTUM_FADE", ticker.price, "paper-loss-cap")) {
            return;
          }
          await logTradeEvent({
            positionId: payload.positionId,
            symbol: payload.symbol,
            eventType: "STOP_TRIGGERED",
            price: ticker.price,
            reason: "MOMENTUM_FADE",
            newValue: {
              profitPercent: Number(currentProfitPercent.toFixed(4)),
              paperLossCapPercent: env.EXECUTION_PAPER_MAX_LOSS_CUT_PERCENT,
              paperLossCapHoldSec: env.EXECUTION_PAPER_MAX_LOSS_CUT_HOLD_SEC,
            },
          });
          const closeResult = await payload.onClose({
            executionId: payload.executionId,
            positionId: payload.positionId,
            reason: "MOMENTUM_FADE",
          });
          if (shouldStopMonitorAfterCloseAttempt(closeResult)) {
            stopPositionMonitor(payload.positionId);
            return;
          }
        }
        if (
          shouldPaperStallExit({
            paperMode: payload.mode === "paper",
            profitPercent: currentProfitPercent,
            ageSec: positionAgeSec,
            isPumpTrade: payload.isPumpTrade,
            maxDurationSec: dynamicMaxDurationSec,
            momentumDead,
          })
        ) {
          if (await shouldDeferPaperSoftExit("MOMENTUM_FADE", ticker.price, "paper-stall-exit")) {
            return;
          }
          const closeResult = await payload.onClose({
            executionId: payload.executionId,
            positionId: payload.positionId,
            reason: "MOMENTUM_FADE",
          });
          if (shouldStopMonitorAfterCloseAttempt(closeResult)) {
            stopPositionMonitor(payload.positionId);
            return;
          }
        }
        if (shouldLossCutOnSat({
          signal: posReport.signal,
          satTrigger: posReport.satTrigger,
          profitPercent: currentProfitPercent,
          paperMode: payload.mode === "paper",
        })) {
          if (await shouldDeferPaperSoftExit("REVERSE_SIGNAL", ticker.price, "position-report")) {
            return;
          }
          if (
            !canCloseForProtectedProfit({
              side: payload.side,
              entryPrice: payload.entryPrice,
              markPrice: ticker.price,
              reason: "REVERSE_SIGNAL",
            })
          ) {
            return;
          }
          await logTradeEvent({
            positionId: payload.positionId,
            symbol: payload.symbol,
            eventType: "STOP_TRIGGERED",
            price: ticker.price,
            reason: "REVERSE_SIGNAL",
            newValue: {
              profitPercent: Number(currentProfitPercent.toFixed(4)),
              satTrigger: posReport.satTrigger,
            },
          });
          const closeResult = await payload.onClose({
            executionId: payload.executionId,
            positionId: payload.positionId,
            reason: "REVERSE_SIGNAL",
          });
          if (shouldStopMonitorAfterCloseAttempt(closeResult)) {
            stopPositionMonitor(payload.positionId);
            return;
          }
        }
      } catch {
        // position report is best-effort; never block monitor on failure
      }

      const smartExitState = payload.smartExit?.state;
      let effectiveTakeProfitPrice = payload.takeProfitPrice;
      if (
        payload.entryPrice &&
        payload.entryPrice > 0 &&
        payload.takeProfitPrice &&
        payload.takeProfitPrice > 0 &&
        smartExitState &&
        payload.onReadExitSignals
      ) {
        const signals = await payload.onReadExitSignals({
          positionId: payload.positionId,
          symbol: payload.symbol,
          side: payload.side,
          markPrice: ticker.price,
        }).catch(() => null);
        if (signals) {
          const smartExit = evaluateSmartExitEngine({
            side: payload.side,
            entryPrice: payload.entryPrice,
            markPrice: ticker.price,
            initialTp: payload.takeProfitPrice,
            state: smartExitState,
            shortMomentumPercent: signals.shortMomentumPercent,
            shortFlowImbalance: signals.shortFlowImbalance,
            shortCandleSignal: signals.shortCandleSignal,
            spreadPercent: signals.spreadPercent,
            volatilityPercent: signals.volatilityPercent,
            volume24h: signals.volume24h,
            marketRegime: signals.marketRegime,
            reverseSignal: signals.reverseSignal,
            isPumpTrade: payload.isPumpTrade,
          });
          effectiveTakeProfitPrice = smartExit.adaptiveTp;
          if (
            Number.isFinite(smartExit.adaptiveTp ?? NaN) &&
            Number.isFinite(lastAdaptiveTp ?? NaN) &&
            smartExit.adaptiveTp > Number(lastAdaptiveTp ?? 0)
          ) {
            const prevTp = lastAdaptiveTp;
            lastAdaptiveTp = smartExit.adaptiveTp;
            await logTradeEvent({
              positionId: payload.positionId,
              symbol: payload.symbol,
              eventType: "AI_TARGET_RAISED",
              price: ticker.price,
              oldValue: prevTp ? { targetSellPrice: prevTp } : null,
              newValue: { targetSellPrice: smartExit.adaptiveTp },
              reason: smartExit.exitSummary,
            });
          }
          publishExecutionEvent({
            executionId: payload.executionId,
            symbol: payload.symbol,
            stage: "smart-exit",
            status: "RUNNING",
            message: smartExit.exitSummary,
            level: "INFO",
            context: {
              positionId: payload.positionId,
              initialTp: smartExit.initialTp,
              adaptiveTp: smartExit.adaptiveTp,
              trailingSuggestion: smartExit.trailingSuggestion,
              earlyExitTrigger: smartExit.earlyExitTrigger,
              exitConfidence: smartExit.exitConfidence,
            },
          });
          if (smartExit.closeReason) {
            if (await shouldDeferPaperSoftExit(smartExit.closeReason, ticker.price, "smart-exit")) {
              return;
            }
            if (!canCloseForProtectedProfit({
              side: payload.side,
              entryPrice: payload.entryPrice,
              markPrice: ticker.price,
              reason: smartExit.closeReason,
            })) {
              return;
            }
            const closeResult = await payload.onClose({
              executionId: payload.executionId,
              positionId: payload.positionId,
              reason: smartExit.closeReason,
            });
            if (shouldStopMonitorAfterCloseAttempt(closeResult)) {
              stopPositionMonitor(payload.positionId);
              return;
            }
          }
        }
      }

      const tpSl = evaluateTakeProfitStopLoss(
        payload.side,
        ticker.price,
        effectiveTakeProfitPrice,
        dynamicStopLossPrice,
      );
      if (tpSl.shouldClose) {
        if (
          tpSl.reason === "TAKE_PROFIT" &&
          !canCloseForProtectedProfit({
            side: payload.side,
            entryPrice: payload.entryPrice,
            markPrice: ticker.price,
            reason: "EARLY_PROFIT_PROTECT",
          })
        ) {
          publishExecutionEvent({
            executionId: payload.executionId,
            symbol: payload.symbol,
            stage: "position-monitor",
            status: "RUNNING",
            message: "TP tetiklendi fakat net kar esigi altinda; pozisyon izlenmeye devam ediyor",
            level: "INFO",
            context: {
              positionId: payload.positionId,
              reason: "TAKE_PROFIT_NET_THRESHOLD",
              minimumNetProfitPercent: MINIMUM_NET_EXIT_PROFIT_PERCENT,
              minimumProtectedProfitPercent: resolveMinimumProtectedProfitPercent(),
            },
          });
          return;
        }
        if (tpSl.reason === "STOP_LOSS") {
          await logTradeEvent({
            positionId: payload.positionId,
            symbol: payload.symbol,
            eventType: "STOP_TRIGGERED",
            price: ticker.price,
            reason: tpSl.reason,
            newValue: {
              stopLossPrice: payload.stopLossPrice,
            },
          });
          await notifySystemEvent({
            userId: payload.userId,
            eventType: "STOP_TRIGGERED",
            title: "Stop tetiklendi",
            message: `${payload.symbol} stop-loss tetiklendi`,
            level: "WARN",
            symbol: payload.symbol,
          });
        }
        const closeResult = await payload.onClose({
          executionId: payload.executionId,
          positionId: payload.positionId,
          reason: tpSl.reason!,
        });
        if (shouldStopMonitorAfterCloseAttempt(closeResult)) {
          stopPositionMonitor(payload.positionId);
          return;
        }
        publishExecutionEvent({
          executionId: payload.executionId,
          symbol: payload.symbol,
          stage: "position-monitor",
          status: "RUNNING",
          message: "Kapatma denemesi basarisiz, monitor tekrar deneyecek",
          level: "WARN",
          context: {
            positionId: payload.positionId,
            reason: tpSl.reason!,
          },
        });
        return;
      }

      if (payload.onDynamicExit) {
        const dynamicReason = await payload.onDynamicExit({
          positionId: payload.positionId,
          symbol: payload.symbol,
          side: payload.side,
          markPrice: ticker.price,
        }).catch(() => null);
        if (dynamicReason) {
          if (await shouldDeferPaperSoftExit(dynamicReason, ticker.price, "dynamic-exit")) {
            return;
          }
          if (!canCloseForProtectedProfit({
            side: payload.side,
            entryPrice: payload.entryPrice,
            markPrice: ticker.price,
            reason: dynamicReason,
          })) {
            return;
          }
          const closeResult = await payload.onClose({
            executionId: payload.executionId,
            positionId: payload.positionId,
            reason: dynamicReason,
          });
          if (shouldStopMonitorAfterCloseAttempt(closeResult)) {
            stopPositionMonitor(payload.positionId);
            return;
          }
          publishExecutionEvent({
            executionId: payload.executionId,
            symbol: payload.symbol,
            stage: "position-monitor",
            status: "RUNNING",
            message: "Dinamik cikis kapatma denemesi basarisiz, yeniden denenecek",
            level: "WARN",
            context: {
              positionId: payload.positionId,
              reason: dynamicReason,
            },
          });
          return;
        }
      }

      // Early profit protection:
      // If target was almost reached and momentum turns down, lock profits instead of waiting full TP.
      if (payload.entryPrice && payload.entryPrice > 0 && payload.takeProfitPrice && payload.takeProfitPrice > 0) {
        const profitPercent =
          payload.side === "LONG"
            ? ((ticker.price - payload.entryPrice) / payload.entryPrice) * 100
            : ((payload.entryPrice - ticker.price) / payload.entryPrice) * 100;
        const targetProfitPercent =
          payload.side === "LONG"
            ? ((payload.takeProfitPrice - payload.entryPrice) / payload.entryPrice) * 100
            : ((payload.entryPrice - payload.takeProfitPrice) / payload.entryPrice) * 100;
        const trailingStartPercent = Number(payload.trailingStartPercent ?? NaN);
        const trailingGapPercent = Number(payload.trailingGapPercent ?? NaN);
        if (
          Number.isFinite(trailingStartPercent) &&
          Number.isFinite(trailingGapPercent) &&
          trailingStartPercent > 0 &&
          trailingGapPercent > 0 &&
          profitPercent >= trailingStartPercent
        ) {
          protectArmed = true;
          if (!trailingActivationLogged) {
            trailingActivationLogged = true;
            await logTradeEvent({
              positionId: payload.positionId,
              symbol: payload.symbol,
              eventType: "TRAILING_STOP_ACTIVE",
              price: ticker.price,
              newValue: {
                trailingStartPercent,
                trailingGapPercent,
                profitPercent: Number(profitPercent.toFixed(4)),
              },
              reason: "trailing-start",
            });
          }
          const candidateStopPercent = profitPercent - trailingGapPercent;
          if (candidateStopPercent > 0) {
            const candidateStopPrice =
              payload.side === "LONG"
                ? payload.entryPrice * (1 + candidateStopPercent / 100)
                : payload.entryPrice * (1 - candidateStopPercent / 100);
            const shouldUpdate =
              lastActiveStopPrice === null ||
              (payload.side === "LONG" ? candidateStopPrice > lastActiveStopPrice : candidateStopPrice < lastActiveStopPrice);
            if (shouldUpdate) {
              const previous = lastActiveStopPrice;
              lastActiveStopPrice = Number(candidateStopPrice.toFixed(6));
              dynamicStopLossPrice = lastActiveStopPrice;
              await logTradeEvent({
                positionId: payload.positionId,
                symbol: payload.symbol,
                eventType: "ACTIVE_STOP_UPDATED",
                price: ticker.price,
                oldValue: previous ? { activeStopPrice: previous } : null,
                newValue: { activeStopPrice: lastActiveStopPrice },
                reason: "trailing-gap-update",
              });
            }
          }
        }
        if (Number.isFinite(profitPercent) && Number.isFinite(targetProfitPercent) && targetProfitPercent > 0) {
          if (!breakevenArmed && profitPercent >= 2) {
            breakevenArmed = true;
            dynamicStopLossPrice = payload.entryPrice;
            await logTradeEvent({
              positionId: payload.positionId,
              symbol: payload.symbol,
              eventType: "BREAKEVEN_ARMED",
              price: ticker.price,
              newValue: {
                entryPrice: payload.entryPrice,
                profitPercent: Number(profitPercent.toFixed(4)),
              },
              reason: "profit>=2%",
            });
            publishExecutionEvent({
              executionId: payload.executionId,
              symbol: payload.symbol,
              stage: "position-monitor",
              status: "RUNNING",
              message: "Kar +%2 oldu: SL breakeven'a alindi.",
              level: "INFO",
              context: {
                positionId: payload.positionId,
                entryPrice: payload.entryPrice,
                profitPercent: Number(profitPercent.toFixed(4)),
              },
            });
          }
          if (!partial25Armed && profitPercent >= 3) {
            partial25Armed = true;
            publishExecutionEvent({
              executionId: payload.executionId,
              symbol: payload.symbol,
              stage: "position-monitor",
              status: "RUNNING",
              message: "Kar +%3: %25 partial TP sinyali.",
              level: "INFO",
              context: {
                positionId: payload.positionId,
                profitPercent: Number(profitPercent.toFixed(4)),
              },
            });
          }
          if (profitPercent >= 4) {
            protectArmed = true;
            const trailingGap = 0.4;
            const candidateStopPercent = Math.max(0.2, profitPercent - trailingGap);
            const candidateStopPrice =
              payload.side === "LONG"
                ? payload.entryPrice * (1 + candidateStopPercent / 100)
                : payload.entryPrice * (1 - candidateStopPercent / 100);
            const shouldUpdate =
              lastActiveStopPrice === null ||
              (payload.side === "LONG" ? candidateStopPrice > lastActiveStopPrice : candidateStopPrice < lastActiveStopPrice);
            if (shouldUpdate) {
              const previous = lastActiveStopPrice;
              lastActiveStopPrice = Number(candidateStopPrice.toFixed(6));
              dynamicStopLossPrice = lastActiveStopPrice;
              await logTradeEvent({
                positionId: payload.positionId,
                symbol: payload.symbol,
                eventType: "TRAILING_LOCK_ACTIVE",
                price: ticker.price,
                oldValue: previous ? { activeStopPrice: previous } : null,
                newValue: { activeStopPrice: lastActiveStopPrice },
                reason: "profit>=4% trailing lock",
              });
            }
          }
          if (!partial50Armed && profitPercent >= 5) {
            partial50Armed = true;
            publishExecutionEvent({
              executionId: payload.executionId,
              symbol: payload.symbol,
              stage: "position-monitor",
              status: "RUNNING",
              message: "Kar +%5: %50 partial TP sinyali + trailing aktif.",
              level: "INFO",
              context: {
                positionId: payload.positionId,
                profitPercent: Number(profitPercent.toFixed(4)),
              },
            });
          }
          peakProfitPercent = Math.max(peakProfitPercent, profitPercent);
          const nearTarget = targetProfitPercent * 0.95;
          const minProtectedProfitPercent = resolveMinimumProtectedProfitPercent();
          const floorProtect = Math.max(minProtectedProfitPercent, targetProfitPercent - 1);
          const partialPlan = payload.partialTpPlan;
          if (
            !firstTargetReached &&
            partialPlan?.enabled &&
            Number.isFinite(partialPlan.firstTargetPercent ?? NaN) &&
            profitPercent >= Number(partialPlan.firstTargetPercent)
          ) {
            firstTargetReached = true;
            protectArmed = true;
            if (!trailingActivationLogged) {
              trailingActivationLogged = true;
              await logTradeEvent({
                positionId: payload.positionId,
                symbol: payload.symbol,
                eventType: "TRAILING_STOP_ACTIVE",
                price: ticker.price,
                newValue: {
                  firstTargetPercent: Number(partialPlan.firstTargetPercent),
                  profitPercent: Number(profitPercent.toFixed(4)),
                },
                reason: "first-target-reached",
              });
            }
            publishExecutionEvent({
              executionId: payload.executionId,
              symbol: payload.symbol,
              stage: "position-monitor",
              status: "RUNNING",
              message: "Kademeli kar al: ilk hedef tetiklendi, trailing sikilasti",
              level: "INFO",
              context: {
                positionId: payload.positionId,
                firstTargetPercent: Number(partialPlan.firstTargetPercent),
                currentProfitPercent: Number(profitPercent.toFixed(4)),
              },
            });
          }
          if (profitPercent >= nearTarget) {
            protectArmed = true;
            if (!trailingActivationLogged) {
              trailingActivationLogged = true;
              await logTradeEvent({
                positionId: payload.positionId,
                symbol: payload.symbol,
                eventType: "TRAILING_STOP_ACTIVE",
                price: ticker.price,
                newValue: {
                  profitPercent: Number(profitPercent.toFixed(4)),
                  targetProfitPercent: Number(targetProfitPercent.toFixed(4)),
                },
                reason: "near-target",
              });
            }
          }
          const drawdownFromPeak = peakProfitPercent - profitPercent;
          if (protectArmed && payload.entryPrice && payload.entryPrice > 0) {
            const drawdownTrigger =
              payload.partialTpPlan?.enabled && Number.isFinite(payload.partialTpPlan.trailingDrawdownPercent ?? NaN)
                ? Number(payload.partialTpPlan.trailingDrawdownPercent)
                : env.EXECUTION_TRAILING_DRAWDOWN_PERCENT;
            const derivedStopPercent = Math.max(0, peakProfitPercent - drawdownTrigger);
            const derivedStopPrice =
              payload.side === "LONG"
                ? payload.entryPrice * (1 + derivedStopPercent / 100)
                : payload.entryPrice * (1 - derivedStopPercent / 100);
            if (!Number.isFinite(lastActiveStopPrice) || derivedStopPrice > Number(lastActiveStopPrice ?? 0)) {
              const previous = lastActiveStopPrice;
              lastActiveStopPrice = Number(derivedStopPrice.toFixed(6));
              await logTradeEvent({
                positionId: payload.positionId,
                symbol: payload.symbol,
                eventType: "ACTIVE_STOP_UPDATED",
                price: ticker.price,
                oldValue: previous ? { activeStopPrice: previous } : null,
                newValue: { activeStopPrice: lastActiveStopPrice },
                reason: "trail-updated",
              });
            }
          }
          if (
            protectArmed &&
            profitPercent >= minProtectedProfitPercent &&
            profitPercent <= floorProtect &&
            drawdownFromPeak >= 0.25
          ) {
            await logTradeEvent({
              positionId: payload.positionId,
              symbol: payload.symbol,
              eventType: "STOP_TRIGGERED",
              price: ticker.price,
              reason: "EARLY_PROFIT_PROTECT",
              newValue: {
                profitPercent: Number(profitPercent.toFixed(4)),
                peakProfitPercent: Number(peakProfitPercent.toFixed(4)),
              },
            });
            await notifySystemEvent({
              userId: payload.userId,
              eventType: "STOP_TRIGGERED",
              title: "Stop tetiklendi",
              message: `${payload.symbol} erken kar koruma stopu`,
              level: "WARN",
              symbol: payload.symbol,
            });
            const closeResult = await payload.onClose({
              executionId: payload.executionId,
              positionId: payload.positionId,
              reason: "EARLY_PROFIT_PROTECT",
            });
            if (shouldStopMonitorAfterCloseAttempt(closeResult)) {
              stopPositionMonitor(payload.positionId);
              return;
            }
            publishExecutionEvent({
              executionId: payload.executionId,
              symbol: payload.symbol,
              stage: "position-monitor",
              status: "RUNNING",
              message: "Erken kar koruma kapatma denemesi basarisiz, yeniden denenecek",
              level: "WARN",
              context: {
                positionId: payload.positionId,
                reason: "EARLY_PROFIT_PROTECT",
              },
            });
            return;
          }

          if (env.EXECUTION_TRAILING_LOCK_ENABLED) {
            const activation = env.EXECUTION_TRAILING_ACTIVATION_PERCENT;
            const minLockedProfit = env.EXECUTION_TRAILING_MIN_LOCKED_PROFIT_PERCENT;
            const drawdownTrigger =
              payload.partialTpPlan?.enabled && Number.isFinite(payload.partialTpPlan.trailingDrawdownPercent ?? NaN)
                ? Number(payload.partialTpPlan.trailingDrawdownPercent)
                : env.EXECUTION_TRAILING_DRAWDOWN_PERCENT;
            if (peakProfitPercent >= activation && profitPercent >= minLockedProfit) {
              const trailDrawdown = peakProfitPercent - profitPercent;
              if (trailDrawdown >= drawdownTrigger) {
                await logTradeEvent({
                  positionId: payload.positionId,
                  symbol: payload.symbol,
                  eventType: "STOP_TRIGGERED",
                  price: ticker.price,
                  reason: "TRAILING_PROFIT_LOCK",
                  newValue: {
                    peakProfitPercent: Number(peakProfitPercent.toFixed(4)),
                    currentProfitPercent: Number(profitPercent.toFixed(4)),
                    trailDrawdown: Number(trailDrawdown.toFixed(4)),
                  },
                });
                await notifySystemEvent({
                  userId: payload.userId,
                  eventType: "STOP_TRIGGERED",
                  title: "Trailing stop tetiklendi",
                  message: `${payload.symbol} trailing profit lock`,
                  level: "WARN",
                  symbol: payload.symbol,
                });
                const closeResult = await payload.onClose({
                  executionId: payload.executionId,
                  positionId: payload.positionId,
                  reason: "TRAILING_PROFIT_LOCK",
                });
                if (shouldStopMonitorAfterCloseAttempt(closeResult)) {
                  stopPositionMonitor(payload.positionId);
                  return;
                }
                publishExecutionEvent({
                  executionId: payload.executionId,
                  symbol: payload.symbol,
                  stage: "position-monitor",
                  status: "RUNNING",
                  message: "Trailing kar kilidi kapatma denemesi basarisiz, yeniden denenecek",
                  level: "WARN",
                  context: {
                    positionId: payload.positionId,
                    reason: "TRAILING_PROFIT_LOCK",
                    peakProfitPercent: Number(peakProfitPercent.toFixed(4)),
                    currentProfitPercent: Number(profitPercent.toFixed(4)),
                    trailDrawdown: Number(trailDrawdown.toFixed(4)),
                  },
                });
                return;
              }
            }
          }
        }
      }

      if (!variantDEnabled) {
        const timeoutHandled = await closeByTimeoutWithExtension(ticker.price);
        if (timeoutHandled) return;
      }
      if (Number.isFinite(openedAtMs)) {
        const elapsedSec = Math.max(0, Math.floor((Date.now() - openedAtMs) / 1000));
        if (elapsedSec >= 5400 && payload.entryPrice && payload.entryPrice > 0) {
          const flatProfit =
            payload.side === "LONG"
              ? ((ticker.price - payload.entryPrice) / payload.entryPrice) * 100
              : ((payload.entryPrice - ticker.price) / payload.entryPrice) * 100;
          if (Math.abs(flatProfit) < 0.35) {
            const closeResult = await payload.onClose({
              executionId: payload.executionId,
              positionId: payload.positionId,
              reason: "TIMEOUT",
            });
            if (shouldStopMonitorAfterCloseAttempt(closeResult)) {
              stopPositionMonitor(payload.positionId);
              return;
            }
            publishExecutionEvent({
              executionId: payload.executionId,
              symbol: payload.symbol,
              stage: "position-monitor",
              status: "RUNNING",
              message: "90 dk boyunca hareket yok: erken cikis denendi.",
              level: "WARN",
              context: {
                positionId: payload.positionId,
                elapsedSec,
                profitPercent: Number(flatProfit.toFixed(4)),
              },
            });
            return;
          }
        }
      }
    } catch (error) {
      publishExecutionEvent({
        executionId: payload.executionId,
        symbol: payload.symbol,
        stage: "position-monitor",
        status: "FAILED",
        message: `Monitor tick error: ${(error as Error).message}`,
        level: "ERROR",
      });
    } finally {
      busy.delete(payload.positionId);
    }
  };

  const interval = setInterval(tick, env.EXECUTION_MONITOR_INTERVAL_MS);
  monitors.set(payload.positionId, interval);

  publishExecutionEvent({
    executionId: payload.executionId,
    symbol: payload.symbol,
    stage: "position-monitor",
    status: "RUNNING",
    message: `${payload.symbol} monitor aktif`,
    level: "INFO",
    context: {
      positionId: payload.positionId,
      openedAt: payload.openedAt,
      takeProfitPrice: payload.takeProfitPrice,
      stopLossPrice: payload.stopLossPrice,
      entryPrice: payload.entryPrice,
      maxDurationSec: payload.maxDurationSec,
      extensionStepSec: payload.extensionStepSec,
      extensionMaxSec: payload.extensionMaxSec,
      partialTpPlan: payload.partialTpPlan,
    },
  });
}

export function stopPositionMonitor(positionId: string) {
  const current = monitors.get(positionId);
  if (!current) return;
  clearInterval(current);
  monitors.delete(positionId);
  busy.delete(positionId);
}

export function isPositionMonitorActive(positionId: string) {
  return monitors.has(positionId);
}

export function stopAllPositionMonitors() {
  for (const [positionId, timer] of monitors.entries()) {
    clearInterval(timer);
    monitors.delete(positionId);
    busy.delete(positionId);
  }
}
