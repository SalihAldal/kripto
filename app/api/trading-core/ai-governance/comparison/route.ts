import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { compareModelScorecards, compareAllVersions } from "@/src/server/ai-governance/model-comparison.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const candidateId = request.nextUrl.searchParams.get("candidateVersionId");
    const productionId = request.nextUrl.searchParams.get("productionVersionId") ?? undefined;
    const registryId = request.nextUrl.searchParams.get("registryId");
    if (registryId) return apiOkFromRequest(request, await compareAllVersions(registryId));
    if (candidateId) return apiOkFromRequest(request, await compareModelScorecards(candidateId, productionId));
    return apiErrorFromUnknown(new Error("candidateVersionId or registryId required"));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
