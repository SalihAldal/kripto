import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { searchEvents } from "@/src/server/event-platform/event-platform.repository";
import type { AggregateType, PlatformModuleType } from "@prisma/client";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const params = request.nextUrl.searchParams;
    const events = await searchEvents({
      eventType: params.get("eventType") ?? undefined,
      aggregateType: (params.get("aggregateType") as AggregateType) ?? undefined,
      aggregateId: params.get("aggregateId") ?? undefined,
      correlationId: params.get("correlationId") ?? undefined,
      sourceModule: (params.get("sourceModule") as PlatformModuleType) ?? undefined,
      from: params.get("from") ? new Date(params.get("from")!) : undefined,
      to: params.get("to") ? new Date(params.get("to")!) : undefined,
      limit: Number(params.get("limit") ?? 100),
    });
    return apiOkFromRequest(request, events);
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
