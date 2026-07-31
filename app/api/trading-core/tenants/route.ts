import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { tenantRuntimeManager, tenantSessions } from "@/src/server/trading-core/tenant";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const requestedUserId = request.nextUrl.searchParams.get("userId");
    const userId = access.user.role === "ADMIN" && requestedUserId ? requestedUserId : access.user.id;
    const ownSnapshot = await tenantRuntimeManager.snapshot(userId);
    return apiOkFromRequest(request, {
      current: ownSnapshot,
      sessions: access.user.role === "ADMIN" ? await tenantRuntimeManager.allSnapshots() : [ownSnapshot].filter(Boolean),
      rawSessions: access.user.role === "ADMIN" ? tenantSessions.all() : tenantSessions.get(userId) ? [tenantSessions.get(userId)] : [],
      isolation: {
        mode: "tenant-per-user",
        stateKey: "userId",
        portfolioIsolation: true,
        botStateIsolation: true,
        streamIsolation: true,
      },
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
