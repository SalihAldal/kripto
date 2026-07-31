import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getWalkForwardResults, runWalkForwardValidation } from "@/src/server/quant-research/walk-forward-validation.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const experimentId = request.nextUrl.searchParams.get("experimentId") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
    return apiOkFromRequest(request, await getWalkForwardResults(experimentId, limit));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as {
      experimentId?: string;
      genomeId?: string;
      folds?: number;
      windowDays?: number;
    };
    return apiOkFromRequest(request, await runWalkForwardValidation(body));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
