import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import {
  listHotPathAuditSnapshots,
  runHotPathAudit,
} from "@/src/server/hot-path/hot-path-audit.service";
import { collectWorkerHeartbeatSnapshots } from "@/src/server/hot-path/worker-orchestrator.service";
import { HOT_PATH_STAGES } from "@/src/server/hot-path/hot-path.registry";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 20);
    const history = await listHotPathAuditSnapshots(Number.isFinite(limit) ? Math.min(limit, 100) : 20);

    return apiOkFromRequest(request, {
      stages: HOT_PATH_STAGES,
      history,
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;

    const workers = collectWorkerHeartbeatSnapshots();
    const audit = await runHotPathAudit(workers);

    return apiOkFromRequest(request, audit);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
