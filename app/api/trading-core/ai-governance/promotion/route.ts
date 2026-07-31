import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { evaluatePromotionEligibility } from "@/src/server/ai-governance/promotion-rules.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const candidates = await prisma.productionCandidate.findMany({
      orderBy: { evaluatedAt: "desc" },
      take: 30,
      include: { version: { include: { registry: true } } },
    });
    return apiOkFromRequest(request, candidates);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const body = await request.json();
    if (!body.versionId) return apiErrorFromUnknown(new Error("versionId required"));
    return apiOkFromRequest(request, await evaluatePromotionEligibility(body.versionId));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
