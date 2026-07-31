import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { tradingFailsafeGuard } from "@/src/server/trading-core/protection/failsafe-guard";

const schema = z.object({
  enabled: z.boolean(),
});

export async function PATCH(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"], requireConfirmation: true });
    if (!access.ok) return access.response;

    const parsed = schema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Close-only payload gecersiz." : "Invalid close-only payload.", 400);

    tradingFailsafeGuard.setCloseOnly(parsed.data.enabled);
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "TradingProtectionCloseOnly",
      entityId: "trading-core",
      newValues: parsed.data,
    }).catch(() => null);

    return apiOkFromRequest(request, tradingFailsafeGuard.status());
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
