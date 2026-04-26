import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { closeTrade } from "@/services/trading-engine.service";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import { getIdempotencyKey, readIdempotentResponse, writeIdempotentResponse } from "@/src/server/security/idempotency";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";

const schema = z.object({
  positionId: z.string().min(3).optional(),
  tradeId: z.string().min(3).optional(),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";

  const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
  if (!access.ok) return access.response;

  const payload = sanitizePayload(await request.json());
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return apiError(tr ? "Gecersiz payload." : "Invalid payload.");
  }
  const idempotencyKey = getIdempotencyKey(request.headers);
  if (idempotencyKey) {
    const cached = await readIdempotentResponse(access.user.id, "manual-close", idempotencyKey);
    if (cached) return apiOkFromRequest(request, cached);
  }

  const positionId = parsed.data.positionId ?? parsed.data.tradeId;
  if (!positionId) return apiError(tr ? "positionId zorunludur." : "positionId is required.");
  const result = await closeTrade(positionId);
  await writeStructuredLog({
    level: (result as { closed?: boolean }).closed ? "INFO" : "WARN",
    source: "trades-close-route",
    message: "Manual close request processed",
    actionType: "manual_trade_close",
    status: (result as { closed?: boolean }).closed ? "SUCCESS" : "FAILED",
    requestId: request.headers.get("x-request-id") ?? undefined,
    sessionId: request.headers.get("x-session-id") ?? undefined,
    userId: access.user.id,
    transactionId: (result as { executionId?: string }).executionId,
    context: {
      positionId,
      result,
    },
  });
  await addAuditLog({
    userId: access.user.id,
    action: "EXECUTE",
    entityType: "ManualTradeClose",
    entityId: positionId,
    metadata: result as Record<string, unknown>,
  }).catch(() => null);
  if (idempotencyKey) {
    await writeIdempotentResponse(access.user.id, "manual-close", idempotencyKey, result as Record<string, unknown>);
  }
  return apiOkFromRequest(request, result);
}
