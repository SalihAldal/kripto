import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getModelRegistryDashboard } from "@/src/server/decision-engine-v2/model-registry.service";
import { listMLModels } from "@/src/server/decision-engine-v2/decision-engine-v2.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [registry, models] = await Promise.all([getModelRegistryDashboard(), listMLModels(20)]);
    return apiOkFromRequest(request, { registry, models });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
