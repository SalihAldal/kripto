import { prisma } from "@/src/server/db/prisma";
import { persistOperationalTimeline } from "@/src/server/aoc/aoc.repository";

export async function generateOperationalTimeline(timelineType = "DAILY") {
  const since = new Date(Date.now() - 24 * 3600_000);

  const [incidents, recoveries, anomalies, healthScores, alerts] = await Promise.all([
    prisma.incident.findMany({ where: { openedAt: { gte: since } }, orderBy: { openedAt: "asc" } }),
    prisma.recoveryHistory.findMany({ where: { executedAt: { gte: since } }, orderBy: { executedAt: "asc" } }),
    prisma.aocAnomaly.findMany({ where: { detectedAt: { gte: since } }, orderBy: { detectedAt: "asc" } }),
    prisma.healthScore.findMany({ where: { calculatedAt: { gte: since } }, orderBy: { calculatedAt: "asc" } }),
    prisma.alertHistory.findMany({ where: { sentAt: { gte: since } }, orderBy: { sentAt: "asc" } }),
  ]);

  type Entry = { at: string; type: string; title: string; details?: Record<string, unknown> };
  const entries: Entry[] = [];

  for (const i of incidents) entries.push({ at: i.openedAt.toISOString(), type: "INCIDENT", title: i.title, details: { severity: i.severity, status: i.status } });
  for (const r of recoveries) entries.push({ at: r.executedAt.toISOString(), type: "RECOVERY", title: r.actionType, details: { target: r.target, success: r.success } });
  for (const a of anomalies) entries.push({ at: a.detectedAt.toISOString(), type: "ANOMALY", title: a.anomalyType, details: { description: a.description } });
  for (const h of healthScores) entries.push({ at: h.calculatedAt.toISOString(), type: "HEALTH_SCORE", title: `Platform ${h.platformScore}`, details: { platformScore: h.platformScore } });
  for (const al of alerts) entries.push({ at: al.sentAt.toISOString(), type: "ALERT", title: al.title, details: { severity: al.severity } });

  entries.sort((a, b) => a.at.localeCompare(b.at));

  return persistOperationalTimeline(timelineType, `${timelineType} operational timeline`, entries);
}

export async function replayTimeline(from: Date, to: Date) {
  const [incidents, recoveries] = await Promise.all([
    prisma.incident.findMany({ where: { openedAt: { gte: from, lte: to } }, include: { timeline: true, rca: true } }),
    prisma.recoveryHistory.findMany({ where: { executedAt: { gte: from, lte: to } } }),
  ]);
  return { incidents, recoveries, from: from.toISOString(), to: to.toISOString() };
}
