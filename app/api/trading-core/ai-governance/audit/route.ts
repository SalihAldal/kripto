import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listAuditLog, syncAuditIntegrity } from "@/src/server/ai-governance/audit-system.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
    const entityType = request.nextUrl.searchParams.get("entityType") ?? undefined;
    return apiOkFromRequest(request, await listAuditLog(Number.isFinite(limit) ? limit : 100, entityType));
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
    return apiOkFromRequest(request, await syncAuditIntegrity(body.limit ?? 500));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
