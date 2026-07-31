import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listIncidents } from "@/src/server/aoc/aoc.repository";
import { resolveIncident, openIncident } from "@/src/server/aoc/incident-management.service";
import type { IncidentSeverity, IncidentStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const status = request.nextUrl.searchParams.get("status") as IncidentStatus | null;
    const incidents = await listIncidents(status ?? undefined);
    return apiOkFromRequest(request, { incidents });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = await request.json() as {
      action?: "open" | "resolve";
      title?: string;
      description?: string;
      severity?: IncidentSeverity;
      affectedModules?: string[];
      incidentId?: string;
      resolution?: string;
      postMortem?: string;
    };

    if (body.action === "resolve" && body.incidentId && body.resolution) {
      const incident = await resolveIncident(body.incidentId, body.resolution, body.postMortem);
      return apiOkFromRequest(request, { incident });
    }

    if (body.title && body.description) {
      const incident = await openIncident({
        title: body.title,
        description: body.description,
        severity: body.severity ?? "MEDIUM",
        affectedModules: body.affectedModules ?? ["AOC"],
      });
      return apiOkFromRequest(request, { incident });
    }

    return apiErrorFromUnknown(new Error("Invalid incident request"));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
