import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listLearningReports } from "@/src/server/learning-platform/learning-platform.repository";
import { generateDailyLearningReport } from "@/src/server/learning-platform/daily-learning-report.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const reports = await listLearningReports(30);
    return apiOkFromRequest(request, { reports });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as { date?: string };
    const report = await generateDailyLearningReport(body.date ? new Date(body.date) : new Date());
    return apiOkFromRequest(request, { report });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
