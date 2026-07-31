import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getPromotionStatus, evaluateModelPromotion, rollbackModelIfUnstable } from "@/src/server/decision-engine-v2/promotion.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const modelId = request.nextUrl.searchParams.get("modelId") ?? undefined;
    const status = await getPromotionStatus(modelId);
    return apiOkFromRequest(request, status);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = (await request.json().catch(() => ({}))) as { action?: string; modelId?: string };
    if (body.action === "rollback") {
      const rolled = await rollbackModelIfUnstable();
      return apiOkFromRequest(request, { rolled });
    }
    const result = await evaluateModelPromotion(body.modelId);
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
