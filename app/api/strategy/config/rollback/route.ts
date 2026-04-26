import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { getActiveStrategyConfig, rollbackStrategyConfig } from "@/src/server/config/strategy-config.service";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";

const schema = z.object({
  version: z.number().int().min(1),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const payload = sanitizePayload(await request.json().catch(() => ({})));
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return apiError(tr ? "Gecersiz rollback payload." : "Invalid rollback payload.", 422);
    const before = await getActiveStrategyConfig();
    const result = await rollbackStrategyConfig({
      version: parsed.data.version,
      updatedBy: access.user.id,
      note: `rollback_to_v${parsed.data.version}`,
    });
    if (!result.ok) return apiError(result.error, 404);
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "StrategyConfigRollback",
      entityId: String(result.data.version),
      oldValues: before,
      newValues: result.data,
      metadata: {
        rollbackTargetVersion: parsed.data.version,
      },
    }).catch(() => null);
    return apiOkFromRequest(request, result.data);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
