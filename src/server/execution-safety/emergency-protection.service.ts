import { AppSettingScope, ConfigStatus, Prisma } from "@prisma/client";
import { prisma } from "@/src/server/db/prisma";
import { getEmergencyStopState, setEmergencyStopState } from "@/src/server/repositories/execution.repository";
import { getPausedState } from "@/src/server/repositories/risk.repository";
import type { EmergencyScope, EmergencyState, PreTradeSafetyInput, SafetyValidationStageResult } from "@/src/server/execution-safety/execution-safety.types";
import { persistEmergencyAction } from "@/src/server/execution-safety/execution-safety.repository";
import { emitExecutionSafetyEvent, SAFETY_EVENT } from "@/src/server/execution-safety/execution-safety.events";
import { getSafetyCache, setSafetyCache } from "@/src/server/execution-safety/safety-cache.service";

const EXCHANGE_KILL_KEY = "execution.safety.exchange_kill";
const SYMBOL_KILL_PREFIX = "execution.safety.symbol_kill.";

async function readKillSwitch(key: string) {
  const cached = getSafetyCache<{ enabled: boolean; reason?: string }>(`kill:${key}`);
  if (cached) return cached;
  const row = await prisma.appSetting.findUnique({ where: { key } });
  const value = (row?.value as { enabled?: boolean; reason?: string } | null) ?? { enabled: false };
  const state = { enabled: Boolean(value.enabled), reason: value.reason };
  setSafetyCache(`kill:${key}`, state, 10_000);
  return state;
}

async function writeKillSwitch(key: string, enabled: boolean, reason: string, userId?: string) {
  await prisma.appSetting.upsert({
    where: { key },
    create: {
      key,
      scope: userId ? AppSettingScope.USER : AppSettingScope.GLOBAL,
      userId,
      valueType: "json",
      status: ConfigStatus.ACTIVE,
      description: "Execution safety kill switch",
      value: { enabled, reason } as Prisma.InputJsonValue,
    },
    update: {
      value: { enabled, reason } as Prisma.InputJsonValue,
      status: ConfigStatus.ACTIVE,
    },
  });
  setSafetyCache(`kill:${key}`, { enabled, reason }, 10_000);
}

export async function getEmergencyState(userId: string, symbol?: string): Promise<EmergencyState> {
  const globalKillSwitch = await getEmergencyStopState(userId);
  const paused = await getPausedState(userId).catch(() => ({ paused: false, reason: undefined }));
  const exchange = await readKillSwitch(EXCHANGE_KILL_KEY);
  const symbolKill = symbol ? await readKillSwitch(`${SYMBOL_KILL_PREFIX}${symbol.toUpperCase()}`) : { enabled: false };
  return {
    globalKillSwitch,
    exchangeKillSwitch: exchange.enabled,
    symbolKillSwitch: symbolKill.enabled,
    autoPause: paused.paused,
    manualPause: paused.paused,
    reason: paused.reason ?? exchange.reason,
  };
}

export async function validateEmergencySafety(input: PreTradeSafetyInput): Promise<SafetyValidationStageResult> {
  const state = await getEmergencyState(input.userId, input.symbol);
  const reasons: string[] = [];
  if (state.globalKillSwitch) reasons.push("Global kill switch active");
  if (state.exchangeKillSwitch) reasons.push("Exchange kill switch active");
  if (state.symbolKillSwitch) reasons.push("Symbol kill switch active");
  if (state.autoPause || state.manualPause) reasons.push("Auto/manual pause active");
  return { stage: "SAFETY", passed: reasons.length === 0, reasons, metadata: state as unknown as Record<string, unknown> };
}

export async function triggerEmergencyStop(input: {
  scope: EmergencyScope;
  userId?: string;
  symbol?: string;
  reason: string;
  actionType?: "EMERGENCY_STOP" | "GLOBAL_KILL" | "EXCHANGE_KILL" | "SYMBOL_KILL" | "AUTO_PAUSE" | "MANUAL_PAUSE";
}) {
  if (input.scope === "GLOBAL" || input.scope === "USER") {
    await setEmergencyStopState(true, input.userId);
  }
  if (input.scope === "EXCHANGE") {
    await writeKillSwitch(EXCHANGE_KILL_KEY, true, input.reason, input.userId);
  }
  if (input.scope === "SYMBOL" && input.symbol) {
    await writeKillSwitch(`${SYMBOL_KILL_PREFIX}${input.symbol.toUpperCase()}`, true, input.reason, input.userId);
  }
  await persistEmergencyAction({
    scope: input.scope,
    userId: input.userId,
    symbol: input.symbol,
    actionType: input.actionType ?? "EMERGENCY_STOP",
    reason: input.reason,
    enabled: true,
  });
  emitExecutionSafetyEvent(SAFETY_EVENT.EMERGENCY, input);
}

export async function releaseEmergencyStop(input: {
  scope: EmergencyScope;
  userId?: string;
  symbol?: string;
  reason: string;
}) {
  if (input.scope === "GLOBAL" || input.scope === "USER") {
    await setEmergencyStopState(false, input.userId);
  }
  if (input.scope === "EXCHANGE") {
    await writeKillSwitch(EXCHANGE_KILL_KEY, false, input.reason, input.userId);
  }
  if (input.scope === "SYMBOL" && input.symbol) {
    await writeKillSwitch(`${SYMBOL_KILL_PREFIX}${input.symbol.toUpperCase()}`, false, input.reason, input.userId);
  }
  await persistEmergencyAction({
    scope: input.scope,
    userId: input.userId,
    symbol: input.symbol,
    actionType: "EMERGENCY_STOP",
    reason: input.reason,
    enabled: false,
  });
}

export async function listEmergencyActions(limit = 50) {
  return prisma.emergencyAction.findMany({ orderBy: { createdAt: "desc" }, take: limit });
}
