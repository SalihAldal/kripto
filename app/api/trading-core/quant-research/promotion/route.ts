import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listPromotionCandidates, evaluateCandidatePromotion } from "@/src/server/quant-research/promotion-rules.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    return apiOkFromRequest(request, await listPromotionCandidates(Number.isFinite(limit) ? limit : 30));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json();
    if (!body.candidateId) return apiErrorFromUnknown(new Error("candidateId required"));
    return apiOkFromRequest(request, await evaluateCandidatePromotion(body.candidateId));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
