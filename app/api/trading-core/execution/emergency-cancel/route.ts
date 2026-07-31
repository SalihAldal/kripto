import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { sanitizePayload } from "@/src/server/security/request-security";
import { secureSmartExecutionRoute } from "@/src/server/trading-core/smart-execution/smart-execution-route-security";
import { getSmartExecutionService } from "@/src/server/trading-core/smart-execution/singleton";

const schema = z.object({
  symbol: z.string().min(5).optional(),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureSmartExecutionRoute(request, {
      tr,
      roles: ["ADMIN"],
      requireConfirmation: true,
    });
    if (!access.ok) return access.response;

    const payload = sanitizePayload(await request.json());
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return apiError(tr ? "Emergency cancel payload gecersiz." : "Invalid emergency cancel payload.", 400);
    const canceled = await getSmartExecutionService().emergencyCancel(parsed.data.symbol);
    await addAuditLog({
      userId: access.user.id,
      action: "EXECUTE",
      entityType: "SmartExecutionEmergencyCancel",
      entityId: parsed.data.symbol ?? "ALL",
      newValues: parsed.data,
      metadata: {
        canceledCount: canceled.length,
      },
    }).catch(() => null);
    return apiOkFromRequest(request, { canceled });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
