import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { getConnectionStatus } from "@/src/server/exchange-abstraction/connection-manager.service";
import type { ExchangePluginType } from "@prisma/client";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const pluginType = request.nextUrl.searchParams.get("pluginType") as ExchangePluginType | null;
    return apiOkFromRequest(request, getConnectionStatus(pluginType ?? undefined));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
