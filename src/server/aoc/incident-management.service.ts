import {
  createIncident,
  updateIncident,
  addIncidentTimeline,
  persistAuditLog,
} from "@/src/server/aoc/aoc.repository";
import { emitAocEvent, AOC_EVENT } from "@/src/server/aoc/aoc.events";
import { generateRootCauseAnalysis } from "@/src/server/aoc/root-cause-analysis.service";
import type { IncidentSeverity, IncidentStatus } from "@prisma/client";

export async function openIncident(input: {
  title: string;
  description: string;
  severity: IncidentSeverity;
  affectedModules: string[];
}) {
  const incident = await createIncident(input);
  await addIncidentTimeline(incident.id, "OPENED", input.description);
  await persistAuditLog("INCIDENT_OPEN", incident.incidentKey, true, { severity: input.severity });
  emitAocEvent(AOC_EVENT.INCIDENT_OPENED, { incidentId: incident.id, incidentKey: incident.incidentKey });
  return incident;
}

export async function resolveIncident(incidentId: string, resolution: string, postMortem?: string) {
  const incident = await updateIncident(incidentId, { status: "RESOLVED", resolution, postMortem });
  await addIncidentTimeline(incidentId, "RESOLVED", resolution);
  await generateRootCauseAnalysis(incidentId);
  await persistAuditLog("INCIDENT_RESOLVE", incident.incidentKey, true, { resolution });
  emitAocEvent(AOC_EVENT.INCIDENT_RESOLVED, { incidentId, incidentKey: incident.incidentKey });
  return incident;
}

export async function processOpenIncidents() {
  const { prisma } = await import("@/src/server/db/prisma");
  const open = await prisma.incident.findMany({
    where: { status: { in: ["OPEN", "INVESTIGATING"] } },
    orderBy: { openedAt: "asc" },
    take: 10,
  });

  for (const incident of open) {
    if (incident.status === "OPEN") {
      await updateIncident(incident.id, { status: "INVESTIGATING" });
      await addIncidentTimeline(incident.id, "INVESTIGATING", "Automated investigation started");
      await generateRootCauseAnalysis(incident.id);
    }
  }

  return { processed: open.length };
}

export async function updateIncidentStatus(incidentId: string, status: IncidentStatus, note?: string) {
  const incident = await updateIncident(incidentId, { status });
  if (note) await addIncidentTimeline(incidentId, status, note);
  return incident;
}
