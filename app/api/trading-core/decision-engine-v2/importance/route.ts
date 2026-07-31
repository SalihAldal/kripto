import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getActiveModel, getFeatureImportance } from "@/src/server/decision-engine-v2/decision-engine-v2.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const modelId = request.nextUrl.searchParams.get("modelId");
    const active = await getActiveModel();
    const targetId = modelId ?? active?.id;
    const importance = targetId ? await getFeatureImportance(targetId) : [];
    return apiOkFromRequest(request, { modelId: targetId, importance });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
