import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { strategyMarketplaceStore } from "@/src/server/trading-core/marketplace";

const schema = z.object({
  listingId: z.string().min(2),
  stars: z.number().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Rating payload gecersiz." : "Invalid rating payload.", 400);
    const rating = strategyMarketplaceStore.rate({ ...parsed.data, userId: access.user.id });
    return apiOkFromRequest(request, {
      rating,
      listing: strategyMarketplaceStore.get(parsed.data.listingId),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
