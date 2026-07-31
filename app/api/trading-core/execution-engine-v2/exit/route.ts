import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { evaluateExitForOpenPosition } from "@/src/server/execution-engine-v2/exit-ai.gateway.service";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const positionId = request.nextUrl.searchParams.get("positionId") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    const analyses = await prisma.exitAnalysis.findMany({
      where: positionId ? { positionId } : undefined,
      orderBy: { analyzedAt: "desc" },
      take: Math.min(100, limit),
    });
    const protection = positionId
      ? await prisma.profitProtection.findMany({ where: { positionId }, orderBy: { recordedAt: "desc" }, take: 10 })
      : [];
    return apiOkFromRequest(request, { analyses, protection });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as { positionId: string; symbol?: string };
    const evaluation = await evaluateExitForOpenPosition(body);
    return apiOkFromRequest(request, { evaluation });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
