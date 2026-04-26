import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { cancelTrade } from "@/services/trading-engine.service";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import { getIdempotencyKey, readIdempotentResponse, writeIdempotentResponse } from "@/src/server/security/idempotency";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";

const schema = z.object({
  orderId: z.string().min(3),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";

  const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
  if (!access.ok) return access.response;

  const payload = sanitizePayload(await request.json());
  const parsed = schema.safeParse(payload);
  if (!parsed.success) return apiError(tr ? "Gecersiz payload." : "Invalid payload.");
  const idempotencyKey = getIdempotencyKey(request.headers);
  if (idempotencyKey) {
    const cached = await readIdempotentResponse(access.user.id, "manual-cancel", idempotencyKey);
    if (cached) return apiOkFromRequest(request, cached);
  }

  const result = await cancelTrade(parsed.data.orderId);
  await writeStructuredLog({
    level: (result as { canceled?: boolean }).canceled ? "WARN" : "ERROR",
    source: "trades-cancel-route",
    message: "Manual cancel processed",
    actionType: "manual_cancel",
    status: (result as { canceled?: boolean }).canceled ? "SUCCESS" : "FAILED",
    requestId: request.headers.get("x-request-id") ?? undefined,
    sessionId: request.headers.get("x-session-id") ?? undefined,
    userId: access.user.id,
    orderId: parsed.data.orderId,
    errorCode: (result as { canceled?: boolean }).canceled ? undefined : "MANUAL_CANCEL_FAILED",
    errorDetail: (result as { reason?: string }).reason,
    context: result as Record<string, unknown>,
  });
  await addAuditLog({
    userId: access.user.id,
    action: "EXECUTE",
    entityType: "ManualOrderCancel",
    entityId: parsed.data.orderId,
    metadata: result as Record<string, unknown>,
  }).catch(() => null);
  if (idempotencyKey) {
    await writeIdempotentResponse(access.user.id, "manual-cancel", idempotencyKey, result as Record<string, unknown>);
  }
  if (result && typeof result === "object" && "reason" in result) {
    const row = result as { reason?: string };
    if (row.reason === "Order not found.") row.reason = tr ? "Emir bulunamadi." : row.reason;
    if (row.reason === "Order already filled.") row.reason = tr ? "Emir zaten dolmus." : row.reason;
  }
  return apiOkFromRequest(request, result);
}
