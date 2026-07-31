import { NextRequest } from "next/server";
import { apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { stopTradeRoundJob } from "@/services/trading-engine.service";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import { getIdempotencyKey, readIdempotentResponse, writeIdempotentResponse } from "@/src/server/security/idempotency";
import { secureRoute } from "@/src/server/security/request-security";

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const idempotencyKey = getIdempotencyKey(request.headers);
    if (idempotencyKey) {
      const cached = await readIdempotentResponse(access.user.id, "round-stop", idempotencyKey);
      if (cached) return apiOkFromRequest(request, cached);
    }
    const data = await stopTradeRoundJob();
    await writeStructuredLog({
      level: data.stopped ? "WARN" : "ERROR",
      source: "round-stop-route",
      message: data.stopped ? "Auto round stop requested" : "Auto round stop rejected",
      actionType: "manual_round_stop",
      status: data.stopped ? "SUCCESS" : "FAILED",
      requestId: request.headers.get("x-request-id") ?? undefined,
      sessionId: request.headers.get("x-session-id") ?? undefined,
      userId: access.user.id,
      transactionId: data.jobId,
      errorCode: data.stopped ? undefined : "ROUND_STOP_REJECTED",
      errorDetail: data.reason,
      context: data as unknown as Record<string, unknown>,
    });
    await addAuditLog({
      userId: access.user.id,
      action: "UPDATE",
      entityType: "AutoRoundJob",
      entityId: data.jobId,
      newValues: {
        stopRequested: true,
      },
      metadata: data as unknown as Record<string, unknown>,
    }).catch(() => null);
    if (idempotencyKey) {
      await writeIdempotentResponse(access.user.id, "round-stop", idempotencyKey, data as Record<string, unknown>);
    }
    return apiOkFromRequest(request, data);
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
