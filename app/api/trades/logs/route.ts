import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getRequestLocale } from "@/lib/request-locale";
import { listDetailedTradeLogs } from "@/services/trading-engine.service";

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    if (!checkApiToken(request)) {
      return Response.json({ ok: false, error: tr ? "Yetkisiz." : "Unauthorized." }, { status: 401 });
    }

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "120");
    const positionId = request.nextUrl.searchParams.get("positionId") ?? undefined;
    const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
    const eventType = request.nextUrl.searchParams.get("eventType") ?? undefined;

    const rows = await listDetailedTradeLogs({
      limit,
      positionId,
      symbol,
      eventType,
    });
    return apiOkFromRequest(request, rows);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
