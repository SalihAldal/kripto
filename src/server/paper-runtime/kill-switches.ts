import type { HealthSnapshot, KillSwitch } from "@/src/server/paper-runtime/types";
import type { PaperRuntimeConfig } from "@/src/server/paper-runtime/config";

export function evaluateKillSwitches(input: {
  health: HealthSnapshot;
  config: PaperRuntimeConfig;
  dailyLossPercent: number;
  drawdownPercent: number;
  consecutiveLosses: number;
  now: number;
  wsRecoveredAt?: number | null;
}): { allowEntry: boolean; codes: KillSwitch[] } {
  const codes: KillSwitch[] = [];
  if (input.health.dataAgeMs > input.config.staleDataMaxAgeMs) codes.push("STALE_DATA");
  if (input.health.wsStatus !== "UP") codes.push("WS_DEGRADED");
  if (input.wsRecoveredAt && input.now - input.wsRecoveredAt < input.config.wsStabilizationMs) codes.push("WS_DEGRADED");
  if (!input.health.redisOk) codes.push("REDIS_DOWN");
  if (!input.health.dbOk) codes.push("DB_DOWN");
  if (input.health.btcReturn1m <= input.config.btcShockPct) codes.push("BTC_SHOCK");
  if (input.dailyLossPercent >= input.config.maxDailyLossPercent) codes.push("DAILY_LOSS");
  if (input.drawdownPercent >= input.config.maxDrawdownPercent) codes.push("DRAWDOWN");
  if (input.consecutiveLosses >= input.config.consecutiveLossCooldown) codes.push("CONSECUTIVE_LOSS");
  if (input.health.rateLimit429) codes.push("RATE_LIMIT_429");
  if (input.health.ipBan418) codes.push("IP_BAN_418");
  return { allowEntry: codes.length === 0, codes };
}
