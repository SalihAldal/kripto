import { NextRequest } from "next/server";
import { z } from "zod";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { secureRoute, sanitizePayload } from "@/src/server/security/request-security";
import { tenantRuntimeManager } from "@/src/server/trading-core/tenant";

const schema = z.object({
  userId: z.string().min(1).optional(),
});

function resolveUserId(role: string, ownUserId: string, requested?: string) {
  return role === "ADMIN" && requested ? requested : ownUserId;
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json().catch(() => ({}))));
    const userId = resolveUserId(access.user.role, access.user.id, parsed.success ? parsed.data.userId : undefined);
    const snapshot = await tenantRuntimeManager.start(userId);
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "TenantTradingSession",
      entityId: userId,
      newValues: { status: "ACTIVE" },
    }).catch(() => null);
    return apiOkFromRequest(request, snapshot);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function DELETE(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"], requireConfirmation: true });
    if (!access.ok) return access.response;
    const parsed = schema.safeParse(sanitizePayload(await request.json().catch(() => ({}))));
    const userId = resolveUserId(access.user.role, access.user.id, parsed.success ? parsed.data.userId : undefined);
    const session = await tenantRuntimeManager.stop(userId);
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "TenantTradingSession",
      entityId: userId,
      newValues: { status: "STOPPED" },
    }).catch(() => null);
    return apiOkFromRequest(request, { session });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
