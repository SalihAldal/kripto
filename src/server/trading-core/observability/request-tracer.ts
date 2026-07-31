import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import type { TraceContext } from "@/src/server/trading-core/observability/observability-types";

export function createTraceContext(request?: NextRequest): TraceContext {
  return {
    requestId: request?.headers.get("x-request-id") ?? request?.headers.get("x-correlation-id") ?? randomUUID(),
    traceId: request?.headers.get("x-trace-id") ?? randomUUID(),
    spanId: randomUUID(),
    startedAt: Date.now(),
  };
}

export function childTrace(parent: TraceContext): TraceContext {
  return {
    requestId: parent.requestId,
    traceId: parent.traceId,
    spanId: randomUUID(),
    startedAt: Date.now(),
  };
}

export function traceLatency(trace: TraceContext) {
  return Date.now() - trace.startedAt;
}
