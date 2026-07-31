import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getRequestLocale } from "@/lib/request-locale";
import { getTradeRoundHistory } from "@/services/trading-engine.service";

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    if (!checkApiToken(request)) {
      return Response.json({ ok: false, error: tr ? "Yetkisiz." : "Unauthorized." }, { status: 401 });
    }

    const params = request.nextUrl.searchParams;
    const page = Number(params.get("page") ?? "1");
    const pageSize = Number(params.get("pageSize") ?? "5");
    const filterRaw = params.get("filter") ?? "all";
    const filter = filterRaw === "opened" || filterRaw === "rejected" ? filterRaw : "all";
    const jobId = params.get("jobId") ?? undefined;

    const data = await getTradeRoundHistory(undefined, {
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 5,
      filter,
      jobId,
    });
    return apiOkFromRequest(request, data);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
