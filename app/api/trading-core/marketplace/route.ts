import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { strategyMarketplaceStore } from "@/src/server/trading-core/marketplace";

const uploadSchema = z.object({
  title: z.string().min(3).max(120),
  description: z.string().min(20).max(2000),
  metadata: z.object({
    name: z.string().min(2),
    version: z.string().min(1),
    description: z.string().optional(),
    mode: z.enum(["SCALPING", "TREND", "BREAKOUT", "MEAN_REVERSION", "CUSTOM"]).optional(),
    symbols: z.array(z.string()).optional(),
    enabled: z.boolean().optional(),
    minScore: z.number().optional(),
    riskProfile: z.enum(["LOW", "MID", "HIGH"]),
  }),
  pricingType: z.enum(["FREE", "ONE_TIME", "SUBSCRIPTION", "BOT_RENTAL"]),
  priceUsd: z.number().min(0).optional(),
  monthlyPriceUsd: z.number().min(0).optional(),
  botRentalMonthlyUsd: z.number().min(0).optional(),
  revenueSharePercent: z.number().min(50).max(95).optional(),
  tags: z.array(z.string().min(1).max(30)).optional(),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const status = request.nextUrl.searchParams.get("status") as never;
    return apiOkFromRequest(request, {
      listings: strategyMarketplaceStore.list({ status: status || undefined }),
      subscriptions: strategyMarketplaceStore.subscriptionsFor(access.user.id),
      snapshot: strategyMarketplaceStore.snapshot(),
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
    const parsed = uploadSchema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Marketplace payload gecersiz." : "Invalid marketplace payload.", 400);
    const listing = strategyMarketplaceStore.upload({ ...parsed.data, creatorUserId: access.user.id });
    await addAuditLog({
      userId: access.user.id,
      action: "CREATE",
      entityType: "StrategyMarketplaceListing",
      entityId: listing.listingId,
      newValues: listing,
    }).catch(() => null);
    return apiOkFromRequest(request, listing);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
