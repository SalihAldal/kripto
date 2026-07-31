import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listCoinProfiles } from "@/src/server/learning-platform/learning-platform.repository";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const symbol = request.nextUrl.searchParams.get("symbol")?.toUpperCase();
    const profiles = symbol
      ? await listCoinProfiles(1).then((rows) => rows.filter((r) => r.symbol === symbol))
      : await listCoinProfiles(100);
    return apiOkFromRequest(request, { profiles });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
