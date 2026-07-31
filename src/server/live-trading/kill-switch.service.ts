import { prisma } from "@/src/server/db/prisma";
import { activateKillSwitch as persistKillSwitch } from "@/src/server/live-trading/live-trading.repository";
import { triggerEmergencyStop } from "@/src/server/execution-safety/emergency-protection.service";
import { setEmergencyStopState } from "@/src/server/repositories/execution.repository";
import { dispatchLiveAlert } from "@/src/server/live-trading/alert-dispatcher.service";
import type { KillSwitchSource } from "@prisma/client";

export async function isKillSwitchActive(userId?: string) {
  const active = await prisma.killSwitchEvent.findFirst({
    where: { active: true, OR: [{ userId: null }, { userId }] },
    orderBy: { triggeredAt: "desc" },
  });
  return Boolean(active);
}

export async function activateKillSwitch(input: {
  userId?: string;
  source: KillSwitchSource;
  reason: string;
  triggeredBy?: string;
}) {
  await setEmergencyStopState(true, input.userId);
  await triggerEmergencyStop({
    scope: input.userId ? "USER" : "GLOBAL",
    userId: input.userId,
    reason: input.reason,
    actionType: "GLOBAL_KILL",
  }).catch(() => null);

  const event = await persistKillSwitch({
    userId: input.userId,
    source: input.source,
    reason: input.reason,
    triggeredBy: input.triggeredBy,
  });

  await dispatchLiveAlert({
    userId: input.userId,
    eventType: "KILL_SWITCH",
    severity: "CRITICAL",
    title: "Kill Switch Activated",
    message: `[${input.source}] ${input.reason}`,
  });

  return event;
}

export async function activateKillSwitchFromCircuitBreaker(userId: string | undefined, reason: string) {
  return activateKillSwitch({ userId, source: "CIRCUIT_BREAKER", reason, triggeredBy: "circuit-breaker" });
}

export async function releaseKillSwitch(eventId: string, userId?: string) {
  await setEmergencyStopState(false, userId);
  return prisma.killSwitchEvent.update({
    where: { id: eventId },
    data: { active: false, releasedAt: new Date() },
  });
}

export async function activateKillSwitchFromApi(userId: string, reason: string) {
  return activateKillSwitch({ userId, source: "API", reason, triggeredBy: "api" });
}

export async function activateKillSwitchFromDashboard(userId: string | undefined, reason: string, triggeredBy?: string) {
  return activateKillSwitch({ userId, source: "DASHBOARD", reason, triggeredBy });
}

export async function activateKillSwitchFromTelegram(userId: string | undefined, reason: string) {
  return activateKillSwitch({ userId, source: "TELEGRAM", reason, triggeredBy: "telegram" });
}

export async function monitorKillSwitchState() {
  const active = await prisma.killSwitchEvent.findMany({ where: { active: true }, orderBy: { triggeredAt: "desc" }, take: 10 });
  return { activeCount: active.length, events: active };
}
