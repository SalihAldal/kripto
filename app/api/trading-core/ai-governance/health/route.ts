import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { monitorProductionHealth } from "@/src/server/ai-governance/production-health.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const snapshots = await prisma.governanceHealthSnapshot.findMany({ orderBy: { recordedAt: "desc" }, take: 50 });
    return apiOkFromRequest(request, snapshots);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = await request.json();
    return apiOkFromRequest(request, await monitorProductionHealth(body.deploymentId));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
