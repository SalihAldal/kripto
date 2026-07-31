import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { listTrades } from "@/services/trading-engine.service";
import { secureRoute } from "@/src/server/security/request-security";

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const rows = await listTrades();
    return apiOkFromRequest(request, rows);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
