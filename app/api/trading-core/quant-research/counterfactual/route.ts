import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getCounterfactualSummary, runCounterfactualAnalysis } from "@/src/server/quant-research/counterfactual-analysis.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const experimentId = request.nextUrl.searchParams.get("experimentId") ?? undefined;
    return apiOkFromRequest(request, await getCounterfactualSummary(experimentId));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as { experimentId?: string; limit?: number; windowDays?: number };
    return apiOkFromRequest(request, await runCounterfactualAnalysis(body));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
