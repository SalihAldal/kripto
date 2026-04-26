import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { openTrade } from "@/services/trading-engine.service";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import { acquireUserActionLock, getIdempotencyKey, readIdempotentResponse, writeIdempotentResponse } from "@/src/server/security/idempotency";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";

const schema = z
  .object({
    symbol: z.string().min(5).optional(),
    quantity: z.number().positive().optional(),
    orderType: z.enum(["MARKET", "LIMIT"]).optional(),
    limitPrice: z.number().positive().optional(),
    takeProfitPercent: z.number().positive().max(20).optional(),
    stopLossPercent: z.number().positive().max(20).optional(),
    maxDurationSec: z.number().int().positive().max(86_400).optional(),
  })
  .refine((v) => (v.orderType === "LIMIT" ? Boolean(v.limitPrice) : true), {
    message: "limitPrice required for LIMIT order",
  });

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";

  try {
    const access = await secureRoute(request, {
      tr,
      roles: ["ADMIN", "TRADER"],
    });
    if (!access.ok) return access.response;

    const payload = sanitizePayload(await request.json());
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return apiError(tr ? "Gecersiz payload." : "Invalid payload.");
    }

    const idempotencyKey = getIdempotencyKey(request.headers);
    if (!idempotencyKey) {
      return apiError(
        tr
          ? "Kritik islem icin idempotency-key zorunludur."
          : "idempotency-key is required for critical action.",
        428,
      );
    }

    const cached = await readIdempotentResponse(access.user.id, "manual-open", idempotencyKey);
    if (cached) {
      return apiOkFromRequest(request, cached);
    }

    const releaseLock = await acquireUserActionLock(access.user.id, "manual-open", 20_000);
    if (!releaseLock) {
      return apiError(
        tr ? "Ayni anda birden fazla manuel islem acilamaz." : "Conflicting manual trade is already running.",
        409,
      );
    }

    let result: Awaited<ReturnType<typeof openTrade>>;
    try {
      result = await openTrade(parsed.data);
    } finally {
      await releaseLock();
    }
    await writeStructuredLog({
      level: result.opened ? "INFO" : "WARN",
      source: "trades-open-route",
      message: result.opened ? "Manual trade triggered and opened" : "Manual trade trigger rejected",
      actionType: "manual_trade_triggered",
      status: result.opened ? "SUCCESS" : "FAILED",
      requestId: request.headers.get("x-request-id") ?? undefined,
      sessionId: request.headers.get("x-session-id") ?? undefined,
      userId: access.user.id,
      transactionId: result.executionId,
      symbol: result.symbol,
      orderId: result.orderId,
      errorCode: result.rejected ? "MANUAL_OPEN_REJECTED" : undefined,
      errorDetail: result.rejectReason,
      context: {
        payload: parsed.data,
        positionId: result.positionId,
      },
    });
    await addAuditLog({
      userId: access.user.id,
      action: "EXECUTE",
      entityType: "ManualTradeOpen",
      entityId: result.executionId,
      newValues: parsed.data,
      metadata: {
        opened: result.opened,
        rejected: result.rejected,
        reason: result.rejectReason,
      },
    }).catch(() => null);
    await writeIdempotentResponse(access.user.id, "manual-open", idempotencyKey, result as Record<string, unknown>);
    if (result && typeof result === "object" && "rejectReason" in result) {
      const typed = result as { rejectReason?: string };
      if (typed.rejectReason === "Execution flow failed" && tr) {
        typed.rejectReason = "Islem akisi basarisiz oldu";
      }
    }
    return apiOkFromRequest(request, result);
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
