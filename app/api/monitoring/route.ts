import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getRequestLocale } from "@/lib/request-locale";
import { getMonitoringSnapshot } from "@/src/server/observability/monitoring.service";

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    if (!checkApiToken(request)) {
      return Response.json({ ok: false, error: tr ? "Yetkisiz." : "Unauthorized." }, { status: 401 });
    }
    const data = await getMonitoringSnapshot();
    return apiOkFromRequest(request, data);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
