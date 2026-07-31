import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listSimulationResults } from "@/src/server/shadow-validation/shadow-validation.repository";
import { prisma } from "@/src/server/db/prisma";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const mode = request.nextUrl.searchParams.get("mode") ?? "simulation";
    if (mode === "historical") {
      const rows = await prisma.engineComparison.findMany({
        orderBy: { computedAt: "desc" },
        take: Number(request.nextUrl.searchParams.get("limit") ?? 100),
      });
      return apiOkFromRequest(request, { rows, count: rows.length });
    }
    const windowDays = request.nextUrl.searchParams.get("windowDays");
    const rows = await listSimulationResults(windowDays ? Number(windowDays) : undefined, Number(request.nextUrl.searchParams.get("limit") ?? 50));
    return apiOkFromRequest(request, { rows, count: rows.length });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
