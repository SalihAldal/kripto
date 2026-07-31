import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { applyRateLimit } from "@/lib/rate-limit";
import { getRequestLocale } from "@/lib/request-locale";
import { toAppError } from "@/src/server/errors";
import { writeStructuredLog } from "@/src/server/observability/structured-log";

type RequestLogContext = {
  requestId: string;
  sessionId?: string;
  userId?: string;
  transactionId?: string;
};

function getRequestId(request: NextRequest) {
  return (
    request.headers.get("x-request-id") ??
    request.headers.get("x-correlation-id") ??
    crypto.randomUUID()
  );
}

function buildRequestLogContext(request: NextRequest): RequestLogContext {
  return {
    requestId: getRequestId(request),
    sessionId: request.headers.get("x-session-id") ?? undefined,
    userId: request.headers.get("x-user-id") ?? undefined,
    transactionId: request.headers.get("x-transaction-id") ?? undefined,
  };
}

export function apiOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function apiOkFromRequest<T>(request: NextRequest, data: T, status = 200) {
  return NextResponse.json(
    {
      ok: true,
      data,
      meta: {
        locale: getRequestLocale(request),
      },
    },
    { status },
  );
}

export function apiError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export function enforceRateLimit(request: NextRequest) {
  const noisyPaths = new Set([
    "/api/market/scan",
    "/api/exchange/orderbook",
    "/api/exchange/balance",
    "/api/dashboard/overview",
    "/api/dashboard/debug",
    "/api/system/status",
  ]);
  const requestKey = `${request.method}:${request.nextUrl.pathname}`;
  const now = Date.now();
  const throttleStore = (globalThis as unknown as { __apiLogThrottle?: Map<string, number> }).__apiLogThrottle ?? new Map<string, number>();
  (globalThis as unknown as { __apiLogThrottle?: Map<string, number> }).__apiLogThrottle = throttleStore;
  const last = throttleStore.get(requestKey) ?? 0;
  const noisy = noisyPaths.has(request.nextUrl.pathname);
  const canLog = !noisy || now - last >= 15_000;
  if (canLog) {
    throttleStore.set(requestKey, now);
    const context = buildRequestLogContext(request);
    logger.info(
      {
        requestId: context.requestId,
        sessionId: context.sessionId,
        userId: context.userId,
        transactionId: context.transactionId,
        method: request.method,
        path: request.nextUrl.pathname,
        query: request.nextUrl.searchParams.toString(),
        userAgent: request.headers.get("user-agent"),
        forwardedFor: request.headers.get("x-forwarded-for") ?? "local",
      },
      "API request received",
    );
  }
  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp = forwardedFor?.split(",")[0]?.trim() || "local";
  // Rate-limit'i endpoint bazinda uygula; farkli endpointler birbirini boğmasin.
  const key = `${clientIp}:${request.method}:${request.nextUrl.pathname}`;
  const check = applyRateLimit(key);
  if (!check.ok) {
    const locale = getRequestLocale(request);
    return apiError(locale === "tr" ? "Cok fazla istek." : "Too many requests.", 429);
  }
  return null;
}

export function apiErrorFromUnknown(error: unknown) {
  const appError = toAppError(error);
  logger.error(
    {
      code: appError.code,
      status: appError.status,
      context: appError.context,
      message: appError.message,
    },
    "API request failed",
  );
  return NextResponse.json(
    {
      ok: false,
      error: appError.expose ? appError.message : "Internal server error",
      code: appError.code,
    },
    { status: appError.status },
  );
}

export async function logApiErrorFromUnknown(request: NextRequest, error: unknown) {
  const appError = toAppError(error);
  const context = buildRequestLogContext(request);
  await writeStructuredLog({
    level: "ERROR",
    source: "api",
    message: "API request failed",
    actionType: "api_error",
    status: "FAILED",
    requestId: context.requestId,
    sessionId: context.sessionId,
    userId: context.userId,
    transactionId: context.transactionId,
    errorCode: appError.code,
    errorDetail: appError.message,
    context: {
      path: request.nextUrl.pathname,
      method: request.method,
      status: appError.status,
    },
  });
  return apiErrorFromUnknown(error);
}
