import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { getSmartExecutionService } from "@/src/server/trading-core/smart-execution/singleton";

const schema = z.object({
  symbol: z.string().min(5).max(20).optional(),
});

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"], requireConfirmation: true });
    if (!access.ok) return access.response;

    const parsed = schema.safeParse(sanitizePayload(await request.json().catch(() => ({}))));
    const symbol = parsed.success ? parsed.data.symbol?.toUpperCase() : undefined;
    const cancelled = await getSmartExecutionService().emergencyCancel(symbol);

    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "TradingProtectionCancelAll",
      entityId: symbol ?? "all",
      newValues: { cancelled, symbol },
    }).catch(() => null);

    return apiOkFromRequest(request, { cancelled, symbol: symbol ?? null });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
