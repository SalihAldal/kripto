import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getRequestLocale } from "@/lib/request-locale";
import { listTradeLifecycleEvents } from "@/services/trading-engine.service";

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
    const executionId = request.nextUrl.searchParams.get("executionId") ?? undefined;
    const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
    const orderId = request.nextUrl.searchParams.get("orderId") ?? undefined;

    const rows = await listTradeLifecycleEvents({
      limit,
      executionId,
      symbol,
      orderId,
    });
    return apiOkFromRequest(request, rows);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
