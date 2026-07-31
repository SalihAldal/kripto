import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { listStrategyPresets } from "@/src/server/config/strategy-config.service";
import { secureRoute } from "@/src/server/security/request-security";

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, { presets: listStrategyPresets() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
