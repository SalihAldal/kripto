import type { UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { apiError, enforceRateLimit } from "@/lib/api";
import { checkApiToken } from "@/lib/auth";
import { env } from "@/lib/config";
import { getRuntimeExecutionContext } from "@/src/server/repositories/execution.repository";
import { addAuditLog } from "@/src/server/repositories/audit.repository";

type SecurityOptions = {
  tr: boolean;
  roles?: UserRole[];
  requireConfirmation?: boolean;
};

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isSameOriginRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === request.nextUrl.host;
  } catch {
    return false;
  }
}

function hasRole(userRole: UserRole, required: UserRole[]) {
  return required.includes(userRole);
}

function sanitizeString(value: string) {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .trim();
}

export function sanitizePayload<T>(payload: T): T {
  if (typeof payload === "string") {
    return sanitizeString(payload) as unknown as T;
  }
  if (Array.isArray(payload)) {
    return payload.map((row) => sanitizePayload(row)) as unknown as T;
  }
  if (payload && typeof payload === "object") {
    return Object.fromEntries(
      Object.entries(payload as Record<string, unknown>).map(([key, value]) => [key, sanitizePayload(value)]),
    ) as T;
  }
  return payload;
}

export async function secureRoute(request: NextRequest, options: SecurityOptions) {
  const limited = enforceRateLimit(request);
  if (limited) return { ok: false as const, response: limited };

  if (!checkApiToken(request)) {
    return {
      ok: false as const,
      response: apiError(options.tr ? "Yetkisiz." : "Unauthorized.", 401),
    };
  }

  if (env.SECURITY_REQUIRE_CSRF && MUTATION_METHODS.has(request.method.toUpperCase())) {
    const fetchSite = request.headers.get("sec-fetch-site");
    const crossSite = fetchSite === "cross-site";
    if (crossSite || !isSameOriginRequest(request)) {
      return {
        ok: false as const,
        response: apiError(options.tr ? "Guvenlik dogrulamasi basarisiz." : "Security verification failed.", 403),
      };
    }
  }

  if (options.requireConfirmation || env.SECURITY_REQUIRE_MANUAL_CONFIRMATION) {
    const confirmation = request.headers.get("x-confirm-action");
    if (confirmation !== "CONFIRM") {
      return {
        ok: false as const,
        response: NextResponse.json(
          {
            ok: false,
            error: options.tr
              ? "Kritik islem icin onay zorunlu. x-confirm-action=CONFIRM gonderin."
              : "Confirmation required for critical action. Send x-confirm-action=CONFIRM.",
          },
          { status: 428 },
        ),
      };
    }
  }

  const requestedUserId = request.headers.get("x-user-id") ?? undefined;
  const { user } = await getRuntimeExecutionContext(requestedUserId);

  if (options.roles && options.roles.length > 0 && !hasRole(user.role, options.roles)) {
    await addAuditLog({
      userId: user.id,
      action: "EXECUTE",
      entityType: "SecurityViolation",
      metadata: {
        reason: "insufficient_role",
        requiredRoles: options.roles,
        userRole: user.role,
        path: request.nextUrl.pathname,
      },
    }).catch(() => null);
    return {
      ok: false as const,
      response: apiError(options.tr ? "Bu islem icin yetkiniz yok." : "You are not allowed to perform this action.", 403),
    };
  }

  return { ok: true as const, user };
}
