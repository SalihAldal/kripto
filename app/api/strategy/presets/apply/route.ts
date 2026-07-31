import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest, enforceRateLimit } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { applyStrategyPreset } from "@/src/server/config/strategy-config.service";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";

const schema = z.object({
  preset: z.enum(["Conservative", "Balanced", "Aggressive", "Scalping", "Momentum"]),
  note: z.string().max(140).optional(),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const limited = enforceRateLimit(request);
    if (limited) return limited;
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;

    const payload = sanitizePayload(await request.json().catch(() => ({})));
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return apiError(tr ? "Gecersiz preset payload." : "Invalid preset payload.", 400);
    }

    const result = await applyStrategyPreset({
      userId: access.user.id,
      preset: parsed.data.preset,
      note: parsed.data.note,
    });
    if (!result.ok) {
      return apiError(tr ? "Preset uygulanamadi." : "Preset apply failed.", 422);
    }

    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "StrategyPreset",
      entityId: parsed.data.preset,
      newValues: parsed.data,
    }).catch(() => null);

    return apiOkFromRequest(request, result.data);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
