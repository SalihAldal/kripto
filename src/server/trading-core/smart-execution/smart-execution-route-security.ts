import type { UserRole } from "@prisma/client";
import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api";
import { getIdempotencyKey, readIdempotentResponse, acquireUserActionLock } from "@/src/server/security/idempotency";
import { secureRoute } from "@/src/server/security/request-security";

export type SmartExecutionAccessOptions = {
  tr: boolean;
  roles: UserRole[];
  requireConfirmation?: boolean;
};

export async function secureSmartExecutionRoute(request: NextRequest, options: SmartExecutionAccessOptions) {
  return secureRoute(request, {
    tr: options.tr,
    roles: options.roles,
    requireConfirmation: options.requireConfirmation,
  });
}

export async function requireSmartExecutionIdempotency(
  request: NextRequest,
  userId: string,
  scope: string,
  tr: boolean,
) {
  const key = getIdempotencyKey(request.headers);
  if (!key) {
    return {
      ok: false as const,
      response: apiError(
        tr
          ? "Kritik smart execution islemi icin idempotency-key zorunludur."
          : "idempotency-key is required for critical smart execution action.",
        428,
      ),
    };
  }
  const cached = await readIdempotentResponse(userId, scope, key);
  return { ok: true as const, key, cached };
}

export async function withSmartExecutionLock<T>(
  userId: string,
  action: string,
  tr: boolean,
  operation: () => Promise<T>,
) {
  const releaseLock = await acquireUserActionLock(userId, action, 20_000);
  if (!releaseLock) {
    return {
      ok: false as const,
      response: apiError(
        tr ? "Ayni anda birden fazla smart execution islemi calisamaz." : "Conflicting smart execution action is already running.",
        409,
      ),
    };
  }
  try {
    const result = await operation();
    return { ok: true as const, result };
  } finally {
    await releaseLock();
  }
}
