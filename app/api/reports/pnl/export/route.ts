import { NextRequest } from "next/server";
import { apiErrorFromUnknown, enforceRateLimit } from "@/lib/api";
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
    const format = request.nextUrl.searchParams.get("format") === "excel" ? "excel" : "csv";

    const report = await buildPnlReport({
      period,
      startDate,
      endDate,
      coin: coin && coin !== "all" ? coin : undefined,
      aiModel: aiModel && aiModel !== "all" ? aiModel : undefined,
      mode,
    });
    const filename = format === "excel" ? "pnl-report.xls" : "pnl-report.csv";
    return new Response(report.exports.csv, {
      headers: {
        "Content-Type": format === "excel" ? "application/vnd.ms-excel; charset=utf-8" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
