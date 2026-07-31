import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { botPerformanceTracker } from "@/src/server/trading-core/bots/bot-performance-tracker";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const botId = request.nextUrl.searchParams.get("botId");
    const metrics = botId ? [botPerformanceTracker.metrics(botId)] : botPerformanceTracker.snapshot();
    return apiOkFromRequest(request, {
      metrics,
      adaptiveAllocation: {
        enabled: true,
        weightSource: "botPerformanceMetrics.adaptiveWeight",
        poorPerformanceFlag: "metrics.poorPerformance",
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
