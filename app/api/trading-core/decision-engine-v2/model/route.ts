import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getActiveModel, getModelRegistry, getLatestModelMetrics } from "@/src/server/decision-engine-v2/decision-engine-v2.repository";
import { getCachedInferenceModelMeta } from "@/src/server/decision-engine-v2/decision-engine-v2.cache";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [active, registry, cache] = await Promise.all([
      getActiveModel(),
      getModelRegistry(),
      Promise.resolve(getCachedInferenceModelMeta()),
    ]);
    const metrics = active ? await getLatestModelMetrics(active.id) : [];
    return apiOkFromRequest(request, { active, registry, cache, metrics });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
