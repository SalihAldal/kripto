import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { searchResearchKnowledge } from "@/src/server/quant-research/knowledge-repository.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const q = request.nextUrl.searchParams.get("q") ?? "";
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    return apiOkFromRequest(request, await searchResearchKnowledge(q, Number.isFinite(limit) ? limit : 30));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
