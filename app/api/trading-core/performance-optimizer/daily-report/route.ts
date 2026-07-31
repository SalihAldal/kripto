import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getDailyReport } from "@/src/server/performance-optimizer/performance-optimizer.repository";
import { runDailyPerformanceReview } from "@/src/server/performance-optimizer/daily-performance-review.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const report = await getDailyReport();
    return apiOkFromRequest(request, report);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const review = await runDailyPerformanceReview();
    return apiOkFromRequest(request, { review });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
