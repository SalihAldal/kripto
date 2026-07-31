import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listPromotionCandidates } from "@/src/server/learning-platform/promotion-candidate.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const candidates = await listPromotionCandidates(30);
    return apiOkFromRequest(request, { candidates });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
