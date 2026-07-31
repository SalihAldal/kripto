import { NextRequest } from "next/server";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { tradingLogger } from "@/src/server/trading-core/observability/central-logger";
import { tradingConfig, tradingConfigPatchSchema } from "@/src/server/trading-core/config";
import type { BotRuntimeConfig, StrategyRuntimeConfig, UserTradingConfig } from "@/src/server/trading-core/config";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId") ?? access.user.id;
    return apiOkFromRequest(request, {
      config: tradingConfig.snapshot(),
      effective: tradingConfig.effectiveForUser(userId),
      records: tradingConfig.records(),
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

    const parsed = tradingConfigPatchSchema.safeParse(sanitizePayload(await request.json()));
    if (!parsed.success) return apiError(tr ? "Config payload gecersiz." : "Invalid config payload.", 400);

    const { scope, key, value } = parsed.data;
    const record =
      scope === "global"
        ? tradingConfig.updateGlobal(key, value)
        : scope === "strategy"
          ? tradingConfig.updateStrategy(key, value as Partial<StrategyRuntimeConfig>)
          : scope === "bot"
            ? tradingConfig.updateBot(key, value as Partial<BotRuntimeConfig>)
            : tradingConfig.updateUser(key, value as UserTradingConfig);

    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "TradingRuntimeConfig",
      entityId: `${scope}:${key}`,
      newValues: record,
    }).catch(() => null);

    tradingLogger.warn({
      category: "SYSTEM",
      source: "trading-core.config",
      message: `Trading config updated: ${scope}:${key}`,
      status: "SUCCESS",
      userId: access.user.id,
      context: { record },
    });

    return apiOkFromRequest(request, {
      record,
      config: tradingConfig.snapshot(),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
