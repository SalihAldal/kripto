import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { runStrategySelection, selectForCandidateSymbols } from "@/src/server/strategy-selector/strategy-selector.pipeline.service";
import { getLatestSelection, listSelections } from "@/src/server/strategy-selector/strategy-selector.repository";
import { getCachedSelection } from "@/src/server/strategy-selector/strategy-selector-queue";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const symbol = request.nextUrl.searchParams.get("symbol") ?? undefined;
    if (symbol) {
      const cached = getCachedSelection(symbol);
      const selection = await getLatestSelection(symbol);
      return apiOkFromRequest(request, { selection, cached });
    }
    const selections = await listSelections(undefined, 30);
    return apiOkFromRequest(request, { selections });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json() as { symbol?: string; scanAll?: boolean };
    if (body.scanAll) {
      const result = await selectForCandidateSymbols();
      return apiOkFromRequest(request, result);
    }
    if (!body.symbol) return apiErrorFromUnknown(new Error("symbol required"));
    const result = await runStrategySelection(body.symbol.toUpperCase());
    return apiOkFromRequest(request, result);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
