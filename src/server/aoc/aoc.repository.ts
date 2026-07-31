import { createHash } from "node:crypto";
import { prisma } from "@/src/server/db/prisma";
import type { Prisma } from "@prisma/client";
import type { AlertPayload } from "@/src/server/aoc/aoc.types";
import type {
  AlertChannel,
  AlertSeverity,
  AnomalyType,
  IncidentSeverity,
  IncidentStatus,
  RecoveryActionType,
} from "@prisma/client";

function key(prefix: string) {
  return `${prefix}_${createHash("sha256").update(`${prefix}_${Date.now()}_${Math.random()}`).digest("hex").slice(0, 16)}`;
}

export async function persistPlatformHealth(data: Record<string, unknown>) {
  return prisma.platformHealth.create({ data: { snapshotKey: key("ph"), ...data } as never });
}

export async function persistInfrastructureHealth(data: Record<string, unknown>) {
  return prisma.infrastructureHealth.create({ data: { snapshotKey: key("ih"), ...data } as never });
}

export async function persistTradingHealth(data: Record<string, unknown>) {
  return prisma.tradingHealth.create({ data: { snapshotKey: key("th"), ...data } as never });
}

export async function persistExchangeHealthHistory(data: Record<string, unknown>) {
  return prisma.exchangeHealthHistory.create({ data: { snapshotKey: key("eh"), ...data } as never });
}

export async function persistHealthScore(data: Record<string, number>) {
  return prisma.healthScore.create({ data: { scoreKey: key("hs"), ...data } });
}

export async function persistBusinessKpi(data: Record<string, unknown>) {
  return prisma.aocBusinessKpi.create({ data: { snapshotKey: key("kpi"), ...data } as never });
}

export async function persistAiHealth(data: Record<string, unknown>) {
  return prisma.aocAiHealth.create({ data: { snapshotKey: key("ai"), ...data } as never });
}

export async function createIncident(input: {
  title: string;
  description: string;
  severity: IncidentSeverity;
  affectedModules: string[];
}) {
  return prisma.incident.create({
    data: { incidentKey: key("inc"), status: "OPEN", ...input },
  });
}

export async function updateIncident(incidentId: string, data: Partial<{ status: IncidentStatus; rootCause: string; resolution: string; postMortem: string }>) {
  return prisma.incident.update({
    where: { id: incidentId },
    data: { ...data, resolvedAt: data.status === "RESOLVED" || data.status === "CLOSED" ? new Date() : undefined },
  });
}

export async function addIncidentTimeline(incidentId: string, eventType: string, description: string, actor = "AOC") {
  return prisma.incidentTimeline.create({
    data: { timelineKey: key("itl"), incidentId, eventType, description, actor },
  });
}

export async function persistRecovery(actionType: RecoveryActionType, target: string, success: boolean, incidentId?: string, errorMessage?: string) {
  return prisma.recoveryHistory.create({
    data: { recoveryKey: key("rcv"), actionType, target, success, incidentId, errorMessage },
  });
}

export async function persistAlert(alert: AlertPayload & { delivered?: boolean }) {
  return prisma.alertHistory.create({
    data: {
      alertKey: key("alt"),
      severity: alert.severity,
      channel: alert.channel ?? "INTERNAL",
      title: alert.title,
      message: alert.message,
      incidentId: alert.incidentId,
      delivered: alert.delivered ?? false,
    },
  });
}

export async function persistRca(incidentId: string, input: {
  probableCause: string;
  evidence: Record<string, unknown>;
  affectedModules: string[];
  recoverySuggestions: string[];
  similarIncidentIds?: string[];
  confidence?: number;
}) {
  return prisma.rootCauseAnalysis.create({
    data: {
      rcaKey: key("rca"),
      incidentId,
      probableCause: input.probableCause,
      evidence: input.evidence as Prisma.InputJsonValue,
      affectedModules: input.affectedModules,
      recoverySuggestions: input.recoverySuggestions,
      similarIncidentIds: input.similarIncidentIds ?? [],
      confidence: input.confidence ?? 50,
    },
  });
}

export async function persistAnomaly(anomalyType: AnomalyType, description: string, severity: IncidentSeverity, evidence?: Record<string, unknown>, incidentId?: string) {
  return prisma.aocAnomaly.create({
    data: { anomalyKey: key("an"), anomalyType, description, severity, evidence: evidence as Prisma.InputJsonValue, incidentId },
  });
}

export async function persistAuditLog(actionType: string, target: string, success: boolean, details?: Record<string, unknown>, actor = "AOC") {
  return prisma.aocAuditLog.create({
    data: { auditKey: key("aud"), actionType, target, success, details: details as Prisma.InputJsonValue, actor },
  });
}

export async function persistServiceDependency(nodes: Record<string, unknown>[], edges: Record<string, unknown>[], criticalPath?: Record<string, unknown>[]) {
  return prisma.aocServiceDependency.create({
    data: { graphKey: key("dep"), nodes: nodes as Prisma.InputJsonValue, edges: edges as Prisma.InputJsonValue, criticalPath: criticalPath as Prisma.InputJsonValue },
  });
}

export async function persistOperationalTimeline(timelineType: string, title: string, entries: Record<string, unknown>[]) {
  return prisma.aocOperationalTimeline.create({
    data: { timelineKey: key("otl"), timelineType, title, entries: entries as Prisma.InputJsonValue, entryCount: entries.length },
  });
}

export async function getAocDashboard() {
  const [platform, infrastructure, trading, exchange, scores, incidents, alerts, recoveries, anomalies, audit, kpis, aiHealth, dependency, timelines] = await Promise.all([
    prisma.platformHealth.findMany({ orderBy: { recordedAt: "desc" }, take: 10 }),
    prisma.infrastructureHealth.findMany({ orderBy: { recordedAt: "desc" }, take: 10 }),
    prisma.tradingHealth.findMany({ orderBy: { recordedAt: "desc" }, take: 10 }),
    prisma.exchangeHealthHistory.findMany({ orderBy: { recordedAt: "desc" }, take: 10 }),
    prisma.healthScore.findMany({ orderBy: { calculatedAt: "desc" }, take: 10 }),
    prisma.incident.findMany({ orderBy: { openedAt: "desc" }, take: 20, include: { timeline: { take: 5 }, rca: true } }),
    prisma.alertHistory.findMany({ orderBy: { sentAt: "desc" }, take: 30 }),
    prisma.recoveryHistory.findMany({ orderBy: { executedAt: "desc" }, take: 20 }),
    prisma.aocAnomaly.findMany({ where: { resolved: false }, orderBy: { detectedAt: "desc" }, take: 20 }),
    prisma.aocAuditLog.findMany({ orderBy: { recordedAt: "desc" }, take: 50 }),
    prisma.aocBusinessKpi.findMany({ orderBy: { recordedAt: "desc" }, take: 10 }),
    prisma.aocAiHealth.findMany({ orderBy: { recordedAt: "desc" }, take: 10 }),
    prisma.aocServiceDependency.findFirst({ orderBy: { builtAt: "desc" } }),
    prisma.aocOperationalTimeline.findMany({ orderBy: { generatedAt: "desc" }, take: 10 }),
  ]);
  return { platform, infrastructure, trading, exchange, scores, incidents, alerts, recoveries, anomalies, audit, kpis, aiHealth, dependency, timelines };
}

export async function listIncidents(status?: IncidentStatus, limit = 30) {
  return prisma.incident.findMany({
    where: status ? { status } : undefined,
    orderBy: { openedAt: "desc" },
    take: limit,
    include: { timeline: true, rca: true, recovery: true },
  });
}

export async function listAlerts(limit = 50) {
  return prisma.alertHistory.findMany({ orderBy: { sentAt: "desc" }, take: limit });
}

export async function getLatestHealthScores() {
  return prisma.healthScore.findFirst({ orderBy: { calculatedAt: "desc" } });
}

export async function findSimilarIncidents(title: string, limit = 5) {
  return prisma.incident.findMany({
    where: { title: { contains: title.split(" ")[0], mode: "insensitive" } },
    orderBy: { openedAt: "desc" },
    take: limit,
    select: { id: true, incidentKey: true, title: true },
  });
}
