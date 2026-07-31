import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { monitorInfrastructure } from "@/src/server/aoc/infrastructure-monitor.service";
import { monitorQueues } from "@/src/server/aoc/queue-monitor.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [latest, queueInfo, history] = await Promise.all([
      prisma.infrastructureHealth.findFirst({ orderBy: { recordedAt: "desc" } }),
      monitorQueues(),
      prisma.infrastructureHealth.findMany({ orderBy: { recordedAt: "desc" }, take: 20 }),
    ]);
    return apiOkFromRequest(request, { latest, queueInfo, history });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const snapshot = await monitorInfrastructure();
    return apiOkFromRequest(request, { snapshot });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
