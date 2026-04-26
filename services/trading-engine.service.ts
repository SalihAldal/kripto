import {
  cancelTradeOrderFlow,
  closePositionManually,
  disableEmergencyStop,
  emergencyStopTrading,
  ensureOpenPositionMonitors,
  executeAnalyzeAndTrade,
  getPositionSnapshot,
} from "@/src/server/execution/execution-orchestrator.service";
import {
  ensureAutoRoundRecovery,
  getAutoRoundStatus,
  startAutoRoundJob,
  stopAutoRoundJob,
} from "@/src/server/execution/auto-round-engine.service";
import { listExecutionEvents, listPersistedExecutionEvents } from "@/src/server/execution/execution-event-bus";
import { listTradeHistory } from "@/src/server/repositories/trade.repository";

export async function openTrade(input: {
  symbol?: string;
  quantity?: number;
  amountTry?: number;
  amountUsdt?: number;
  maxCoins?: number;
  leverage?: number;
  orderType?: "MARKET" | "LIMIT";
  limitPrice?: number;
  takeProfitPercent?: number;
  stopLossPercent?: number;
  maxDurationSec?: number;
}) {
  return executeAnalyzeAndTrade({
    requestedSymbol: input.symbol,
    requestedQuantity: input.quantity,
    requestedQuoteAmountTry: input.amountTry,
    requestedQuoteAmountUsdt: input.amountUsdt,
    requestedMaxCoins: input.maxCoins,
    leverageMultiplier: input.leverage,
    requestedOrderType: input.orderType,
    requestedLimitPrice: input.limitPrice,
    takeProfitPercent: input.takeProfitPercent,
    stopLossPercent: input.stopLossPercent,
    maxDurationSec: input.maxDurationSec,
  });
}

export async function closeTrade(positionId: string) {
  const result = await closePositionManually({ positionId, reason: "MANUAL_CLOSE" });
  if (!result || typeof result !== "object") return result;
  const typed = result as Record<string, unknown>;
  if (typed.closed === false) {
    const reason = String(typed.reason ?? "");
    // SELL-FLOW FIX: UI tarafina teknik olmayan, durum odakli mesajlar don.
    const userMessage =
      reason === "Pending close order exists"
        ? "Kapanis emri zaten gonderilmis, sonucu bekleniyor."
        : reason === "Close order pending fill"
          ? "Kapanis emri gonderildi, borsada dolmasi bekleniyor."
          : reason === "Close order failed"
            ? "Satis su an tamamlanamadi, sistem yeniden deneyecek."
            : "Pozisyon kapanisi simdilik tamamlanamadi.";
    return {
      ...typed,
      userMessage,
    };
  }
  return result;
}

export async function cancelTrade(orderId: string) {
  return cancelTradeOrderFlow({ orderId });
}

export async function emergencyStop(userId?: string) {
  return emergencyStopTrading(userId);
}

export async function resumeTrading(userId?: string) {
  return disableEmergencyStop(userId);
}

export async function getTradePosition(positionId: string) {
  return getPositionSnapshot(positionId);
}

export async function listTrades() {
  return listTradeHistory({ limit: 100 });
}

export function listTradeExecutionEvents(limit = 150) {
  return listExecutionEvents(limit);
}

export async function listTradeLifecycleEvents(input?: {
  limit?: number;
  executionId?: string;
  symbol?: string;
  orderId?: string;
}) {
  return listPersistedExecutionEvents(input);
}

export async function ensureTradeMonitors(userId?: string) {
  return ensureOpenPositionMonitors(userId);
}

export async function startTradeRoundJob(input: {
  userId?: string;
  totalRounds: number;
  budgetPerTrade: number;
  targetProfitPct: number;
  stopLossPct: number;
  maxWaitSec: number;
  coinSelectionMode: string;
  aiMode: string;
  allowRepeatCoin: boolean;
  mode: "manual" | "auto";
}) {
  return startAutoRoundJob(input);
}

export async function stopTradeRoundJob(userId?: string) {
  return stopAutoRoundJob(userId);
}

export async function getTradeRoundStatus(userId?: string) {
  return getAutoRoundStatus(userId);
}

export async function ensureTradeRoundRecovery() {
  return ensureAutoRoundRecovery();
}
