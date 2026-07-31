import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { listJournal } from "@/services/trading-engine.service";
import { buildTradeJournalSetupInsights, summarizeTradeJournal } from "@/src/server/services/trade-journal.service";
import { secureRoute } from "@/src/server/security/request-security";

export async function GET(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "60");
    const mode = request.nextUrl.searchParams.get("mode");
    const includeSummary = request.nextUrl.searchParams.get("summary") === "1";
    const includeInsights = request.nextUrl.searchParams.get("insights") === "1";
    const rows = await listJournal({ userId: access.user.id, limit, mode });
    const summary = includeSummary ? summarizeTradeJournal(rows) : undefined;
    const insights = includeInsights
      ? await buildTradeJournalSetupInsights({ userId: access.user.id })
      : undefined;
    return apiOkFromRequest(request, { items: rows, summary, insights });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
