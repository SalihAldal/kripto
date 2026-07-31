import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { tradingFeatureFlags } from "@/src/server/trading-core/core/feature-flags";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";

const schema = z.object({
  modules: z.array(z.string().min(2).max(80)).min(1).max(20).optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"], requireConfirmation: true });
    if (!access.ok) return access.response;

    const parsed = schema.safeParse(sanitizePayload(await request.json().catch(() => ({}))));
    const changed = tradingFeatureFlags.emergencyDisable(parsed.success ? parsed.data.modules : undefined);

    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "TradingFeatureFlagEmergencyDisable",
      entityId: "trading-core",
      newValues: changed,
    }).catch(() => null);

    tradingLogger.critical({
      category: "SYSTEM",
      source: "trading-core.feature-flags",
      message: "Emergency feature disable executed",
      status: "SUCCESS",
      userId: access.user.id,
      context: { changed },
    });

    return apiOkFromRequest(request, { changed, flags: tradingFeatureFlags.snapshot() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
