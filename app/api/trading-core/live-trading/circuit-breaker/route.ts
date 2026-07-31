import { NextRequest } from "next/server";
import { apiErrorFromUnknown, apiOkFromRequest } from "@/lib/api";
import { getRequestLocale } from "@/lib/request-locale";
import { secureRoute } from "@/src/server/security/request-security";
import { prisma } from "@/src/server/db/prisma";
import { isCircuitBreakerActive, resolveCircuitBreaker, runCircuitBreakerChecks, tripCircuitBreaker } from "@/src/server/live-trading/circuit-breaker.service";
import type { CircuitBreakerReason } from "@prisma/client";

export async function GET(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER", "VIEWER"] });
    if (!access.ok) return access.response;
    const userId = request.nextUrl.searchParams.get("userId") ?? access.user?.id ?? undefined;

    const [active, events] = await Promise.all([
      isCircuitBreakerActive(userId),
      prisma.circuitBreakerEvent.findMany({ orderBy: { triggeredAt: "desc" }, take: 20 }),
    ]);

    return apiOkFromRequest(request, { active, events });
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}

export async function POST(request: NextRequest) {
  const tr = getRequestLocale(request) === "tr";
  try {
    const access = await secureRoute(request, { tr, roles: ["ADMIN", "TRADER"] });
    if (!access.ok) return access.response;
    const body = (await request.json()) as {
      action: "check" | "trip" | "resolve";
      userId?: string;
      eventId?: string;
      reason?: CircuitBreakerReason;
      message?: string;
    };

    if (body.action === "check") {
      return apiOkFromRequest(request, await runCircuitBreakerChecks(body.userId));
    }
    if (body.action === "trip") {
      const event = await tripCircuitBreaker({
        userId: body.userId,
        reason: body.reason ?? "MANUAL",
        message: body.message ?? "Manual circuit breaker trip",
        activateKillSwitch: false,
      });
      return apiOkFromRequest(request, event);
    }
    if (body.action === "resolve" && body.eventId) {
      return apiOkFromRequest(request, await resolveCircuitBreaker(body.eventId));
    }

    return apiErrorFromUnknown(new Error("Invalid action"));
  } catch (error) {
    return apiErrorFromUnknown(error);
  }
}
