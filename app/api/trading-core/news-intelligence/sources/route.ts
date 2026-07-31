import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listSourceRankings } from "@/src/server/news-intelligence/news-intelligence.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    const rankings = await listSourceRankings(limit);
    return apiOkFromRequest(request, { rankings, count: rankings.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
