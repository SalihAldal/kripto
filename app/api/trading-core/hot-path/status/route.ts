import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getHotPathStatusPayload } from "@/src/server/hot-path/worker-orchestrator.service";
import { getLatestHotPathAuditSnapshot } from "@/src/server/hot-path/hot-path-audit.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;

    const [status, latestAudit] = await Promise.all([
      Promise.resolve(getHotPathStatusPayload()),
      getLatestHotPathAuditSnapshot(),
    ]);

    return apiOkFromRequest(request, {
      ...status,
      latestAudit,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
