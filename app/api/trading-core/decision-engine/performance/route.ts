import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listExpertPerformance, listExpertRecommendations } from "@/src/server/decision-engine/decision-engine.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const mode = request.nextUrl.searchParams.get("mode") ?? "performance";
    if (mode === "recommendations") {
      const rows = await listExpertRecommendations(Number(request.nextUrl.searchParams.get("limit") ?? 20));
      return apiOkFromRequest(request, { rows, count: rows.length });
    }
    const expertType = request.nextUrl.searchParams.get("expertType") ?? undefined;
    const rows = await listExpertPerformance(expertType, Number(request.nextUrl.searchParams.get("limit") ?? 50));
    return apiOkFromRequest(request, { rows, count: rows.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
