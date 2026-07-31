import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { emergencyStop, resumeTrading } from "@/services/trading-engine.service";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import { getIdempotencyKey, readIdempotentResponse, writeIdempotentResponse } from "@/src/server/security/idempotency";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";

const schema = z.object({
  enabled: z.boolean(),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";

  const access = await secureRoute(request, { tr, roles: ["ADMIN"] });
  if (!access.ok) return access.response;

  const payload = sanitizePayload(await request.json());
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return apiError(tr ? "Gecersiz payload." : "Invalid payload.");
  const idempotencyKey = getIdempotencyKey(request.headers);
  if (idempotencyKey) {
    const cached = await readIdempotentResponse(access.user.id, "emergency-stop", idempotencyKey);
    if (cached) return apiOkFromRequest(request, cached);
  }

  const result = parsed.data.enabled ? await emergencyStop() : await resumeTrading();
  const wrapped =
    result && typeof result === "object"
      ? {
          ...(result as Record<string, unknown>),
          message: parsed.data.enabled
            ? tr
              ? "Acil durdurma aktif edildi"
              : "Emergency stop enabled"
            : tr
              ? "Islem akisi yeniden aktif"
              : "Trading resumed",
        }
      : result;
  await writeStructuredLog({
    level: parsed.data.enabled ? "WARN" : "INFO",
    source: "trades-emergency-stop-route",
    message: parsed.data.enabled ? "Emergency stop enabled manually" : "Emergency stop disabled manually",
    actionType: "settings_updated",
    status: "SUCCESS",
    requestId: request.headers.get("x-request-id") ?? undefined,
    sessionId: request.headers.get("x-session-id") ?? undefined,
    userId: access.user.id,
    context: {
      enabled: parsed.data.enabled,
    },
  });
  await addAuditLog({
    userId: access.user.id,
    action: "UPDATE",
    entityType: "EmergencyStop",
    entityId: "execution.emergency_stop",
    newValues: {
      enabled: parsed.data.enabled,
    },
  }).catch(() => null);
  if (idempotencyKey && wrapped && typeof wrapped === "object") {
    await writeIdempotentResponse(access.user.id, "emergency-stop", idempotencyKey, wrapped as Record<string, unknown>);
  }
  return apiOkFromRequest(request, wrapped);
}
