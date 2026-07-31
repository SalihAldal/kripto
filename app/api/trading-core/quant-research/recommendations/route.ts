import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { generateRecommendations, listRecommendations } from "@/src/server/quant-research/recommendation-engine.service";
import { getExperimentById, listResearchExperiments } from "@/src/server/quant-research/strategy-research-lab.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const experimentId = request.nextUrl.searchParams.get("experimentId");
    if (experimentId) {
      return apiOkFromRequest(request, await getExperimentById(experimentId));
    }
    const view = request.nextUrl.searchParams.get("view");
    if (view === "recommendations") {
      const status = request.nextUrl.searchParams.get("status") ?? "PENDING";
      return apiOkFromRequest(request, await listRecommendations(30, status));
    }
    return apiOkFromRequest(request, await listResearchExperiments(50));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as { experimentId?: string };
    return apiOkFromRequest(request, await generateRecommendations(body.experimentId));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
