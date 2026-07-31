import { logger } from "@/lib/logger";
import { persistAlert, persistAuditLog } from "@/src/server/aoc/aoc.repository";
import { emitAocEvent, AOC_EVENT } from "@/src/server/aoc/aoc.events";
import type { AlertPayload } from "@/src/server/aoc/aoc.types";

async function deliverToChannel(alert: AlertPayload): Promise<boolean> {
  switch (alert.channel) {
    case "TELEGRAM":
    case "DISCORD":
    case "SLACK":
    case "EMAIL":
    case "WEBHOOK":
      logger.info({ channel: alert.channel, title: alert.title }, "AOC alert channel stub — future delivery");
      return false;
    default:
      return true;
  }
}

export async function dispatchAlert(alert: AlertPayload) {
  const delivered = await deliverToChannel(alert);
  const record = await persistAlert({ ...alert, delivered });
  await persistAuditLog("ALERT", alert.title, delivered, { severity: alert.severity, channel: alert.channel ?? "INTERNAL" });
  emitAocEvent(AOC_EVENT.ALERT_SENT, { alertKey: record.alertKey, severity: alert.severity });
  return record;
}

export async function processPendingAlerts() {
  const { prisma } = await import("@/src/server/db/prisma");
  const openIncidents = await prisma.incident.findMany({
    where: { status: { in: ["OPEN", "INVESTIGATING"] }, severity: { in: ["CRITICAL", "HIGH"] } },
    orderBy: { openedAt: "desc" },
    take: 5,
  });

  const sent = [];
  for (const incident of openIncidents) {
    const existing = await prisma.alertHistory.findFirst({
      where: { incidentId: incident.id, title: incident.title },
    });
    if (existing) continue;

    const alert = await dispatchAlert({
      severity: incident.severity === "CRITICAL" ? "CRITICAL" : "HIGH",
      channel: "INTERNAL",
      title: incident.title,
      message: incident.description,
      incidentId: incident.id,
    });
    sent.push(alert);
  }
  return { dispatched: sent.length, alerts: sent };
}
