import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { searchKnowledge, listPatternExplorer } from "@/src/server/learning-engine/learning-engine.repository";
import { similaritySearch, historicalLookup, patternSearch } from "@/src/server/learning-engine/knowledge-base.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const q = request.nextUrl.searchParams.get("q") ?? "";
    const refId = request.nextUrl.searchParams.get("refId");
    const patternKey = request.nextUrl.searchParams.get("patternKey");
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);

    if (refId) {
      return apiOkFromRequest(request, await historicalLookup(refId));
    }
    if (patternKey) {
      return apiOkFromRequest(request, await patternSearch(patternKey, Number.isFinite(limit) ? limit : 30));
    }
    if (q.trim()) {
      return apiOkFromRequest(request, await similaritySearch(q, Number.isFinite(limit) ? limit : 30));
    }
    return apiOkFromRequest(request, {
      knowledge: await searchKnowledge("", Number.isFinite(limit) ? limit : 30),
      patterns: await listPatternExplorer(Number.isFinite(limit) ? limit : 100),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
