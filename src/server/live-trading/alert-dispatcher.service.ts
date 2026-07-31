import { env } from "@/lib/config";
import { notifySystemEvent } from "@/src/server/notifications/notification.service";
import { persistLiveAlert } from "@/src/server/live-trading/live-trading.repository";
import type { LiveAlertSeverity } from "@prisma/client";

export async function dispatchLiveAlert(input: {
  userId?: string;
  eventType: string;
  severity: LiveAlertSeverity;
  title: string;
  message: string;
  channels?: Array<"TELEGRAM" | "DISCORD" | "SLACK" | "WEBHOOK" | "EMAIL">;
}) {
  const channels = input.channels ?? ["TELEGRAM", "WEBHOOK", "EMAIL"];
  const results = [];

  for (const channel of channels) {
    const alert = await persistLiveAlert({
      userId: input.userId,
      channel,
      severity: input.severity,
      eventType: input.eventType,
      title: input.title,
      message: input.message,
    });

    let delivered = false;
    try {
      if (channel === "TELEGRAM" || channel === "EMAIL") {
        await notifySystemEvent({
          userId: input.userId,
          eventType: input.eventType === "TRADE_OPEN" ? "BUY" : input.eventType === "TRADE_CLOSE" ? "SELL" : input.eventType === "KILL_SWITCH" ? "EMERGENCY_STOP" : "AI_RISK",
          title: input.title,
          message: input.message,
          level: input.severity === "CRITICAL" || input.severity === "ERROR" ? "ERROR" : input.severity === "WARN" ? "WARN" : "INFO",
        });
        delivered = true;
      }
      if (channel === "DISCORD" && env.DISCORD_WEBHOOK_URL) {
        await fetch(env.DISCORD_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `**${input.title}**\n${input.message}` }),
        });
        delivered = true;
      }
      if (channel === "SLACK" && env.SLACK_WEBHOOK_URL) {
        await fetch(env.SLACK_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: `${input.title}: ${input.message}` }),
        });
        delivered = true;
      }
      if (channel === "WEBHOOK" && env.ALERT_WEBHOOK_URL) {
        await fetch(env.ALERT_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventType: input.eventType, title: input.title, message: input.message, severity: input.severity }),
        });
        delivered = true;
      }
    } catch {
      delivered = false;
    }

    if (delivered) {
      const { prisma } = await import("@/src/server/db/prisma");
      await prisma.liveAlert.update({
        where: { id: alert.id },
        data: { delivered: true, deliveredAt: new Date() },
      });
    }

    results.push({ channel, delivered, alertId: alert.id });
  }

  return results;
}

export async function dispatchPendingAlerts(limit = 50) {
  const { prisma } = await import("@/src/server/db/prisma");
  const pending = await prisma.liveAlert.findMany({
    where: { delivered: false },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  let dispatched = 0;
  for (const alert of pending) {
    await dispatchLiveAlert({
      userId: alert.userId ?? undefined,
      eventType: alert.eventType,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      channels: [alert.channel],
    });
    dispatched++;
  }

  return { dispatched, pending: pending.length };
}
