import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { strategyMarketplaceStore } from "@/src/server/trading-core/marketplace";

const schema = z.object({
  listingId: z.string().min(2),
  pricingType: z.enum(["FREE", "ONE_TIME", "SUBSCRIPTION", "BOT_RENTAL"]).optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Subscription payload gecersiz." : "Invalid subscription payload.", 400);
    const subscription = strategyMarketplaceStore.subscribe({
      listingId: parsed.data.listingId,
      userId: access.user.id,
      pricingType: parsed.data.pricingType,
    });
    await addAuditLog({
      userId: access.user.id,
      action: "CREATE",
      entityType: "StrategySubscription",
      entityId: subscription.subscriptionId,
      newValues: subscription,
    }).catch(() => null);
    return apiOkFromRequest(request, {
      subscription,
      revenue: strategyMarketplaceStore.revenue(subscription.listingId),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
