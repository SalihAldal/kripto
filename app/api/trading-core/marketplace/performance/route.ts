import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { botPerformanceTracker } from "@/src/server/trading-core/bots/bot-performance-tracker";
import { strategyMarketplacePerformance } from "@/src/server/trading-core/marketplace";

const schema = z.object({
  listingId: z.string().min(2),
  botId: z.string().min(2),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const listingId = request.nextUrl.searchParams.get("listingId") ?? "";
    return apiOkFromRequest(request, {
      history: listingId ? strategyMarketplacePerformance.historyFor(listingId) : [],
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Performance payload gecersiz." : "Invalid performance payload.", 400);
    const metrics = botPerformanceTracker.metrics(parsed.data.botId);
    const row = strategyMarketplacePerformance.record({ ...parsed.data, metrics });
    return apiOkFromRequest(request, row);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
