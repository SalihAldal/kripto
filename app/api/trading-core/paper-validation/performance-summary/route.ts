import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { calculatePaperAccuracy, calculatePaperMetrics } from "@/src/server/paper-validation/paper-accuracy.service";
import { validatePaperRisk } from "@/src/server/paper-validation/risk-validation.service";
import { getSessionLeaderboard } from "@/src/server/paper-validation/session-analysis.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId") ?? undefined;
    const [metrics, accuracy, risk, sessions] = await Promise.all([
      calculatePaperMetrics(userId),
      calculatePaperAccuracy({ userId, limit: 100 }),
      userId ? validatePaperRisk(userId) : Promise.resolve(null),
      getSessionLeaderboard(userId),
    ]);
    return apiOkFromRequest(request, { metrics, accuracy, risk, sessions, autoLiveEnabled: false });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
