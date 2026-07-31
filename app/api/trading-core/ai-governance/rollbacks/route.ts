import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import { checkAutomaticRollback } from "@/src/server/ai-governance/automatic-rollback.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const rollbacks = await prisma.rollbackHistory.findMany({ orderBy: { rolledBackAt: "desc" }, take: Number.isFinite(limit) ? limit : 50 });
    return apiOkFromRequest(request, rollbacks);
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
    return apiOkFromRequest(request, await checkAutomaticRollback(body.deploymentId));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
