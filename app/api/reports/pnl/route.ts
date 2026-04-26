import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { getRequestLocale } from "@/lib/request-locale";
import { buildPnlReport, type PnlReportPeriod, type PnlTradeMode } from "@/src/server/reports/pnl-report.service";

function readPeriod(raw: string | null): PnlReportPeriod {
  if (raw === "daily" || raw === "weekly" || raw === "monthly" || raw === "custom") return raw;
  return "monthly";
}

function readMode(raw: string | null): PnlTradeMode {
  if (raw === "manual" || raw === "auto" || raw === "all") return raw;
  return "all";
}

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    if (!checkApiToken(request)) {
      return Response.json({ ok: false, error: tr ? "Yetkisiz." : "Unauthorized." }, { status: 401 });
    }

    const period = readPeriod(request.nextUrl.searchParams.get("period"));
    const startDate = request.nextUrl.searchParams.get("startDate") ?? undefined;
    const endDate = request.nextUrl.searchParams.get("endDate") ?? undefined;
    const coin = request.nextUrl.searchParams.get("coin") ?? undefined;
    const aiModel = request.nextUrl.searchParams.get("aiModel") ?? undefined;
    const mode = readMode(request.nextUrl.searchParams.get("mode"));

    const report = await buildPnlReport({
      period,
      startDate,
      endDate,
      coin: coin && coin !== "all" ? coin : undefined,
      aiModel: aiModel && aiModel !== "all" ? aiModel : undefined,
      mode,
    });
    return apiOkFromRequest(request, report);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
