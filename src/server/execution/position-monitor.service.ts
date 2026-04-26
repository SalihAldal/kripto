import { env } from "@/lib/config";
import { getTicker } from "@/services/binance.service";
import { publishExecutionEvent } from "@/src/server/execution/execution-event-bus";
import { evaluateTakeProfitStopLoss } from "@/src/server/execution/tp-sl-evaluator";
import { isExecutionTimedOut } from "@/src/server/execution/timeout-closer";
import type { PositionCloseReason } from "@/src/server/execution/types";
import { evaluateSmartExitEngine, type SmartExitEngineState } from "@/src/server/execution/smart-exit-engine.service";

type MonitorPayload = {
  executionId: string;
  positionId: string;
  symbol: string;
  side: "LONG" | "SHORT";
  openedAt: string;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  entryPrice?: number;
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
};

const monitors = new Map<string, NodeJS.Timeout>();
const busy = new Set<string>();

function shouldStopMonitorAfterCloseAttempt(result: { closed?: boolean } | void) {
  if (!result) return true;
  if (typeof result !== "object") return true;
  return result.closed !== false;
}

export function startPositionMonitor(payload: MonitorPayload) {
  stopPositionMonitor(payload.positionId);
  let dynamicMaxDurationSec = payload.maxDurationSec;
  let extendedSec = 0;
  let protectArmed = false;
  let firstTargetReached = false;
  let peakProfitPercent = Number.NEGATIVE_INFINITY;
  const tick = async () => {
    if (busy.has(payload.positionId)) return;
    busy.add(payload.positionId);
    try {
      const ticker = await getTicker(payload.symbol);
      await payload.onTick?.({ positionId: payload.positionId, markPrice: ticker.price });

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
          });
          effectiveTakeProfitPrice = smartExit.adaptiveTp;
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
        payload.stopLossPrice,
      );
      if (tpSl.shouldClose) {
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
        if (Number.isFinite(profitPercent) && Number.isFinite(targetProfitPercent) && targetProfitPercent > 0) {
          peakProfitPercent = Math.max(peakProfitPercent, profitPercent);
          const nearTarget = targetProfitPercent * 0.95;
          const floorProtect = Math.max(1, targetProfitPercent - 1);
          const partialPlan = payload.partialTpPlan;
          if (
            !firstTargetReached &&
            partialPlan?.enabled &&
            Number.isFinite(partialPlan.firstTargetPercent ?? NaN) &&
            profitPercent >= Number(partialPlan.firstTargetPercent)
          ) {
            firstTargetReached = true;
            protectArmed = true;
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
          }
          const drawdownFromPeak = peakProfitPercent - profitPercent;
          if (protectArmed && profitPercent <= floorProtect && drawdownFromPeak >= 0.25) {
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

      if (isExecutionTimedOut(payload.openedAt, dynamicMaxDurationSec)) {
        const canExtend =
          env.EXECUTION_TIMEOUT_EXTENSION_ENABLED &&
          Boolean(payload.onShouldExtend) &&
          (payload.extensionMaxSec ?? env.EXECUTION_TIMEOUT_EXTENSION_MAX_SEC) > extendedSec;
        if (canExtend) {
          const shouldExtend = await payload.onShouldExtend!({
            positionId: payload.positionId,
            symbol: payload.symbol,
            side: payload.side,
            markPrice: ticker.price,
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
                  markPrice: ticker.price,
                  openedAt: payload.openedAt,
                  maxDurationSec: dynamicMaxDurationSec,
                  extendedSec,
                },
              });
              return;
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
          return;
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
          },
        });
        return;
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
