import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getSimulationById, listSimulations } from "@/src/server/exchange-simulator/exchange-simulator.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const simulationId = request.nextUrl.searchParams.get("simulationId") ?? undefined;
    const executionId = request.nextUrl.searchParams.get("executionId") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 100);
    if (simulationId) {
      const row = await getSimulationById(simulationId);
      return apiOkFromRequest(request, { simulation: row });
    }
    const rows = await listSimulations({
      executionId,
      limit: Number.isFinite(limit) ? limit : 100,
    });
    return apiOkFromRequest(request, { replays: rows });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
