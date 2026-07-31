import { NextRequest } from "next/server";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { botProfileStore } from "@/src/server/trading-core/bot-profiles";

export async function GET(request: NextRequest, context: { params: Promise<{ botId: string }> }) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const { botId } = await context.params;
    const profile = botProfileStore.get(botId);
    if (!profile) return apiError(tr ? "Bot profili bulunamadi." : "Bot profile not found.", 404);
    return apiOkFromRequest(request, {
      profile,
      ratings: botProfileStore.ratingsFor(botId),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
