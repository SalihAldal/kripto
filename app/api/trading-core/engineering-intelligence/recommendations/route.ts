import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listOpenRecommendations } from "@/src/server/engineering-intelligence/engineering-intelligence.repository";
import { generateRefactoringAdvice } from "@/src/server/engineering-intelligence/engineering-health.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 50);
    const [recommendations, advice] = await Promise.all([
      listOpenRecommendations(limit),
      generateRefactoringAdvice(limit),
    ]);
    return apiOkFromRequest(request, { recommendations, advice, count: recommendations.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
