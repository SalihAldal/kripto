import { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiOkFromRequest, logApiErrorFromUnknown } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { startTradeRoundJob } from "@/services/trading-engine.service";
import { addAuditLog } from "@/src/server/repositories/audit.repository";
import { writeStructuredLog } from "@/src/server/observability/structured-log";
import { acquireUserActionLock, getIdempotencyKey, readIdempotentResponse, writeIdempotentResponse } from "@/src/server/security/idempotency";
import { sanitizePayload, secureRoute } from "@/src/server/security/request-security";

const schema = z.object({
  totalRounds: z.number().int().min(1).max(20),
  budgetPerTrade: z.number().positive(),
  targetProfitPct: z.number().positive().max(30),
  stopLossPct: z.number().positive().max(30),
  maxWaitSec: z.number().int().min(60).max(86_400),
  coinSelectionMode: z.string().min(2).max(64).default("scanner_best"),
  aiMode: z.string().min(2).max(64).default("consensus"),
  allowRepeatCoin: z.boolean().default(true),
  mode: z.enum(["manual", "auto"]).default("auto"),
});

export async function POST(request: NextRequest) {
  const locale = getRequestLocale(request);
  const tr = locale === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const payload = sanitizePayload(await request.json().catch(() => ({})));
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return apiError(tr ? "Gecersiz tur ayarlari." : "Invalid round settings.");
    }
    const idempotencyKey = getIdempotencyKey(request.headers);
    if (!idempotencyKey) {
      return apiError(tr ? "idempotency-key zorunludur." : "idempotency-key is required.", 428);
    }
    const cached = await readIdempotentResponse(access.user.id, "round-start", idempotencyKey);
    if (cached) return apiOkFromRequest(request, cached);
    const releaseLock = await acquireUserActionLock(access.user.id, "round-start", 25_000);
    if (!releaseLock) {
      return apiError(tr ? "Aktif bir round baslatma istegi var." : "Round start already in progress.", 409);
    }
    let data: Awaited<ReturnType<typeof startTradeRoundJob>>;
    try {
      data = await startTradeRoundJob(parsed.data);
    } finally {
      await releaseLock();
    }
    await writeStructuredLog({
      level: data.started ? "INFO" : "WARN",
      source: "round-start-route",
      message: data.started ? "Auto round job started" : "Auto round job start rejected",
      actionType: "manual_round_start",
      status: data.started ? "SUCCESS" : "FAILED",
      requestId: request.headers.get("x-request-id") ?? undefined,
      sessionId: request.headers.get("x-session-id") ?? undefined,
      userId: access.user.id,
      transactionId: data.jobId,
      errorCode: data.started ? undefined : "ROUND_START_REJECTED",
      errorDetail: data.reason,
      context: parsed.data as unknown as Record<string, unknown>,
    });
    await addAuditLog({
      userId: access.user.id,
      action: "EXECUTE",
      entityType: "AutoRoundJob",
      entityId: data.jobId,
      newValues: parsed.data,
      metadata: {
        started: data.started,
        reason: data.reason,
      },
    }).catch(() => null);
    await writeIdempotentResponse(access.user.id, "round-start", idempotencyKey, data as Record<string, unknown>);
    return apiOkFromRequest(request, data);
  } catch (error) {
    return logApiErrorFromUnknown(request, error);
  }
}
