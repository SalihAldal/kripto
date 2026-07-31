import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import {
  collectWorkerHeartbeatSnapshots,
  getHotPathWorkerBootResult,
} from "@/src/server/hot-path/worker-orchestrator.service";
import { getWorkerPolicySummary } from "@/src/server/hot-path/legacy-worker-freeze.service";
import { LEGACY_WORKER_REGISTRY } from "@/src/server/hot-path/hot-path.registry";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;

    const workers = collectWorkerHeartbeatSnapshots();
    const boot = getHotPathWorkerBootResult();

    return apiOkFromRequest(request, {
      policy: getWorkerPolicySummary(),
      registry: LEGACY_WORKER_REGISTRY,
      boot,
      workers,
      summary: {
        total: workers.length,
        enabled: workers.filter((w) => w.enabled).length,
        running: workers.filter((w) => w.running).length,
        frozen: workers.filter((w) => !w.enabled).length,
        criticalRunning: workers.filter((w) => w.tier === "CRITICAL" && w.running).length,
      },
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
