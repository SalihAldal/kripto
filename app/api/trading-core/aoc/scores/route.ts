import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getLatestHealthScores, getAocDashboard } from "@/src/server/aoc/aoc.repository";
import { calculateHealthScores } from "@/src/server/aoc/health-scores.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const [latest, history] = await Promise.all([
      getLatestHealthScores(),
      getAocDashboard().then((d) => d.scores),
    ]);
    return apiOkFromRequest(request, { latest, history });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const score = await calculateHealthScores();
    return apiOkFromRequest(request, { score });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
