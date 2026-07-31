import {
  persistRca,
  findSimilarIncidents,
  addIncidentTimeline,
} from "@/src/server/aoc/aoc.repository";
import { prisma } from "@/src/server/db/prisma";

export async function generateRootCauseAnalysis(incidentId: string) {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: { timeline: true },
  });
  if (!incident) throw new Error(`Incident not found: ${incidentId}`);

  const existing = await prisma.rootCauseAnalysis.findUnique({ where: { incidentId } });
  if (existing) return existing;

  const [platform, trading, exchange, infra, anomalies] = await Promise.all([
    prisma.platformHealth.findFirst({ orderBy: { recordedAt: "desc" } }),
    prisma.tradingHealth.findFirst({ orderBy: { recordedAt: "desc" } }),
    prisma.exchangeHealthHistory.findFirst({ orderBy: { recordedAt: "desc" } }),
    prisma.infrastructureHealth.findFirst({ orderBy: { recordedAt: "desc" } }),
    prisma.aocAnomaly.findMany({ where: { incidentId }, take: 5 }),
  ]);

  const evidence: Record<string, unknown> = {
    incident: { title: incident.title, severity: incident.severity },
    platform: platform ? { memoryMb: platform.memoryUsageMb, cpuPct: platform.cpuUsagePct, dbScore: platform.databaseScore } : null,
    trading: trading ? { rejectRate: trading.rejectRate, executionSuccess: trading.executionSuccessPct } : null,
    exchange: exchange ? { restHealthy: exchange.restHealthy, wsHealthy: exchange.wsHealthy, latencyMs: exchange.latencyMs } : null,
    infrastructure: infra ? { postgresHealthy: infra.postgresHealthy, redisHealthy: infra.redisHealthy } : null,
    anomalies: anomalies.map((a) => ({ type: a.anomalyType, description: a.description })),
  };

  const affectedModules = [...new Set([...incident.affectedModules, ...anomalies.map(() => "AOC")])];
  const recoverySuggestions: string[] = [];

  if (exchange && !exchange.restHealthy) recoverySuggestions.push("Reconnect exchange via exchange-abstraction RECONNECT job");
  if (infra && !infra.postgresHealthy) recoverySuggestions.push("Verify database connectivity and connection pool");
  if (trading && trading.rejectRate > 40) recoverySuggestions.push("Review reject reasons — no strategy modification");
  if (platform && (platform.memoryUsageMb ?? 0) > 500) recoverySuggestions.push("Monitor memory — consider worker restart");
  if (recoverySuggestions.length === 0) recoverySuggestions.push("Continue monitoring — no automatic recovery required");

  let probableCause = "Insufficient evidence — manual investigation recommended";
  if (anomalies.length > 0) probableCause = anomalies[0]!.description;
  else if (exchange && !exchange.wsHealthy) probableCause = "Exchange WebSocket disconnected";
  else if (infra && !infra.redisHealthy) probableCause = "Redis connectivity failure";

  const similar = await findSimilarIncidents(incident.title);

  const rca = await persistRca(incidentId, {
    probableCause,
    evidence,
    affectedModules,
    recoverySuggestions,
    similarIncidentIds: similar.map((s) => s.id),
    confidence: anomalies.length > 0 ? 75 : 45,
  });

  await addIncidentTimeline(incidentId, "RCA_GENERATED", probableCause);
  return rca;
}
