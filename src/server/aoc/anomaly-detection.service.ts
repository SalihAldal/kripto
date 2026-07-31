import { prisma } from "@/src/server/db/prisma";
import { persistAnomaly, createIncident, addIncidentTimeline } from "@/src/server/aoc/aoc.repository";
import { emitAocEvent, AOC_EVENT } from "@/src/server/aoc/aoc.events";
import type { AnomalyType, IncidentSeverity } from "@prisma/client";

type AnomalyCandidate = {
  anomalyType: AnomalyType;
  severity: IncidentSeverity;
  description: string;
  evidence: Record<string, unknown>;
  openIncident?: boolean;
};

export async function detectAnomalies() {
  const candidates: AnomalyCandidate[] = [];

  const [platformLatest, platformPrev, tradingLatest, infraLatest, exchangeLatest, queueInfo] = await Promise.all([
    prisma.platformHealth.findFirst({ orderBy: { recordedAt: "desc" } }),
    prisma.platformHealth.findFirst({ orderBy: { recordedAt: "desc" }, skip: 1 }),
    prisma.tradingHealth.findFirst({ orderBy: { recordedAt: "desc" } }),
    prisma.infrastructureHealth.findFirst({ orderBy: { recordedAt: "desc" } }),
    prisma.exchangeHealthHistory.findFirst({ orderBy: { recordedAt: "desc" } }),
    import("@/src/server/aoc/queue-monitor.service").then((m) => m.monitorQueues()),
  ]);

  if (platformLatest && platformPrev) {
    const memDelta = (platformLatest.memoryUsageMb ?? 0) - (platformPrev.memoryUsageMb ?? 0);
    if (memDelta > 50) {
      candidates.push({
        anomalyType: "MEMORY_LEAK",
        severity: "HIGH",
        description: `Memory increased ${memDelta.toFixed(0)}MB between snapshots`,
        evidence: { current: platformLatest.memoryUsageMb, previous: platformPrev.memoryUsageMb },
        openIncident: true,
      });
    }
  }

  if (platformLatest && (platformLatest.cpuUsagePct ?? 0) > 85) {
    candidates.push({
      anomalyType: "CPU_SPIKE",
      severity: "HIGH",
      description: `CPU usage at ${platformLatest.cpuUsagePct}%`,
      evidence: { cpuUsagePct: platformLatest.cpuUsagePct },
      openIncident: true,
    });
  }

  if (queueInfo.staleQueues > 2) {
    candidates.push({
      anomalyType: "QUEUE_EXPLOSION",
      severity: "CRITICAL",
      description: `${queueInfo.staleQueues} stale queues detected`,
      evidence: queueInfo,
      openIncident: true,
    });
  }

  if (tradingLatest && tradingLatest.tradeRate < 0.01 && tradingLatest.decisionRate > 1) {
    candidates.push({
      anomalyType: "TRADE_DROP",
      severity: "HIGH",
      description: "High decision rate with near-zero trade rate",
      evidence: { decisionRate: tradingLatest.decisionRate, tradeRate: tradingLatest.tradeRate },
    });
  }

  if (tradingLatest && tradingLatest.rejectRate > 50) {
    candidates.push({
      anomalyType: "REJECT_SPIKE",
      severity: "MEDIUM",
      description: `Reject rate elevated at ${tradingLatest.rejectRate}%`,
      evidence: { rejectRate: tradingLatest.rejectRate },
    });
  }

  if (tradingLatest && tradingLatest.scannerScore < 50) {
    candidates.push({
      anomalyType: "SCANNER_FAILURE",
      severity: "HIGH",
      description: `Scanner health score ${tradingLatest.scannerScore}`,
      evidence: { scannerScore: tradingLatest.scannerScore },
      openIncident: true,
    });
  }

  if (infraLatest && !infraLatest.postgresHealthy) {
    candidates.push({
      anomalyType: "API_DEGRADATION",
      severity: "CRITICAL",
      description: "Database connectivity degraded",
      evidence: { postgresHealthy: infraLatest.postgresHealthy },
      openIncident: true,
    });
  }

  if (exchangeLatest && (!exchangeLatest.restHealthy || !exchangeLatest.wsHealthy)) {
    candidates.push({
      anomalyType: "API_DEGRADATION",
      severity: "HIGH",
      description: "Exchange connectivity degraded",
      evidence: { restHealthy: exchangeLatest.restHealthy, wsHealthy: exchangeLatest.wsHealthy },
      openIncident: true,
    });
  }

  const results = [];
  for (const c of candidates) {
    let incidentId: string | undefined;
    if (c.openIncident) {
      const incident = await createIncident({
        title: c.anomalyType.replace(/_/g, " "),
        description: c.description,
        severity: c.severity,
        affectedModules: ["AOC"],
      });
      incidentId = incident.id;
      await addIncidentTimeline(incident.id, "ANOMALY_DETECTED", c.description);
      emitAocEvent(AOC_EVENT.INCIDENT_OPENED, { incidentId: incident.id, anomalyType: c.anomalyType });
    }
    const anomaly = await persistAnomaly(c.anomalyType, c.description, c.severity, c.evidence, incidentId);
    emitAocEvent(AOC_EVENT.ANOMALY_DETECTED, { anomalyKey: anomaly.anomalyKey, anomalyType: c.anomalyType });
    results.push(anomaly);
  }

  return { detected: results.length, anomalies: results };
}
