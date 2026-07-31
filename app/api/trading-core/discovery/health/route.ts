import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getDiscoveryHealthSummary } from "@/src/server/discovery/discovery.repository";
import { getDiscoveryWorkerState } from "@/src/server/discovery/discovery-workers";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;

    const summary = await getDiscoveryHealthSummary();
    const worker = getDiscoveryWorkerState();
    return apiOkFromRequest(request, { summary, worker });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
