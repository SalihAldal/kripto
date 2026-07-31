import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { publishEvent } from "@/src/server/event-platform/event-bus.service";
import { authorizeModule, validateEventIntegrity } from "@/src/server/event-platform/security.service";
import type { AggregateType, PlatformModuleType } from "@prisma/client";

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = await request.json() as {
      eventType: string;
      aggregateId: string;
      aggregateType: AggregateType;
      sourceModule: PlatformModuleType;
      payload: Record<string, unknown>;
      correlationId?: string;
      idempotencyKey?: string;
      priority?: "CRITICAL" | "HIGH" | "NORMAL" | "LOW" | "DEFERRED";
      signature?: string;
    };

    if (!authorizeModule(body.sourceModule)) {
      return apiErrorFromUnknown(new Error("Unauthorized source module"));
    }

    const event = await publishEvent({
      correlationId: body.correlationId ?? crypto.randomUUID(),
      aggregateId: body.aggregateId,
      aggregateType: body.aggregateType,
      eventType: body.eventType,
      sourceModule: body.sourceModule,
      payload: body.payload,
      schemaVersion: 1,
      environment: process.env.APP_ENV ?? "production",
    }, { idempotencyKey: body.idempotencyKey, priority: body.priority });

    if (body.signature && !validateEventIntegrity(event, body.signature)) {
      return apiErrorFromUnknown(new Error("Event integrity validation failed"));
    }

    return apiOkFromRequest(request, event);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
