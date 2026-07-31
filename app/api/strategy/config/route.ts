import { NextRequest } from "next/server";
import { apiError, apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import {
  getActiveStrategyConfig,
  getDefaultStrategyConfig,
  saveStrategyConfig,
  validateStrategyConfig,
} from "@/src/server/config/strategy-config.service";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";

export async function GET(request: NextRequest) {
  try {
    const locale = getRequestLocale(request);
    const tr = locale === "tr";
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;
    const data = await getActiveStrategyConfig();
    return apiOkFromRequest(request, {
      active: data,
      defaults: getDefaultStrategyConfig(),
    });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function PUT(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;
    const payload = sanitizePayload(await request.json().catch(() => ({})));
    const parsed = validateStrategyConfig(payload);
    if (!parsed.success) {
      return apiError(tr ? "Gecersiz strateji ayarlari." : "Invalid strategy settings.", 422);
    }
    const before = await getActiveStrategyConfig();
    const saved = await saveStrategyConfig({
      config: parsed.data,
      updatedBy: access.user.id,
      note: "panel_update",
    });
    if (!saved.ok) {
      return apiError(saved.errors.join(", "), 422);
    }
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "StrategyConfig",
      entityId: String(saved.data.version),
      oldValues: before,
      newValues: saved.data,
      metadata: {
        changedFromVersion: before.version,
        changedToVersion: saved.data.version,
      },
    }).catch(() => null);
    return apiOkFromRequest(request, saved.data);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
