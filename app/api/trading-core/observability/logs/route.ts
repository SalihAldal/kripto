import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import type { TradingLogCategory, TradingLogLevel } from "@/src/server/trading-core/observability/observability-types";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;

    const logs = tradingLogger.memory({
      level: (request.nextUrl.searchParams.get("level") || undefined) as TradingLogLevel | undefined,
      category: (request.nextUrl.searchParams.get("category") || undefined) as TradingLogCategory | undefined,
      limit: Number(request.nextUrl.searchParams.get("limit") ?? 200),
    });
    return apiOkFromRequest(request, logs);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
