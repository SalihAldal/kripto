import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { tradingFeatureFlags } from "@/src/server/trading-core/core/feature-flags";
import { getSmartExecutionService } from "@/src/server/trading-core/smart-execution/singleton";
import { tradingFailsafeGuard } from "@/src/server/trading-core/protection/failsafe-guard";

const schema = z.object({
  reason: z.string().max(300).optional(),
  cancelOrders: z.boolean().default(true),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"], requireConfirmation: true });
    if (!access.ok) return access.response;

    const parsed = schema.safeParse(sanitizePayload(await request.json().catch(() => ({}))));
    const payload = parsed.success ? parsed.data : { reason: "manual emergency stop", cancelOrders: true };
    tradingFailsafeGuard.activateEmergency(payload.reason ?? "manual emergency stop");
    const flags = tradingFeatureFlags.emergencyDisable();
    const cancelled = payload.cancelOrders ? await getSmartExecutionService().emergencyCancel().catch(() => []) : [];

    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "TradingProtectionEmergencyStop",
      entityId: "trading-core",
      newValues: { flags, cancelled, reason: payload.reason },
    }).catch(() => null);

    return apiOkFromRequest(request, { flags, cancelled, protection: tradingFailsafeGuard.status() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
