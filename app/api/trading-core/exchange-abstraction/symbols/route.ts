import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listCanonicalSymbols } from "@/src/server/exchange-abstraction/exchange-abstraction.repository";
import type { ExchangePluginType } from "@prisma/client";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const pluginType = request.nextUrl.searchParams.get("pluginType") as ExchangePluginType | null;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 200);
    return apiOkFromRequest(request, await listCanonicalSymbols(pluginType ?? undefined, limit));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
