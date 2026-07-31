import { NextRequest } from "next/server";
import type { AuditAction } from "@prisma/client";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getRequestLocale } from "@/lib/request-locale";
import { listAuditLogs } from "@/src/server/repositories/audit.repository";

const actionSet = new Set<AuditAction>(["CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "EXECUTE"]);

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    if (!checkApiToken(request)) {
      return Response.json({ ok: false, error: tr ? "Yetkisiz." : "Unauthorized." }, { status: 401 });
    }

    const rawAction = request.nextUrl.searchParams.get("action");
    const action =
      rawAction && actionSet.has(rawAction as AuditAction)
        ? (rawAction as AuditAction)
        : undefined;
    const entityType = request.nextUrl.searchParams.get("entityType") ?? undefined;
    const userId = request.nextUrl.searchParams.get("userId") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 200);
    const rows = await listAuditLogs({ action, entityType, userId, limit });
    return apiOkFromRequest(request, rows);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
