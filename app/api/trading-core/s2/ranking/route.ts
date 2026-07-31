import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getLatestDiscoverySnapshot } from "@/src/server/trading-core-s2/trading-core-s2.repository";
import { getCachedDiscoveryReport, getCachedDiscoveryTopSymbols } from "@/src/server/trading-core-s2/trading-core-s2.cache";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const snapshot = await getLatestDiscoverySnapshot();
    return apiOkFromRequest(request, {
      snapshot,
      cachedTopSymbols: getCachedDiscoveryTopSymbols(),
      cachedReport: getCachedDiscoveryReport(),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
