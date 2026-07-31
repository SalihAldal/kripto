import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { tradingFeatureFlags } from "@/src/server/trading-core/core/feature-flags";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";

const updateSchema = z.object({
  scope: z.enum(["core", "module", "strategy", "bot"]),
  key: z.string().min(2).max(80),
  value: z.union([z.boolean(), z.number(), z.array(z.string().min(1)).min(1)]),
});

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    return apiOkFromRequest(request, {
      flags: tradingFeatureFlags.snapshot(),
      examples: {
        ai: "ENABLE_AI_ENGINE=true",
        scalping: "ENABLE_SCALPING_BOT=false",
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function PATCH(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"], requireConfirmation: true });
    if (!access.ok) return access.response;

    const parsed = updateSchema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Feature flag payload gecersiz." : "Invalid feature flag payload.", 400);

    const { scope, key, value } = parsed.data;
    if (scope !== "core" && typeof value !== "boolean") {
      return apiError(tr ? "Modul/strategy toggle degeri boolean olmali." : "Module/strategy toggle value must be boolean.", 400);
    }
    const flag =
      scope === "core"
        ? tradingFeatureFlags.setCoreValue(key, value)
        : scope === "strategy"
          ? tradingFeatureFlags.setStrategyEnabled(key, Boolean(value))
          : tradingFeatureFlags.setModuleEnabled(key, Boolean(value));

    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "TradingFeatureFlag",
      entityId: `${scope}:${key}`,
      newValues: flag,
    }).catch(() => null);

    tradingLogger.warn({
      category: "SYSTEM",
      source: "trading-core.feature-flags",
      message: `Feature flag updated: ${scope}:${key}`,
      status: "SUCCESS",
      userId: access.user.id,
      context: { flag },
    });

    return apiOkFromRequest(request, { flag, flags: tradingFeatureFlags.snapshot() });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
