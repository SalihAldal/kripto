import { NextRequest } from "next/server";
import { prisma } from "@/src/server/db/prisma";
import { z } from "zod";
import { apiError, apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { pushLog } from "@/services/log.service";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";

const schema = z.object({
  confidenceThreshold: z.number().min(0.5).max(1).optional(),
  maxRiskPerTrade: z.number().min(0.1).max(10).optional(),
  autoTradeEnabled: z.boolean().optional(),
  maxOpenTrades: z.number().int().min(1).max(20).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const tr = getRequestLocale(request) === "tr";
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;
    const row = await prisma.appSetting.findUnique({
      where: { key: "settings.trading" },
    });
    const value = (row?.value as Record<string, unknown> | null) ?? {};
    return apiOkFromRequest(request, value);
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}

export async function PUT(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
  if (!access.ok) return access.response;

  const payload = sanitizePayload(await request.json());
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return apiError(tr ? "Gecersiz payload." : "Invalid payload.");

  try {
    const current = await prisma.appSetting.findUnique({
      where: { key: "settings.trading" },
    });
    const nextValue = {
      ...((current?.value as Record<string, unknown> | null) ?? {}),
      ...parsed.data,
    };
    await prisma.appSetting.upsert({
      where: { key: "settings.trading" },
      create: {
        key: "settings.trading",
        scope: "GLOBAL",
        value: nextValue,
        valueType: "json",
        description: "Trading panel settings",
        status: "ACTIVE",
      },
      update: {
        value: nextValue,
        status: "ACTIVE",
      },
    });
    pushLog("INFO", tr ? "Ayarlar paneli guncellendi." : "Settings panel updated.");
    await writeStructuredLog({
      level: "INFO",
      source: "settings-route",
      message: "Trading settings updated",
      actionType: "settings_updated",
      status: "SUCCESS",
      requestId: request.headers.get("x-request-id") ?? undefined,
      sessionId: request.headers.get("x-session-id") ?? undefined,
      userId: access.user.id,
      context: {
        changedKeys: Object.keys(parsed.data),
      },
    });
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "TradingSettings",
      entityId: "settings.trading",
      oldValues: current?.value ?? {},
      newValues: nextValue,
      metadata: {
        changedKeys: Object.keys(parsed.data),
      },
    }).catch(() => null);
    return apiOkFromRequest(request, nextValue);
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
