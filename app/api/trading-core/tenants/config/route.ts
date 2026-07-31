import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { tenantConfigEngine } from "@/src/server/trading-core/tenant";

const schema = z.object({
  userId: z.string().min(1).optional(),
  leverage: z.number().int().min(1).max(125).optional(),
  riskLevel: z.enum(["LOW", "MID", "HIGH"]).optional(),
  maxDailyLossPercent: z.number().min(0).max(100).optional(),
  maxOpenPositions: z.number().int().min(0).max(50).optional(),
  coinWhitelist: z.array(z.string().min(2).max(30)).optional(),
});

function resolveUserId(role: string, ownUserId: string, requested?: string) {
  return role === "ADMIN" && requested ? requested : ownUserId;
}

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = resolveUserId(access.user.role, access.user.id, request.nextUrl.searchParams.get("userId") ?? undefined);
    return apiOkFromRequest(request, {
      userId,
      config: tenantConfigEngine.getEffectiveConfig(userId),
      symbols: tenantConfigEngine.symbolsForUser(userId),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function PATCH(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Tenant config payload gecersiz." : "Invalid tenant config payload.", 400);
    const { userId: requestedUserId, ...patch } = parsed.data;
    const userId = resolveUserId(access.user.role, access.user.id, requestedUserId);
    const record = tenantConfigEngine.updateUserConfig(userId, patch);
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "TenantTradingConfig",
      entityId: userId,
      newValues: record,
    }).catch(() => null);
    return apiOkFromRequest(request, {
      record,
      config: tenantConfigEngine.getEffectiveConfig(userId),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
