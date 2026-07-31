import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import { getRiskConfigByUser, upsertRiskConfig } from "@/src/server/repositories/risk.repository";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";

const schema = z.object({
  maxLeverage: z.number().min(1).max(125).optional(),
  maxOpenPositions: z.number().int().min(1).max(50).optional(),
  maxOrderNotional: z.number().positive().optional(),
  maxDailyLossPercent: z.number().positive().max(100).optional(),
  maxDrawdownPercent: z.number().positive().max(100).optional(),
  stopLossRequired: z.boolean().optional(),
  takeProfitRequired: z.boolean().optional(),
  emergencyBrakeEnabled: z.boolean().optional(),
  cooldownMinutes: z.number().int().min(1).max(24 * 60).optional(),
  maxRiskPerTrade: z.number().positive().max(100).optional(),
  dailyLossReferenceTry: z.number().positive().optional(),
  weeklyLossReferenceTry: z.number().positive().optional(),
  maxWeeklyLossPercent: z.number().positive().max(100).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const tr = getRequestLocale(request) === "tr";
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "VIEWER"] });
    if (!access.ok) return access.response;
    const { user } = await getRuntimeExecutionContext(access.user.id);
    const data = await getRiskConfigByUser(user.id);
    return apiOkFromRequest(request, data);
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}

export async function PUT(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";

  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
    if (!access.ok) return access.response;

    const payload = sanitizePayload(await request.json());
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return apiError(tr ? "Gecersiz payload." : "Invalid payload.");

    const { user } = await getRuntimeExecutionContext(access.user.id);
    const before = await getRiskConfigByUser(user.id);
    const metaPatch = {
      ...(parsed.data.metadata ?? {}),
      ...(parsed.data.maxRiskPerTrade !== undefined ? { maxRiskPerTrade: parsed.data.maxRiskPerTrade } : {}),
      ...(parsed.data.dailyLossReferenceTry !== undefined ? { dailyLossReferenceTry: parsed.data.dailyLossReferenceTry } : {}),
      ...(parsed.data.weeklyLossReferenceTry !== undefined ? { weeklyLossReferenceTry: parsed.data.weeklyLossReferenceTry } : {}),
      ...(parsed.data.maxWeeklyLossPercent !== undefined ? { maxWeeklyLossPercent: parsed.data.maxWeeklyLossPercent } : {}),
    };
    const riskPayload = {
      maxLeverage: parsed.data.maxLeverage,
      maxOpenPositions: parsed.data.maxOpenPositions,
      maxOrderNotional: parsed.data.maxOrderNotional,
      maxDailyLossPercent: parsed.data.maxDailyLossPercent,
      maxDrawdownPercent: parsed.data.maxDrawdownPercent,
      stopLossRequired: parsed.data.stopLossRequired,
      takeProfitRequired: parsed.data.takeProfitRequired,
      emergencyBrakeEnabled: parsed.data.emergencyBrakeEnabled,
      cooldownMinutes: parsed.data.cooldownMinutes,
    };
    const updated = await upsertRiskConfig(user.id, {
      ...riskPayload,
      metadata: metaPatch,
    });
    await addAuditLog({
      userId: user.id,
      action: "UPDATE",
      entityType: "RiskConfig",
      entityId: updated.id,
      oldValues: before,
      newValues: parsed.data,
    }).catch(() => null);
    await writeStructuredLog({
      level: "INFO",
      source: "risk-config-route",
      message: "Risk configuration updated",
      actionType: "settings_updated",
      status: "SUCCESS",
      requestId: request.headers.get("x-request-id") ?? undefined,
      sessionId: request.headers.get("x-session-id") ?? undefined,
      userId: user.id,
      context: {
        changedKeys: Object.keys(parsed.data),
      },
    });

    return apiOkFromRequest(request, updated);
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
