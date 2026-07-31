import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { listEntryAnalyses } from "@/src/server/entry-timing/entry-timing.repository";
import { analyzeEntryTiming } from "@/src/server/entry-timing/entry-analysis.service";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
    const analyses = await listEntryAnalyses(symbol, limit);
    return apiOkFromRequest(request, { analyses });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json() as { symbol: string; price?: number };
    if (!body.symbol) return apiErrorFromUnknown(new Error("symbol required"));
    const result = await analyzeEntryTiming(body.symbol.toUpperCase(), body.price);
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
